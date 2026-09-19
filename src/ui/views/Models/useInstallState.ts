/**
 * `deriveModelState` wired to the stores, so anything that wants to ask "is
 * this model installed, and what would the one button do?" gets the same
 * answer as the Models view.
 *
 * It lives here rather than in hooks/ because it belongs to the model-install
 * domain this directory owns, and the Generate view imports it: setup is
 * offered where the user actually is, not only on the page about models.
 */
import { useMemo } from 'react';
import { getModel } from '../../../core/models';
import { useEnvStore } from '../../stores/envStore';
import { useGenerationStore } from '../../stores/generationStore';
import { useModelStore } from '../../stores/modelStore';
import { deriveModelState, type ModelState } from './modelState';

const SETUP_PHASES = ['creating-venv', 'installing-torch', 'installing-base', 'verifying'];

export function useInstallState(modelId: string | null): ModelState | null {
  const [env] = useEnvStore();
  const [models] = useModelStore();
  const [gen] = useGenerationStore();

  const model = modelId ? getModel(modelId) : null;
  const envReady = env.status?.ready ?? false;
  const envBusy = env.settingUp || Boolean(env.status && SETUP_PHASES.includes(env.status.phase));
  const uvMissing = env.status ? !env.status.uvAvailable : false;
  const vramTotalBytes = env.status?.vramTotalBytes ?? gen.memory.vramTotalBytes;
  const install = modelId ? models.installs[modelId] : undefined;
  const download = modelId ? models.downloads[modelId] : undefined;

  return useMemo(
    () =>
      model
        ? deriveModelState({
            model,
            install,
            download,
            envReady,
            envBusy,
            envProgress: env.progress,
            uvMissing,
            chain: models.chain,
            vramTotalBytes,
          })
        : null,
    [model, install, download, envReady, envBusy, env.progress, uvMissing, models.chain, vramTotalBytes]
  );
}
