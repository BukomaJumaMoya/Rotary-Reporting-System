import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      // The API is a separate process. Proxying it in development keeps the browser on
      // a single origin, so the session cookie behaves exactly as it will in production.
      '/api': { target: 'http://localhost:4000' },
    },
  },
  build: {
    // Members report from metered Android data. The budget in CLAUDE.md is 250 KB of
    // initial JS, measured GZIPPED — which is what crosses the wire.
    //
    // This limit measures RAW bytes, so it is not the budget: it is an early smell,
    // tuned to fire well before the gzipped figure is anywhere near 250 KB. Roughly
    // 3.3× compression on this bundle means 400 KB raw is about 120 KB gzipped.
    // `npm run build` prints the gzipped number; that is the one to read.
    chunkSizeWarningLimit: 400,
  },
});
