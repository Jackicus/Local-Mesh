import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, BrowserWindow, dialog, shell } from 'electron';
import type { LocalMeshPaths } from '../core/types';

export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'bmp'] as const;
const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  bmp: 'image/bmp',
};
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

let cached: LocalMeshPaths | null = null;

/**
 * Everything user-owned lives under ~/.local-mesh (LOCAL_MESH_ROOT overrides it
 * for testing). `scripts` is the exception: the python worker ships inside the
 * app bundle and is run from there, never copied into the data directory.
 */
export function getPaths(): LocalMeshPaths {
  if (!cached) {
    const root = process.env['LOCAL_MESH_ROOT'] || path.join(os.homedir(), '.local-mesh');
    cached = {
      root,
      env: path.join(root, 'env'),
      scripts: path.join(app.getAppPath(), 'resources', 'python'),
      models: path.join(root, 'models'),
      outputs: path.join(root, 'outputs'),
      inputs: path.join(root, 'inputs'),
      pipelines: path.join(root, 'pipelines'),
      logs: path.join(root, 'logs'),
    };
  }
  return cached;
}

/** Git clones some backends import from; not part of the renderer-facing layout. */
export function getReposDir(): string {
  return path.join(getPaths().root, 'repos');
}

/**
 * rembg's model cache (`U2NET_HOME`). Kept under the data directory so the
 * background-removal ONNX file is ours to delete, rather than landing in
 * ~/.u2net. envManager pre-fetches u2netp here during setup: the worker runs
 * offline and would otherwise stall on a GitHub download mid-generation.
 */
export function getRembgDir(): string {
  return path.join(getPaths().root, 'rembg');
}

/**
 * `TORCH_HOME` for anything that goes through `torch.hub`. TRELLIS loads its
 * DINOv2 conditioner with `torch.hub.load('facebookresearch/dinov2', ...)`,
 * which is a GitHub clone plus a ~1.1 GB checkpoint from Meta — not Hugging
 * Face, so the weights step cannot fetch it. The model's `postInstall` hook
 * seeds it here and the worker reads it back offline.
 */
export function getTorchHubDir(): string {
  return path.join(getPaths().root, 'torch-hub');
}

/** Generated at every model dependency install: pins torch to the build setup chose. */
export function getConstraintsPath(): string {
  return path.join(getPaths().root, 'constraints.txt');
}

export function getSettingsPath(): string {
  return path.join(getPaths().root, 'settings.json');
}

export function ensureTree(): void {
  const p = getPaths();
  // `scripts` points into the read-only app bundle, so it is not ours to create.
  for (const dir of [
    p.root, p.env, p.models, p.outputs, p.inputs, p.pipelines, p.logs, getReposDir(), getRembgDir(),
    getTorchHubDir(),
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  // Builds before the worker moved into the bundle copied it here; it is dead weight now.
  fs.rmSync(path.join(p.root, 'scripts'), { recursive: true, force: true });
}

/** True when `target` resolves strictly inside `dir` (no `..` escapes, no symlink games on the prefix). */
export function isInside(dir: string, target: string): boolean {
  const rel = path.relative(path.resolve(dir), path.resolve(target));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

export function imageExtension(filePath: string): string | null {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  return (IMAGE_EXTENSIONS as readonly string[]).includes(ext) ? ext : null;
}

export function isImagePath(filePath: string): boolean {
  return imageExtension(filePath) !== null;
}

export async function pickImages(): Promise<string[]> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  const options: Electron.OpenDialogOptions = {
    title: 'Choose images',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Images', extensions: [...IMAGE_EXTENSIONS] }],
  };
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  return result.canceled ? [] : result.filePaths;
}

/** Data URL for an image file, or null when it isn't one / is too big / can't be read. */
export function readImageDataUrl(filePath: string): string | null {
  if (typeof filePath !== 'string') return null;
  const ext = imageExtension(filePath);
  if (!ext) return null;
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size > MAX_IMAGE_BYTES) return null;
    const bytes = fs.readFileSync(filePath);
    return `data:${IMAGE_MIME[ext]};base64,${bytes.toString('base64')}`;
  } catch {
    return null;
  }
}

/** Bytes of a generated mesh. Refuses anything outside outputs/. */
export function readOutputFile(filePath: string): ArrayBuffer | null {
  if (typeof filePath !== 'string' || !isInside(getPaths().outputs, filePath)) return null;
  try {
    const bytes = fs.readFileSync(filePath);
    // Copy into a fresh ArrayBuffer so the renderer receives a plain
    // ArrayBuffer rather than a view over Node's shared Buffer pool.
    const out = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(out).set(bytes);
    return out;
  } catch {
    return null;
  }
}

export async function openPath(target: string): Promise<void> {
  if (typeof target !== 'string' || !target) throw new Error('No path given.');
  const error = await shell.openPath(target);
  if (error) throw new Error(`Could not open ${target}: ${error}`);
}

export function showItemInFolder(target: string): void {
  if (typeof target !== 'string' || !target) throw new Error('No path given.');
  shell.showItemInFolder(target);
}

export async function openExternal(url: string): Promise<void> {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
    throw new Error('Only http(s) links can be opened.');
  }
  await shell.openExternal(url);
}
