import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ModelDefinition } from '../../../core/types';
import { MODELS } from '../../../core/models';
import { Badge, Button, toast } from '../../components';
import { CheckCircleIcon, FolderOpenIcon, HardDriveIcon, PackageIcon } from '../../assets/icons';
import { dockStore } from '../../stores/dockStore';
import { useEnvStore } from '../../stores/envStore';
import { useModelStore } from '../../stores/modelStore';
import { useGenerationStore } from '../../stores/generationStore';
import { Disclosure } from './Disclosure';
import { EnvironmentCard } from './EnvironmentCard';
import { FeaturedModel } from './FeaturedModel';
import { ModelRow } from './ModelRow';
import { deriveModelState, type ModelState } from './modelState';
import type { ModelHandlers } from './ModelActions';
import { formatBytes } from './formatBytes';

const SETUP_PHASES = ['creating-venv', 'installing-torch', 'installing-base', 'verifying'];

/** Models that need nothing from the internet: the procedural demo. */
const isDemo = (model: ModelDefinition) => model.hfRepo === '';

export const ModelsView: React.FC = () => {
  const [env, envActions] = useEnvStore();
  const [models, modelActions] = useModelStore();
  const [gen, genActions] = useGenerationStore();

  const engineRef = useRef<HTMLDivElement>(null);
  const pulseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pulse, setPulse] = useState(false);

  // Re-probe on every visit: uv may have been installed, or weights changed on
  // disk, since the stores bound at startup.
  useEffect(() => {
    void envActions.refresh();
    void modelActions.refresh();
  }, [envActions, modelActions]);

  useEffect(() => () => {
    if (pulseTimer.current) clearTimeout(pulseTimer.current);
  }, []);

  /** Every "you have to do X first" note in this view points back at one card. */
  const focusEngine = useCallback(() => {
    engineRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setPulse(true);
    if (pulseTimer.current) clearTimeout(pulseTimer.current);
    pulseTimer.current = setTimeout(() => setPulse(false), 1800);
  }, []);

  const envReady = env.status?.ready ?? false;
  const envBusy = env.settingUp || Boolean(env.status && SETUP_PHASES.includes(env.status.phase));
  const busy =
    gen.activeJobId !== null || gen.worker === 'loading' || gen.worker === 'generating' || gen.worker === 'unloading';
  const vramTotalBytes = env.status?.vramTotalBytes ?? gen.memory.vramTotalBytes;
  const totalBytes = Object.values(models.installs).reduce((sum, m) => sum + (m.sizeBytes || 0), 0);

  const states = useMemo(() => {
    const map = new Map<string, ModelState>();
    for (const model of MODELS) {
      map.set(
        model.id,
        deriveModelState({
          model,
          install: models.installs[model.id],
          download: models.downloads[model.id],
          envReady,
          envBusy,
          vramTotalBytes,
        })
      );
    }
    return map;
  }, [models.installs, models.downloads, envReady, envBusy, vramTotalBytes]);

  const handlerCache = useRef(new Map<string, ModelHandlers>());
  const makeHandlers = useCallback(
    (model: ModelDefinition): ModelHandlers => ({
      onDownload: () => void modelActions.download(model.id),
      onInstallDeps: () => void modelActions.installDeps(model.id),
      onCancel: () => void modelActions.cancelDownload(model.id),
      onDelete: () => {
        void modelActions
          .remove(model.id)
          .then(() => toast.success(`${model.name} deleted`))
          .catch((err: unknown) =>
            toast.error(err instanceof Error ? err.message : String(err), { title: `Could not delete ${model.name}` })
          );
      },
      onLoad: () => void genActions.loadModel(model.id),
      onUnload: () => void genActions.unloadModel(),
      onFixEngine: focusEngine,
    }),
    [modelActions, genActions, focusEngine]
  );

  // The store actions and focusEngine are stable, so the handler objects can be
  // too: minting a fresh one per row per render defeats any memoisation below.
  useEffect(() => {
    handlerCache.current.clear();
  }, [makeHandlers]);

  const handlersFor = useCallback(
    (model: ModelDefinition): ModelHandlers => {
      const hit = handlerCache.current.get(model.id);
      if (hit) return hit;
      const made = makeHandlers(model);
      handlerCache.current.set(model.id, made);
      return made;
    },
    [makeHandlers]
  );

  const real = MODELS.filter((m) => !isDemo(m));
  const demo = MODELS.filter(isDemo);
  const readyCount = real.filter((m) => states.get(m.id)?.ready).length;

  // The one to try first: whatever is already on its way, else the model the
  // registry recommends when it fits this card, else the smallest one that
  // does (the registry is ordered by graphics memory, ascending).
  const candidates = real.filter((m) => states.get(m.id)?.fit?.verdict !== 'over');
  const pick =
    candidates.find((m) => states.get(m.id)?.running) ??
    candidates.find((m) => (models.installs[m.id]?.weights ?? 'none') !== 'none') ??
    candidates.find((m) => m.tags.includes('recommended')) ??
    candidates[0] ??
    real[0];
  const featured = readyCount === 0 ? pick : undefined;

  const rest = real.filter((m) => m.id !== featured?.id);
  const installed = rest.filter((m) => states.get(m.id)?.ready);
  const available = rest.filter((m) => !states.get(m.id)?.ready && states.get(m.id)?.fit?.verdict !== 'over');
  const tooBig = rest.filter((m) => !states.get(m.id)?.ready && states.get(m.id)?.fit?.verdict === 'over');

  const row = (model: ModelDefinition) => {
    const state = states.get(model.id);
    if (!state) return null;
    return (
      <ModelRow
        key={model.id}
        model={model}
        install={models.installs[model.id]}
        state={state}
        loaded={gen.loadedModelId === model.id}
        busy={busy}
        handlers={handlersFor(model)}
      />
    );
  };

  return (
    <div className="view-container models-view">
      <header className="view-header">
        <Badge variant="accent" icon={<PackageIcon size={14} />}>
          {readyCount} of {real.length} ready
        </Badge>
        <h1 className="view-title">Models</h1>
        <p className="view-description">
          Each model turns a picture into a 3D shape, and each one has to be installed before it can run. Everything
          lands in <code className="models-inline-code">{env.paths?.root ?? '~/.local-mesh'}</code> and nothing is
          installed elsewhere on your computer.
        </p>
      </header>

      {readyCount > 0 && (
        <p className="models-ready-note">
          <CheckCircleIcon size={16} />
          <span>
            {readyCount === 1 ? 'One model is ready.' : `${readyCount} models are ready.`} You can make a mesh now.
          </span>
          <button type="button" className="models-link" onClick={() => dockStore.setActiveItem('generate')}>
            Go to Generate
          </button>
        </p>
      )}

      <div ref={engineRef} className={`models-anchor ${pulse ? 'is-pulsing' : ''}`}>
        <EnvironmentCard />
      </div>

      {featured && states.get(featured.id) && (
        <FeaturedModel
          model={featured}
          install={models.installs[featured.id]}
          state={states.get(featured.id)!}
          loaded={gen.loadedModelId === featured.id}
          busy={busy}
          handlers={handlersFor(featured)}
        />
      )}

      {installed.length > 0 && (
        <section className="models-group">
          <h2 className="models-group-title">Ready to use</h2>
          <ul className="models-list">{installed.map(row)}</ul>
        </section>
      )}

      {available.length > 0 && (
        <section className="models-group">
          <h2 className="models-group-title">Other models</h2>
          <p className="models-group-note">
            {vramTotalBytes == null
              ? 'Set the engine up and Local Mesh will tell you which of these your graphics card can handle.'
              : 'Ordered by how much graphics memory they need, smallest first.'}
          </p>
          <ul className="models-list">{available.map(row)}</ul>
        </section>
      )}

      {tooBig.length > 0 && (
        <Disclosure
          summary={`${tooBig.length} ${tooBig.length === 1 ? 'model needs' : 'models need'} a bigger graphics card`}
          className="models-group-hidden"
        >
          <p className="models-group-note">
            These ask for more graphics memory than your card has. You can still install them — expect them to run out
            of memory part-way through a mesh.
          </p>
          <ul className="models-list">{tooBig.map(row)}</ul>
        </Disclosure>
      )}

      {demo.length > 0 && (
        <section className="models-group">
          <h2 className="models-group-title">Try it without downloading</h2>
          <p className="models-group-note">
            A pretend model that needs no download and no graphics card. Use it to check Local Mesh works end to end.
          </p>
          <ul className="models-list">{demo.map(row)}</ul>
        </section>
      )}

      <footer className="models-storage">
        <HardDriveIcon size={14} />
        <span className="models-storage-value">
          Model files are using <strong>{formatBytes(totalBytes)}</strong> in{' '}
          <code className="models-inline-code">{env.paths?.models ?? '~/.local-mesh/models'}</code>
        </span>
        {env.paths && (
          <Button
            size="sm"
            variant="subtle"
            icon={<FolderOpenIcon size={14} />}
            onClick={() => window.electronAPI?.openPath(env.paths!.models)}
          >
            Open folder
          </Button>
        )}
      </footer>
    </div>
  );
};
