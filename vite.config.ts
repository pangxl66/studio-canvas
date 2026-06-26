import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

function manualChunks(id: string): string | undefined {
  const normalized = id.replace(/\\/g, '/');
  if (!normalized.includes('/node_modules/')) return undefined;

  if (
    normalized.includes('/html2pdf.js/') ||
    normalized.includes('/jspdf/') ||
    normalized.includes('/html2canvas/') ||
    normalized.includes('/dompurify/') ||
    normalized.includes('/canvg/') ||
    normalized.includes('/rgbcolor/') ||
    normalized.includes('/fflate/')
  ) {
    return 'vendor-pdf';
  }

  if (normalized.includes('/@supabase/') || normalized.includes('/@realtime/')) return 'vendor-supabase';
  if (normalized.includes('/xlsx/')) return 'vendor-xlsx';
  if (normalized.includes('/docx/') || normalized.includes('/file-saver/')) return 'vendor-export';

  return 'vendor';
}

export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks,
      },
    },
  },
});
