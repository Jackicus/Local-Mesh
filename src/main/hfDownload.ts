import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';

/**
 * A minimal snapshot_download in Node: list a Hugging Face repo's tree, filter
 * it the way huggingface_hub's `allow_patterns` does, and stream each file to
 * disk with resume. No python, so weights can be fetched before the env exists.
 *
 * A model may need more than one repo (a backend that loads an image encoder
 * from a second repo, say). All of them land under one destination — the main
 * repo at the root, extras in their own subdirectory — every tree is listed up
 * front so progress spans the whole set, and a single `.complete` manifest at
 * the root records what every repo contributed.
 */

const API_BASE = 'https://huggingface.co';
const PARALLEL_FILES = 2;
const PROGRESS_INTERVAL_MS = 250;
const ATTEMPTS_PER_FILE = 3;
const RETRY_DELAY_MS = 2000;

/** Written into the destination once every file has landed. */
export const COMPLETE_MARKER = '.complete';

export interface SnapshotFile {
  path: string;
  size: number;
}

export interface SnapshotProgress {
  downloadedBytes: number;
  totalBytes: number;
  /** Destination-relative path of the file the bytes just came from. */
  file: string;
}

/** One repo of a snapshot set. */
export interface SnapshotRepo {
  repo: string;
  /** Subdirectory under `dest`; '' (the default) means `dest` itself. */
  dir?: string;
  /** fnmatch-style globs against the full repo-relative path; empty = everything. */
  allowPatterns?: string[];
}

export interface DownloadSnapshotOptions {
  /** The model's own repo first, then any extras. */
  repos: SnapshotRepo[];
  dest: string;
  /** Defaults to process.env.HF_TOKEN (needed for gated repos). */
  token?: string;
  signal?: AbortSignal;
  onProgress?: (progress: SnapshotProgress) => void;
  /** Coarse, non-throttled notes worth logging (repo started, file skipped, …). */
  onLog?: (message: string) => void;
}

/** What one repo of the set contributed, as recorded in the manifest. */
export interface SnapshotRepoResult {
  repo: string;
  dir: string;
  files: SnapshotFile[];
}

export interface SnapshotResult {
  repos: SnapshotRepoResult[];
  /** Every file, path relative to `dest` (so extras carry their `dir` prefix). */
  files: SnapshotFile[];
  totalBytes: number;
  downloadedBytes: number;
}

/** The parsed `.complete` marker. `repos` is absent in markers written before extras existed. */
export interface CompleteManifest {
  repo?: string | null;
  totalBytes?: number;
  completedAt?: string;
  files?: SnapshotFile[];
  repos?: SnapshotRepoResult[];
}

export class AbortedError extends Error {
  constructor() {
    super('Download cancelled');
    this.name = 'AbortedError';
  }
}

export function isAborted(err: unknown): boolean {
  if (err instanceof AbortedError) return true;
  return err instanceof Error && (err.name === 'AbortError' || err.name === 'AbortedError');
}

/**
 * huggingface_hub matches allow_patterns with fnmatch over the whole relative
 * path, so `*` crosses `/` and a pattern without a slash still has to match the
 * full path (hence `*.json` matching only top-level files, `**` unnecessary).
 */
export function globToRegExp(pattern: string): RegExp {
  let out = '';
  for (const ch of pattern) {
    if (ch === '*') out += '.*';
    else if (ch === '?') out += '.';
    else out += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}

export function matchesAllowPatterns(filePath: string, patterns: string[] | undefined): boolean {
  if (!patterns || patterns.length === 0) return true;
  return patterns.some((p) => globToRegExp(p).test(filePath));
}

interface TreeItem {
  type?: 'file' | 'directory';
  path?: string;
  size?: number;
  lfs?: { size?: number };
}

function authHeaders(token: string | undefined): Record<string, string> {
  const key = token ?? process.env['HF_TOKEN'];
  return key ? { Authorization: `Bearer ${key}` } : {};
}

function httpError(status: number, repo: string, what: string): Error {
  if (status === 401 || status === 403) {
    // Hugging Face answers 401 for a private repo and for one that does not
    // exist alike, so the message has to cover both.
    return new Error(
      `${repo} is gated, private or missing (HTTP ${status}). If it is gated, accept the licence on huggingface.co and set HF_TOKEN before starting Local Mesh.`
    );
  }
  if (status === 404) return new Error(`Not found on Hugging Face: ${what} (HTTP 404).`);
  return new Error(`Hugging Face returned HTTP ${status} for ${what}.`);
}

/** `<url>; rel="next"` out of a Link header, if there is one. */
function nextLink(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(',')) {
    const m = /<([^>]+)>\s*;\s*rel="?next"?/.exec(part.trim());
    if (m) return m[1] ?? null;
  }
  return null;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new AbortedError();
}

