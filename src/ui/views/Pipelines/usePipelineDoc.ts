import { useCallback, useEffect, useRef, useState } from 'react';
import type { Pipeline } from '../../../core/pipeline';
import { createDefaultPipeline } from '../../../core/pipeline';
import { pipelineStore } from '../../stores/pipelineStore';

export type SaveState = 'saved' | 'dirty' | 'saving' | 'local';

const SAVE_DEBOUNCE_MS = 600;

const hasApi = () => typeof window !== 'undefined' && Boolean(window.electronAPI);

/**
 * The full pipeline being edited. Loads on id change; every `update` marks
 * the doc dirty and schedules a debounced save; pending changes are flushed
 * when the id changes or the view unmounts. Without electronAPI the doc is an
 * in-memory default so the editor still works in a plain browser.
 */
export function usePipelineDoc(id: string | null) {
  const [pipeline, setPipeline] = useState<Pipeline | null>(null);
  const [saveState, setSaveState] = useState<SaveState>(hasApi() ? 'saved' : 'local');
  const pipelineRef = useRef<Pipeline | null>(null);
  const dirtyRef = useRef<Pipeline | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  const flush = useCallback(async () => {
    clearTimer();
    const pending = dirtyRef.current;
    dirtyRef.current = null;
    if (!pending || !hasApi()) return;
    setSaveState('saving');
    await pipelineStore.save(pending);
    setSaveState(dirtyRef.current ? 'dirty' : 'saved');
  }, []);

  /** Drop unsaved changes (used before deleting the pipeline being edited). */
  const discard = useCallback(() => {
    clearTimer();
    dirtyRef.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    pipelineRef.current = null;
    setPipeline(null);
    if (!id) return;
    void pipelineStore.read(id).then((p) => {
      if (cancelled) return;
      const doc = p ?? (hasApi() ? null : createDefaultPipeline('Default'));
      pipelineRef.current = doc;
      setPipeline(doc);
      setSaveState(hasApi() ? 'saved' : 'local');
    });
    return () => {
      cancelled = true;
      void flush();
    };
  }, [id, flush]);

  const update = useCallback(
    (fn: (p: Pipeline) => Pipeline) => {
      const current = pipelineRef.current;
      if (!current) return;
      const next = fn(current);
      if (next === current) return;
      pipelineRef.current = next;
      setPipeline(next);
      if (!hasApi()) return;
      dirtyRef.current = next;
      setSaveState('dirty');
      clearTimer();
      timerRef.current = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
    },
    [flush]
  );

  return { pipeline, saveState, update, flush, discard };
}
