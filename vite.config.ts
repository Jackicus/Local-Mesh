import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      // Build-only CSP (apply: 'build' skips the dev server, so Vite HMR and
      // the React refresh preamble keep working in dev)
      name: 'inject-csp',
      apply: 'build',
      transformIndexHtml() {
        return [
          {
            tag: 'meta',
            attrs: {
              'http-equiv': 'Content-Security-Policy',
              content:
                "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; frame-src 'none'",
            },
            injectTo: 'head-prepend',
          },
        ];
      },
    },
    electron([
      {
        // Main process entry file of the Electron App.
        entry: 'src/main/main.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            minify: false,
            rolldownOptions: {
              // Native module: loaded from node_modules at runtime, never bundled
              external: ['better-sqlite3'],
            },
          },
        },
      },
      {
        entry: 'src/preload/preload.ts',
        onstart(options) {
          // Notify the Renderer-Process to reload the page when the Preload-Scripts build is complete
          options.reload();
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            minify: false,
            // Sandboxed preload scripts must be CommonJS: the plugin's default ESM
            // output fails to load silently and window.electronAPI never appears.
            lib: false,
            rolldownOptions: {
              input: 'src/preload/preload.ts',
              output: {
                format: 'cjs',
                entryFileNames: '[name].js',
              },
            },
          },
        },
      },
    ]),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
  },
});
