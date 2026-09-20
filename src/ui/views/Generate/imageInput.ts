import type React from 'react';
import { api } from '../../stores/createStore';

/**
 * The two ways an image gets into the app, kept apart from any component
 * because both the whole view (drop anywhere to add jobs) and a single job row
 * (drop here to set this job's image) need them.
 */

/**
 * Absolute paths of the image files in a drag event. Electron resolves them
 * through webUtils; in a plain browser there is no path, so nothing lands.
 */
export function imagePathsFromDrop(event: React.DragEvent): string[] {
  const electron = api();
  if (!electron) return [];
  return Array.from(event.dataTransfer.files)
    .filter((file) => file.type.startsWith('image/'))
    .map((file) => electron.getPathForFile(file))
    .filter((path): path is string => Boolean(path));
}

/** True when a drag is carrying files at all — the only thing we can tell before the drop. */
export function dragHasFiles(event: React.DragEvent): boolean {
  return event.dataTransfer.types.includes('Files');
}

export async function pickImages(): Promise<string[]> {
  return (await api()?.pickImages()) ?? [];
}
