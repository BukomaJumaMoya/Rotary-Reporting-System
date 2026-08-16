import { defineConfig } from 'vitest/config';

/**
 * The web suite, kept apart from `vite.config.ts` on purpose.
 *
 * Loading the app config would drag in the PWA plugin, Tailwind and the React refresh
 * transform for a suite that tests none of them — and `vite-plugin-pwa` generates a service
 * worker on every run, which is a slow way to test an IndexedDB queue.
 */
export default defineConfig({
  test: {
    // Node, not jsdom. Booting jsdom costs the best part of a minute here and the outbox
    // touches none of it — `fake-indexeddb` installs real IndexedDB globals either way. A
    // test that genuinely needs a DOM asks for one with `// @vitest-environment jsdom` at
    // the top of its own file.
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
