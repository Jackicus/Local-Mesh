import React, { useEffect, useRef, useState } from 'react';
import type { ModelDownloadProgress } from '../../../core/types';
import { ProgressBar } from './ProgressBar';
import { formatBytes, formatEta, formatRate } from './formatBytes';

/**
 * Download speed, smoothed. Main reports bytes-so-far and nothing else, so the
 * rate is measured here from consecutive progress events and eased hard — a
 * Hugging Face download swings between 2 and 40 MB/s and a number that jumps
 * every frame reads as broken rather than fast.
 */
function useTransferRate(progress: ModelDownloadProgress | null): number | null {
  const sample = useRef<{ bytes: number; at: number } | null>(null);
  const [rate, setRate] = useState<number | null>(null);

  const bytes =
    progress && progress.kind === 'weights' && progress.status === 'downloading' ? progress.downloadedBytes : null;

  useEffect(() => {
    if (bytes == null) {
      sample.current = null;
      setRate(null);
      return;
    }
    const now = Date.now();
    const prev = sample.current;
    if (!prev) {
      sample.current = { bytes, at: now };
      return;
    }
    const elapsed = (now - prev.at) / 1000;
    if (elapsed < 0.6) return;
    sample.current = { bytes, at: now };
    const moved = bytes - prev.bytes;
    if (moved <= 0) return;
    const instant = moved / elapsed;
    setRate((previous) => (previous == null ? instant : previous * 0.7 + instant * 0.3));
  }, [bytes]);

  return rate;
}

interface TransferLineProps {
  progress: ModelDownloadProgress;
}

/** The live line for whichever step is running: a bar and one plain sentence. */
export const TransferLine: React.FC<TransferLineProps> = ({ progress }) => {
  const rate = useTransferRate(progress);
  const failed = progress.status === 'failed';
  const starting = progress.status === 'starting';

  let headline: string;
  if (failed) {
    headline = progress.error ?? 'The last attempt failed.';
  } else if (starting) {
    headline = 'Starting…';
  } else if (progress.kind === 'weights') {
    const parts = [
      progress.totalBytes > 0
        ? `${formatBytes(progress.downloadedBytes)} of ${formatBytes(progress.totalBytes)}`
        : `${formatBytes(progress.downloadedBytes)} downloaded`,
      formatRate(rate),
      rate && progress.totalBytes > progress.downloadedBytes
        ? formatEta((progress.totalBytes - progress.downloadedBytes) / rate)
        : null,
    ];
    headline = parts.filter(Boolean).join(' · ');
  } else {
    headline = 'Installing packages…';
  }

  // The per-file / per-package line: useful, but never the thing you read first.
  const detail = !failed && !starting && progress.message ? progress.message : null;

  return (
    <div className={`models-transfer ${failed ? 'is-failed' : ''}`}>
      <div className="models-transfer-bar">
        <ProgressBar pct={progress.pct} indeterminate={starting} tone={failed ? 'danger' : 'accent'} />
        {!starting && <span className="models-transfer-pct">{Math.round(progress.pct)}%</span>}
      </div>
      <p className="models-transfer-headline">{headline}</p>
      {detail && (
        <p className="models-transfer-detail" title={detail}>
          {detail}
        </p>
      )}
    </div>
  );
};
