import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

// Pure-logic tests only (money helpers, Pinia store with a mocked API). Component rendering is
// verified by the headless browser run documented in quickstart.md, not by a DOM test suite.
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: { include: ['test/**/*.test.ts'], environment: 'node' },
});
