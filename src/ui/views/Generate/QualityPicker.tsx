import React, { useCallback, useEffect, useState } from 'react';
import type { Pipeline } from '../../../core/types';
import { getModel } from '../../../core/models';
import { applyQuality, detectQuality, QUALITY_PRESETS, type QualityPreset } from '../../../core/quality';
import { Tooltip } from '../../components';
import { pipelineStore, usePipelineStore } from '../../stores/pipelineStore';

/**
 * The only dial most people want, on the bar they already use.
 *
 * Steps, guidance and octree resolution live in the node editor, which is the
 * most advanced screen in the app — so the one question a normal user actually
 * has ("can it be quicker / can it be sharper?") had nowhere to be asked. This
 * writes a preset straight into the selected pipeline's generator node, which
 * means the node editor and this control can never disagree: there is one set
 * of settings and two ways to reach it.
 *
 * A graph edited by hand shows as Custom rather than snapping to the nearest
 * preset — picking one then overwrites it, which is the point of picking one.
 */
export const QualityPicker: React.FC = () => {
  const [pipelines] = usePipelineStore();
  const [doc, setDoc] = useState<Pipeline | null>(null);
  const selectedId = pipelines.selectedId;

  useEffect(() => {
    let live = true;
    if (!selectedId) {
      setDoc(null);
      return;
    }
    void pipelineStore.read(selectedId).then((p) => {
      if (live) setDoc(p);
    });
    return () => {
      live = false;
    };
    // The list identity changes whenever a pipeline is saved, which is exactly
    // when this needs to re-read: a graph edited next door must show up here.
  }, [selectedId, pipelines.list]);

  const generator = doc?.nodes.find((n) => n.type === 'mesh-generator');
  const modelId = generator?.data.modelId as string | undefined;
  const model = modelId ? getModel(modelId) : null;
  const settings = (generator?.data.settings ?? {}) as Record<string, number | string | boolean>;

  const choose = useCallback(
    (preset: QualityPreset) => {
      if (!doc || !generator || !model) return;
      const next: Pipeline = {
        ...doc,
        nodes: doc.nodes.map((n) =>
          n.id === generator.id
            ? { ...n, data: { ...n.data, settings: applyQuality(model, preset, settings) } }
            : n
        ),
      };
      setDoc(next);
      void pipelineStore.save(next);
    },
    [doc, generator, model, settings]
  );

  if (!model) return null;
  const active = detectQuality(model, settings);

  return (
    <div className="gen-quality" role="group" aria-label="Quality">
      {QUALITY_PRESETS.map((preset) => (
        <Tooltip key={preset.value} content={preset.hint} position="top">
          <button
            type="button"
            className={`gen-quality-btn ${active === preset.value ? 'is-active' : ''}`}
            aria-pressed={active === preset.value}
            onClick={() => choose(preset.value)}
          >
            {preset.label}
          </button>
        </Tooltip>
      ))}
      {active === null && <span className="gen-quality-custom">Custom</span>}
    </div>
  );
};
