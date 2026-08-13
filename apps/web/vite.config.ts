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
    // Members report from metered Android data: the initial JS budget is 250 KB
    // (CLAUDE.md). Warn as soon as a chunk approaches it rather than at Vite's 500 KB.
    chunkSizeWarningLimit: 250,
  },
});
