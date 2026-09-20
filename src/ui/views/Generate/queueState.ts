import { useMemo } from 'react';
import type { GenerationJob } from '../../../core/types';
import { isActive, isPending, jobBlocker } from '../../../core/jobs';
import { useGenerationStore } from '../../stores/generationStore';
import { usePipelineStore } from '../../stores/pipelineStore';
import { useInstalledModelIds } from './installedModels';

export interface QueueCounts {
  /** Drafts and queued jobs that Start would actually promote. */
  runnable: number;
  /** Pending jobs that are missing something, so Start will skip them. */
  blocked: number;
  /** A job is loading or running right now. */
  busy: boolean;
  /** An edit is being applied to a finished job's mesh. */
  editing: boolean;
}

/**
 * What Start would do if pressed, answered once and read in both places that
 * need it: the queue's own header and the Start control across the band.
 * `jobBlocker` is the same function main runs before it will queue anything,
 * so the count here and the queue main actually builds cannot disagree.
 */
export function useQueueCounts(): QueueCounts {
  const [gen] = useGenerationStore();
  const [pipelines] = usePipelineStore();
  const installed = useInstalledModelIds();

  return useMemo(() => {
    const knownPipelineIds = new Set(pipelines.list.map((p) => p.id));
    let runnable = 0;
    let blocked = 0;
    let busy = false;
    for (const job of gen.jobs as GenerationJob[]) {
      if (isActive(job.status)) busy = true;
      if (!isPending(job.status)) continue;
      if (jobBlocker(job.draft, installed, knownPipelineIds)) blocked += 1;
      else runnable += 1;
    }
    return { runnable, blocked, busy, editing: gen.processing !== null };
  }, [gen.jobs, gen.processing, pipelines.list, installed]);
}