/** Every file in the repo at `main`, following the API's Link pagination. */
export async function listRepoFiles(
  repo: string,
  opts: { token?: string; signal?: AbortSignal } = {}
): Promise<SnapshotFile[]> {
  const files: SnapshotFile[] = [];
  let url: string | null = `${API_BASE}/api/models/${repo}/tree/main?recursive=true`;
  const headers = authHeaders(opts.token);
  while (url) {
    throwIfAborted(opts.signal);
    const res: Response = await fetch(url, { headers, ...(opts.signal ? { signal: opts.signal } : {}) });
    if (!res.ok) throw httpError(res.status, repo, `the file list for ${repo}`);
    const items = (await res.json()) as TreeItem[];
    for (const item of items) {
      if (item.type !== 'file' || !item.path) continue;
      files.push({ path: item.path, size: item.lfs?.size ?? item.size ?? 0 });
    }
    url = nextLink(res.headers.get('link'));
  }
  return files;
}

function fileSize(file: string): number {
  try {
    const stat = fs.statSync(file);
    return stat.isFile() ? stat.size : 0;
  } catch {
    return 0;
  }
}

async function closeStream(stream: fs.WriteStream): Promise<void> {
  if (stream.destroyed) return;
  await new Promise<void>((resolve) => stream.end(resolve));
}

interface FileContext {
  repo: string;
  dest: string;
  headers: Record<string, string>;
  signal: AbortSignal | undefined;
  /**
   * Absolute bytes-on-disk for one file. Absolute rather than a delta so a
   * retry that re-reads the `.part` cannot double-count what it already added.
   */
  setFileBytes: (file: string, bytes: number) => void;
}

/**
 * Stream one file to `<dest>/<path>.part`, resuming from whatever is already
 * there, then rename. Returns the number of bytes pulled over the network.
 */
async function downloadFile(file: SnapshotFile, ctx: FileContext): Promise<number> {
  const final = path.join(ctx.dest, file.path);
  const part = `${final}.part`;
  fs.mkdirSync(path.dirname(final), { recursive: true });

  let onDisk = fileSize(part);
  if (file.size > 0 && onDisk > file.size) {
    // A stale .part from a different revision; start over rather than guess.
    fs.rmSync(part, { force: true });
    onDisk = 0;
  }
  if (file.size > 0 && onDisk === file.size) {
    fs.renameSync(part, final);
    ctx.setFileBytes(file.path, file.size);
    return 0;
  }
  ctx.setFileBytes(file.path, onDisk);

  throwIfAborted(ctx.signal);
  const url = `${API_BASE}/${ctx.repo}/resolve/main/${file.path.split('/').map(encodeURIComponent).join('/')}`;
  const headers = { ...ctx.headers, ...(onDisk > 0 ? { Range: `bytes=${onDisk}-` } : {}) };
  const res = await fetch(url, { headers, ...(ctx.signal ? { signal: ctx.signal } : {}) });
  if (!res.ok) throw httpError(res.status, ctx.repo, `${ctx.repo}/${file.path}`);
  if (!res.body) throw new Error(`Empty response body for ${file.path}.`);

  // 206 continues where we left off; anything else (a server that ignores Range)
  // means the bytes start at zero again.
  const resuming = res.status === 206 && onDisk > 0;
  const base = resuming ? onDisk : 0;
  if (!resuming) ctx.setFileBytes(file.path, 0);

  const stream = fs.createWriteStream(part, { flags: resuming ? 'a' : 'w' });
  let received = 0;
  try {
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      if (!stream.write(chunk)) await once(stream, 'drain');
      received += chunk.byteLength;
      ctx.setFileBytes(file.path, base + received);
    }
  } finally {
    await closeStream(stream);
  }
  throwIfAborted(ctx.signal);
  fs.renameSync(part, final);
  return received;
}

