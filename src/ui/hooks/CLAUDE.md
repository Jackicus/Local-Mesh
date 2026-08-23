# hooks/

One concern per hook (`useX.ts`), re-exported from `index.ts`. Guard `window.electronAPI` access so the UI still runs in a plain browser.
