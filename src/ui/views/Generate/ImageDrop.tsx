import React, { useState } from 'react';
import { Button } from '../../components';
import { ImagePlusIcon } from '../../assets/icons';
import { api } from '../../stores/createStore';
import { DockSection } from './DockSection';
import { Thumbnail } from './Thumbnail';
import { useViewerStore } from './viewerStore';

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

export async function pickImages(): Promise<string[]> {
  return (await api()?.pickImages()) ?? [];
}

/** Staging for the sources: one job will be queued per image here. */
export const ImageDrop: React.FC = () => {
  const [viewer, viewerActions] = useViewerStore();
  const [over, setOver] = useState(false);

  return (
    <DockSection
      title="Images"
      meta={viewer.images.length || undefined}
      action={
        viewer.images.length > 0 ? (
          <Button variant="subtle" size="sm" onClick={viewerActions.clearImages}>
            Clear
          </Button>
        ) : undefined
      }
    >
      {/* The view itself handles the drop for the whole window; this zone only
          says where to aim, so it must not swallow the event. */}
      <div
        className={`gen-drop ${over ? 'is-over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={() => setOver(false)}
      >
        <ImagePlusIcon size={18} />
        <p className="gen-drop-title">Drop images here</p>
        <p className="gen-drop-hint">One mesh per image</p>
      </div>

      {viewer.images.length > 0 && (
        <div className="gen-thumb-grid">
          {viewer.images.map((path) => (
            <Thumbnail key={path} path={path} onRemove={() => viewerActions.removeImage(path)} />
          ))}
        </div>
      )}

      <Button
        variant="secondary"
        size="sm"
        fullWidth
        onClick={async () => viewerActions.addImages(await pickImages())}
      >
        Choose images
      </Button>
    </DockSection>
  );
};