/** Retry around downloadFile; each attempt resumes from the surviving `.part`. */
async function downloadFileWithRetries(file: SnapshotFile, ctx: FileContext, onLog?: (m: string) => void): Promise<number> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= ATTEMPTS_PER_FILE; attempt++) {
    try {
      return await downloadFile(file, ctx);
    } catch (err) {
      if (isAborted(err) || ctx.signal?.aborted) throw new AbortedError();
      lastError = err;
      // A 4xx will not fix itself; only transport failures are worth retrying.
      const message = err instanceof Error ? err.message : String(err);
      if (/HTTP (4\d\d)/.test(message)) throw err;
      if (attempt < ATTEMPTS_PER_FILE) {
        onLog?.(`${file.path}: ${message} — retrying (${attempt + 1}/${ATTEMPTS_PER_FILE})`);
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

interface RepoPlan {
  repo: string;
  dir: string;
  /** Absolute directory the repo's files land in. */
  target: string;
  files: SnapshotFile[];
  bytes: number;
}

/** Destination-relative path of a repo-relative file. */
function destPath(dir: string, file: string): string {
  return dir ? `${dir}/${file}` : file;
}

/**
 * Fetch every repo in the set into `dest`, resuming partial downloads. Each
 * tree is listed before anything is fetched so `totalBytes` covers the whole
 * set rather than jumping as each repo starts. Files already on disk at their
 * final size are skipped, which is what makes "resume" cheap: a run over a set
 * whose main repo is complete only pays for the missing extras.
 *
 * On success writes one `<dest>/.complete` listing every repo and file.
 */
export async function downloadSnapshot(opts: DownloadSnapshotOptions): Promise<SnapshotResult> {
  const { repos, dest, token, signal, onProgress, onLog } = opts;
  throwIfAborted(signal);
  if (repos.length === 0) throw new Error('No repositories to download.');
  fs.mkdirSync(dest, { recursive: true });

  const plans: RepoPlan[] = [];
  for (const spec of repos) {
    throwIfAborted(signal);
    const dir = spec.dir ?? '';
    const all = await listRepoFiles(spec.repo, { ...(token ? { token } : {}), ...(signal ? { signal } : {}) });
    const files = all.filter((f) => matchesAllowPatterns(f.path, spec.allowPatterns));
    if (files.length === 0) {
      throw new Error(
        `No files in ${spec.repo} matched the download patterns (${(spec.allowPatterns ?? ['*']).join(', ')}).`
      );
    }
    const bytes = files.reduce((sum, f) => sum + f.size, 0);
    onLog?.(`${spec.repo}: ${files.length} of ${all.length} files selected, ${bytes} bytes → ${dir || '.'}`);
    plans.push({ repo: spec.repo, dir, target: dir ? path.join(dest, dir) : dest, files, bytes });
  }

  const totalBytes = plans.reduce((sum, p) => sum + p.bytes, 0);
  let downloadedBytes = 0;
  let lastEmit = 0;
  // Keyed by destination-relative path: the same filename can appear in two repos.
  const counted = new Map<string, number>();
  const report = (file: string, force = false) => {
    const now = Date.now();
    if (!force && now - lastEmit < PROGRESS_INTERVAL_MS) return;
    lastEmit = now;
    onProgress?.({ downloadedBytes, totalBytes, file });
  };
  const headers = authHeaders(token);

  for (const plan of plans) {
    fs.mkdirSync(plan.target, { recursive: true });
    const ctx: FileContext = {
      repo: plan.repo,
      dest: plan.target,
      headers,
      signal,
      setFileBytes: (file, bytes) => {
        const key = destPath(plan.dir, file);
        downloadedBytes += bytes - (counted.get(key) ?? 0);
        counted.set(key, bytes);
        report(key);
      },
    };

    // Files already on disk at their final size never touch the network.
    const pending: SnapshotFile[] = [];
    for (const file of plan.files) {
      const existing = fileSize(path.join(plan.target, file.path));
      if (existing > 0 && (file.size === 0 || existing === file.size)) {
        ctx.setFileBytes(file.path, existing);
        continue;
      }
      pending.push(file);
    }
    if (pending.length < plan.files.length) {
      onLog?.(`${plan.repo}: ${plan.files.length - pending.length} files already present`);
    }
    report('', true);
    if (pending.length === 0) continue;
    onLog?.(`${plan.repo}: fetching ${pending.length} files into ${plan.target}`);

    let next = 0;
    const worker = async (): Promise<void> => {
      for (;;) {
        throwIfAborted(signal);
        const file = pending[next++];
        if (!file) return;
        onLog?.(`${plan.repo}: fetching ${file.path} (${file.size} bytes)`);
        await downloadFileWithRetries(file, ctx, onLog);
        report(destPath(plan.dir, file.path), true);
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL_FILES, pending.length) }, worker));
    throwIfAborted(signal);
  }

  const files = plans.flatMap((p) => p.files.map((f) => ({ path: destPath(p.dir, f.path), size: f.size })));
  const manifest: CompleteManifest = {
    repo: plans[0]?.repo ?? null,
    totalBytes,
    completedAt: new Date().toISOString(),
    repos: plans.map((p) => ({ repo: p.repo, dir: p.dir, files: p.files })),
    files,
  };
  fs.writeFileSync(path.join(dest, COMPLETE_MARKER), `${JSON.stringify(manifest, null, 2)}\n`);
  report('', true);
  return { repos: manifest.repos ?? [], files, totalBytes, downloadedBytes };
}

/** The `.complete` marker in `dest`, or null when it is absent or unreadable. */
export function readCompleteManifest(dest: string): CompleteManifest | null {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dest, COMPLETE_MARKER), 'utf-8')) as unknown;
    if (!raw || typeof raw !== 'object') return null;
    return raw as CompleteManifest;
  } catch {
    return null;
  }
}

/**
 * True when a `.complete` written earlier still accounts for everything the
 * registry asks for now. A marker written before a model grew an extra repo
 * lists only the main one, so the model reads as `partial` and the next
 * download fetches just what is missing.
 */
export function manifestCoversRepos(manifest: CompleteManifest | null, required: SnapshotRepo[]): boolean {
  if (!manifest) return false;
  const present = manifest.repos?.length
    ? manifest.repos.map((r) => ({ repo: r.repo, dir: r.dir ?? '', files: r.files ?? [] }))
    : [{ repo: manifest.repo ?? '', dir: '', files: manifest.files ?? [] }];
  return required.every((spec) =>
    present.some((p) => p.repo === spec.repo && p.dir === (spec.dir ?? '') && p.files.length > 0)
  );
}
