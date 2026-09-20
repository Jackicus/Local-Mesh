import fs from 'node:fs';
import path from 'node:path';
import { getModel } from '../core/types';
import type { ModelDefinition } from '../core/types';
import { formatBytes } from './format';
import {
  COMPLETE_MARKER,
  matchesAllowPatterns,
  readCompleteManifest,
  type CompleteManifest,
  type SnapshotFile,
} from './hfDownload';
import { log } from './logger';
import { modelDir } from './modelManager';
import { errorMessage } from './proc';

/**
 * One-time rescue of weights that a registry split left in the wrong folder.
 *
 * Hunyuan3D 2's turbo and standard checkpoints used to be a single registry
 * entry that downloaded both and picked between them at run time. They are two
 * entries now, each fetching only what it uses — but an existing install still
 * has both sitting in the old entry's directory. Without this, the turbo entry
 * reads as "not downloaded" and offers to fetch four gigabytes that are already
 * on the disk, while the four gigabytes it would duplicate sit unreferenced in
 * the neighbouring folder forever, counted in the storage total and removable
 * only by deleting the model that still works.
 *
 * So: move what belongs to the new entry, copy what both entries still want,
 * and write each side a `.complete` marker that matches what is actually there.
 * Nothing is downloaded and nothing is deleted — the worst case is that a
 * mismatch is detected and the migration declines to touch anything, leaving
 * the pre-split install exactly as it was.
 *
 * This is a migration, not a feature. It is keyed on specific ids on purpose,
 * and it can be deleted once no install predates the split.
 */
interface WeightsSplit {
  /** The combined entry's directory, which holds the files today. */
  from: string;
  /** The entry that was split out of it and now wants some of them. */
  to: string;
}

const SPLITS: WeightsSplit[] = [
  { from: 'hunyuan3d-2mini', to: 'hunyuan3d-2mini-turbo' },
  { from: 'hunyuan3d-2', to: 'hunyuan3d-2-turbo' },
];

/** The manifest's file list, whatever vintage of marker wrote it. */
function manifestFiles(manifest: CompleteManifest): SnapshotFile[] {
  if (manifest.files?.length) return manifest.files;
  return (manifest.repos ?? []).flatMap((repo) =>
    (repo.files ?? []).map((file) => ({
      path: repo.dir ? `${repo.dir}/${file.path}` : file.path,
      size: file.size,
    }))
  );
}

function writeManifest(dir: string, model: ModelDefinition, files: SnapshotFile[]): void {
  const manifest: CompleteManifest = {
    repo: model.hfRepo,
    totalBytes: files.reduce((sum, f) => sum + (f.size || 0), 0),
    completedAt: new Date().toISOString(),
    // `dir: ''` is the model's own snapshot at the root. A split entry never
    // has extras — if one ever does, it will read as `partial` and the download
    // will fetch just the missing repo, which is the right outcome anyway.
    repos: [{ repo: model.hfRepo, dir: '', files }],
    files,
  };
  fs.writeFileSync(path.join(dir, COMPLETE_MARKER), `${JSON.stringify(manifest, null, 2)}\n`);
}

/**
 * Drop directories the move emptied. Files are moved one at a time, so the
 * checkpoint folder they came from survives as an empty shell — harmless, but
 * it leaves the old model's folder still apparently holding the checkpoint that
 * moved out, which is exactly the confusion this migration exists to clear up.
 * Only ever removes directories it finds empty, so it can never take a file.
 */
function pruneEmptyDirs(dir: string): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const child = path.join(dir, entry.name);
    pruneEmptyDirs(child);
    try {
      if (fs.readdirSync(child).length === 0) fs.rmdirSync(child);
    } catch {
      // Busy, or gone already. Leaving an empty directory behind costs nothing.
    }
  }
}

/**
 * Adopt one split's files. Returns the bytes rescued, or 0 when there was
 * nothing to do — which is the normal case on every launch after the first.
 */
function adopt({ from, to }: WeightsSplit): number {
  const source = getModel(from);
  const target = getModel(to);
  if (!source || !target || !target.hfRepo || source.hfRepo !== target.hfRepo) return 0;

  const fromDir = modelDir(from);
  const toDir = modelDir(to);

  // Already sorted out, by this migration or by an actual download.
  if (readCompleteManifest(toDir)) return 0;
  const oldManifest = readCompleteManifest(fromDir);
  if (!oldManifest) return 0;

  const wanted = manifestFiles(oldManifest).filter((f) => matchesAllowPatterns(f.path, target.hfAllowPatterns));
  if (wanted.length === 0) return 0;

  // Every file has to be where the marker says before anything moves: a
  // half-migrated pair is worse than an un-migrated one, because both sides
  // would then claim to be complete while neither is.
  const missing = wanted.filter((f) => !fs.existsSync(path.join(fromDir, f.path)));
  if (missing.length > 0) {
    log.general.warn(
      `not adopting ${to}'s weights from ${from}: ${missing.length} of ${wanted.length} files named by its ` +
        'download marker are not on disk. Downloading it will fetch them fresh.'
    );
    return 0;
  }

  let rescued = 0;
  for (const file of wanted) {
    const src = path.join(fromDir, file.path);
    const dest = path.join(toDir, file.path);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    // A file both entries still want (the repo's small root-level metadata) is
    // copied; one only the new entry wants is moved, which is what frees the
    // space. Same filesystem, so the move is a rename and costs nothing.
    if (matchesAllowPatterns(file.path, source.hfAllowPatterns)) fs.copyFileSync(src, dest);
    else {
      fs.renameSync(src, dest);
      rescued += file.size || 0;
    }
  }
  writeManifest(toDir, target, wanted);
  pruneEmptyDirs(fromDir);

  // The old marker now lists files that have moved out from under it. Left
  // alone it still reads as complete — nothing verifies the list — but it would
  // be a lie, and the next thing to read it would act on that lie.
  const remaining = manifestFiles(oldManifest).filter((f) => fs.existsSync(path.join(fromDir, f.path)));
  writeManifest(fromDir, source, remaining);

  log.general.info(
    `${target.name} adopted ${wanted.length} files already downloaded for ${source.name}` +
      (rescued > 0 ? `, freeing ${formatBytes(rescued)} that would otherwise have been fetched again` : '')
  );
  return rescued;
}

/** Run every outstanding split. Safe to call on every launch. */
export function migrateSplitWeights(): void {
  for (const split of SPLITS) {
    try {
      adopt(split);
    } catch (err) {
      // A failed adoption costs a re-download, which is recoverable; a failed
      // startup is not.
      log.general.warn(
        `could not move ${split.to}'s weights out of ${split.from}: ${errorMessage(err)}. ` +
          'It will download them instead.'
      );
    }
  }
}
