import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ModelDefinition } from '../../../core/types';
import { MODELS } from '../../../core/models';
import { Button, toast } from '../../components';
import { CheckCircleIcon, FolderOpenIcon, HardDriveIcon } from '../../assets/icons';
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
  /** Set when something sent the user at the engine card, so it opens on arrival. */
  const [engineOpen, setEngineOpen] = useState(false);

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
    setEngineOpen(true);
    // Let the disclosure mount before scrolling to where it will be.
    requestAnimationFrame(() => engineRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    setPulse(true);
    if (pulseTimer.current) clearTimeout(pulseTimer.current);
    pulseTimer.current = setTimeout(() => setPulse(false), 1800);
  }, []);

  const envReady = env.status?.ready ?? false;
  const envBusy = env.settingUp || Boolean(env.status && SETUP_PHASES.includes(env.status.phase));
  const uvMissing = env.status ? !env.status.uvAvailable : false;
  const needsRepair = Boolean(env.status?.envExists && !env.status.ready);
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
          envProgress: env.progress,
          uvMissing,
          chain: models.chain,
          vramTotalBytes,
        })
      );
    }
    return map;
  }, [models.installs, models.downloads, models.chain, envReady, envBusy, env.progress, uvMissing, vramTotalBytes]);

  const handlerCache = useRef(new Map<string, ModelHandlers>());
  const makeHandlers = useCallback(
    (model: ModelDefinition): ModelHandlers => ({
      onInstall: () => void modelActions.install(model.id),
      onCancel: () => void modelActions.cancelInstall(model.id),
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

  // The one to try first. The registry's `recommended` tag wins whenever that
  // model fits this card, because it is also the model wearing the badge in the
  // list below — picking anything else here makes the page disagree with
  // itself. Only when the recommendation will not fit do we fall back to the
  // smallest thing that will (the registry is ordered by VRAM, ascending).
  const fits = real.filter((m) => states.get(m.id)?.fit?.verdict !== 'over');
  const pick =
    fits.find((m) => states.get(m.id)?.running) ??
    fits.find((m) => m.tags.includes('recommended')) ??
    fits.find((m) => (models.installs[m.id]?.weights ?? 'none') !== 'none') ??
    fits[0] ??
    real[0];
  const featured = readyCount === 0 ? pick : undefined;

  const rest = real.filter((m) => m.id !== featured?.id);
  const installed = rest.filter((m) => states.get(m.id)?.ready);
  const others = rest.filter((m) => !states.get(m.id)?.ready);

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

  // The engine is an implementation detail right up until it is broken. It sits
  // on the surface only when it wants something from the user; otherwise it is
  // one line at the bottom of the page with everything else they will not need.
  // ...or until something explicitly sent the user here to look at it.
  const engineNeedsAttention = uvMissing || needsRepair || Boolean(env.status?.lastError) || engineOpen;

  const engineCard = (
    <div ref={engineRef} className={`models-anchor ${pulse ? 'is-pulsing' : ''}`}>
      <EnvironmentCard />
    </div>
  );

  return (
    <div className="view-container models-view">
      <header className="view-header">
        <h1 className="view-title">Models</h1>
        <p className="view-description">
          A model is the thing that turns your picture into a 3D shape. Install one and you are ready to go.
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

      {engineNeedsAttention && engineCard}

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

      {/* Everything that is not the recommendation folds away. Someone choosing
          their first model should be choosing between one option and "later". */}
      {others.length > 0 && (
        <Disclosure
          summary="Other models"
          meta={`${others.length}`}
          className="models-group-hidden"
          defaultOpen={readyCount > 0 && !featured}
        >
          <p className="models-group-note">
            You do not need these to get started — the one above is enough. They trade download size and graphics
            memory for sharper shapes, and some will not fit your card.
          </p>
          <ul className="models-list">{others.map(row)}</ul>
        </Disclosure>
      )}

      <Disclosure summary="Advanced" meta="you can ignore all of this" className="models-group-hidden">
        <p className="models-group-note">
          For anyone who wants to look underneath: the shared Python setup every model runs on, and a pretend model
          that makes a shape instantly so you can check Local Mesh works end to end.
        </p>
        {!engineNeedsAttention && engineCard}
        {demo.length > 0 && <ul className="models-list">{demo.map(row)}</ul>}
      </Disclosure>

      <footer className="models-storage">
        <HardDriveIcon size={14} />
        <span className="models-storage-value">
          Model files are using <strong>{formatBytes(totalBytes)}</strong>
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
