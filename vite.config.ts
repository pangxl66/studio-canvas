import { defineConfig } from 'vite';
import type { Plugin, PreviewServer, ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import { createRequire } from 'node:module';
import path from 'path';

const require = createRequire(import.meta.url);

type LocalApiServer = ViteDevServer | PreviewServer;

function attachLocalApi(
  server: LocalApiServer,
  options: { cacheBuiltAssets?: boolean } = {},
): void {
  const { route } = require('./server/index.cjs') as {
    route: (
      req: Parameters<ViteDevServer['middlewares']['handle']>[0],
      res: Parameters<ViteDevServer['middlewares']['handle']>[1],
    ) => Promise<void>;
  };
  server.middlewares.use((req, res, next) => {
    const pathname = (req.url ?? '').split('?', 1)[0];
    if (options.cacheBuiltAssets && pathname.startsWith('/assets/')) {
      res.setHeader('cache-control', 'public, max-age=31536000, immutable');
    }
    if (
      pathname !== '/api'
      && !pathname.startsWith('/api/')
      && pathname !== '/supabase'
      && !pathname.startsWith('/supabase/')
    ) {
      next();
      return;
    }
    void route(req, res);
  });
}

function localApiPlugin(): Plugin {
  return {
    name: 'studio-canvas-local-api',
    apply: 'serve',
    configureServer(server: ViteDevServer) {
      attachLocalApi(server);
    },
    configurePreviewServer(server: PreviewServer) {
      attachLocalApi(server, { cacheBuiltAssets: true });
    },
  };
}

function manualChunks(id: string): string | undefined {
  const normalized = id.replace(/\\/g, '/');
  if (normalized.includes('vite/preload-helper')) return 'app-runtime';
  if (
    normalized.includes('/src/services/skillLoader.ts') ||
    normalized.includes('/src/skills/')
  ) {
    return 'studio-skills';
  }
  if (!normalized.includes('/node_modules/')) return undefined;

  if (normalized.includes('/fflate/')) return 'vendor-compression';

  if (normalized.includes('/html2pdf.js/')) return 'vendor-pdf-export';
  if (normalized.includes('/html2canvas/')) return 'vendor-html2canvas';
  if (normalized.includes('/jspdf/')) return 'vendor-jspdf';
  if (normalized.includes('/dompurify/')) return 'vendor-pdf-sanitize';
  if (normalized.includes('/canvg/')) return 'vendor-canvg';
  if (normalized.includes('/rgbcolor/')) return 'vendor-svg-color';
  if (
    normalized.includes('/pako/') ||
    normalized.includes('/fast-png/') ||
    normalized.includes('/iobuffer/') ||
    normalized.includes('/svg-pathdata/') ||
    normalized.includes('/stackblur-canvas/') ||
    normalized.includes('/core-js/')
  ) {
    return 'vendor-pdf-support';
  }

  if (
    normalized.includes('/@supabase/') ||
    normalized.includes('/@realtime/') ||
    normalized.includes('/iceberg-js/')
  ) {
    return 'vendor-supabase';
  }
  if (
    normalized.includes('/read-excel-file/') ||
    normalized.includes('/unzipper-esm/') ||
    normalized.includes('/saxen/')
  ) {
    return 'vendor-xlsx';
  }
  if (normalized.includes('/docx/') || normalized.includes('/file-saver/')) return 'vendor-export';

  return 'vendor';
}

export default defineConfig({
  base: './',
  plugins: [react(), localApiPlugin()],
  server: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
  },
  resolve: {
    alias: [
      { find: '@', replacement: path.resolve(__dirname, 'src') },
      {
        find: /^html2pdf\.js$/,
        replacement: path.resolve(__dirname, 'node_modules/html2pdf.js/src/index.js'),
      },
    ],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks,
      },
    },
  },
});
