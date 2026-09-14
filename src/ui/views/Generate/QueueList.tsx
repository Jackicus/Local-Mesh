import React, { useMemo } from 'react';
import { Button } from '../../components';
import { useGenerationStore } from '../../stores/generationStore';
import { DockSection } from './DockSection';
import { QueueRow } from './QueueRow';

const FINISHED = new Set(['done', 'failed', 'cancelled']);

/** Newest first: the thing you just asked for is the thing you want to see. */
export const QueueList: React.FC = () => {
  const [gen, generation] = useGenerationStore();
  const jobs = useMemo(() => [...gen.jobs].sort((a, b) => b.createdAt - a.createdAt), [gen.jobs]);
  const finished = jobs.filter((j) => FINISHED.has(j.status)).length;

  return (
    <DockSection
      title="Queue"
      meta={jobs.length || undefined}
      action={
        finished > 0 ? (
          <Button variant="subtle" size="sm" onClick={() => generation.clearFinished()}>
            Clear finished
          </Button>
        ) : undefined
      }
    >
      {jobs.length === 0 ? (
        <p className="gen-blank">Nothing queued.</p>
      ) : (
        <ul className="gen-job-list">
          {jobs.map((job) => (
            <QueueRow key={job.id} job={job} />
          ))}
        </ul>
      )}
    </DockSection>
  );
};
