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
                "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; frame-src 'none'",
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
  build: {
    // Never inline fonts. The build CSP keeps font-src at 'self', so a subset
    // small enough for Vite to inline would ship as a data: URI and be blocked
    // at runtime. Returning undefined leaves other assets on the default limit.
    assetsInlineLimit: (filePath: string) =>
      /\.(woff2?|ttf|otf|eot)$/i.test(filePath) ? false : undefined,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
  },
});
