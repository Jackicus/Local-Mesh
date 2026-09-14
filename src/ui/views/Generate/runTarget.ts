import { getModel } from '../../../core/models';
import { useEnvStore } from '../../stores/envStore';
import { useGenerationStore } from '../../stores/generationStore';
import { useModelStore } from '../../stores/modelStore';
import { usePipelineStore } from '../../stores/pipelineStore';

export interface RunTarget {
  pipelineId: string | null;
  modelId: string | null;
  modelName: string | null;
  /** Weights downloaded and python deps installed (mock needs neither). */
  modelReady: boolean;
  /** The venv can run this model at all. */
  envReady: boolean;
  /** The worker is holding different weights; running swaps them. */
  willSwitchModel: boolean;
  /** Name of whatever the worker currently holds, for that warning. */
  loadedModelName: string | null;
  /** The pipeline's Image Input node carries its own image; no staging needed. */
  fixedImagePath: string | null;
}

/**
 * What "Generate" would actually run, and whether it can. Shared by the
 * picker (which explains the blockers) and the button (which enforces them).
 */
export function useRunTarget(): RunTarget {
  const [pipelines] = usePipelineStore();
  const [models] = useModelStore();
  const [env] = useEnvStore();
  const [gen] = useGenerationStore();

  const pipeline = pipelines.list.find((p) => p.id === pipelines.selectedId) ?? null;
  const modelId = pipeline?.modelId ?? null;
  const isMock = modelId === 'mock';

  return {
    pipelineId: pipeline?.id ?? null,
    modelId,
    modelName: modelId ? getModel(modelId)?.name ?? modelId : null,
    modelReady: modelId ? isMock || (models.installs[modelId]?.ready ?? false) : false,
    // The mock backend is pure python: it needs the venv to exist, not torch.
    envReady: Boolean(isMock ? env.status?.envExists : env.status?.ready),
    willSwitchModel: Boolean(modelId && gen.loadedModelId && gen.loadedModelId !== modelId),
    loadedModelName: gen.loadedModelId ? getModel(gen.loadedModelId)?.name ?? gen.loadedModelId : null,
    fixedImagePath: pipeline?.fixedImagePath ?? null,
  };
}
