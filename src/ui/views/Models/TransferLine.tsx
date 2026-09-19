import React, { useEffect, useRef, useState } from 'react';
import type { ModelDownloadProgress } from '../../../core/types';
import type { LiveInstall } from './modelState';
import { ProgressBar } from './ProgressBar';
import { formatBytes, formatEta, formatRate } from './formatBytes';

/**
 * Download speed, smoothed. Main reports bytes-so-far and nothing else, so the
 * rate is measured here from consecutive progress events and eased hard — a
 * Hugging Face download swings between 2 and 40 MB/s and a number that jumps
 * every frame reads as broken rather than fast.
 */
function useTransferRate(progress: ModelDownloadProgress | null | undefined): number | null {
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
  live: LiveInstall;
}

/**
 * The live line for the whole install, whichever leg is running: one bar, one
 * plain sentence, and the noisy per-file detail underneath. The legs share this
 * one component so a chained install reads as a single run rather than three
 * separate ones that each start over at zero.
 */
export const TransferLine: React.FC<TransferLineProps> = ({ live }) => {
  const rate = useTransferRate(live.transfer);
  const { failed, indeterminate, transfer } = live;

  // A weights download can say something better than a percentage: how much of
  // it has landed, how fast, and how long is left.
  const measured =
    transfer && !failed && !indeterminate
      ? [
          transfer.totalBytes > 0
            ? `${formatBytes(transfer.downloadedBytes)} of ${formatBytes(transfer.totalBytes)}`
            : `${formatBytes(transfer.downloadedBytes)} downloaded`,
          formatRate(rate),
          rate && transfer.totalBytes > transfer.downloadedBytes
            ? formatEta((transfer.totalBytes - transfer.downloadedBytes) / rate)
            : null,
        ]
          .filter(Boolean)
          .join(' · ')
      : null;

  return (
    <div className={`models-transfer ${failed ? 'is-failed' : ''}`}>
      <div className="models-transfer-bar">
        <ProgressBar pct={live.pct} indeterminate={indeterminate} tone={failed ? 'danger' : 'accent'} />
        {!indeterminate && <span className="models-transfer-pct">{Math.round(live.pct)}%</span>}
      </div>
      <p className="models-transfer-headline">{live.label}</p>
      {measured && <p className="models-transfer-measure">{measured}</p>}
      {live.detail && (
        <p className="models-transfer-detail" title={live.detail}>
          {live.detail}
        </p>
      )}
    </div>
  );
};
