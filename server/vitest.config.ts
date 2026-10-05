import { defineConfig } from 'vitest/config';

// Two projects: `unit` is pure (money math, no DB); `integration` needs DATABASE_URL and a live
// Postgres (docker compose up db). Keep money-math tests runnable with zero infra.
export default defineConfig({
  test: {
    // Integration tests share one database; never run their files concurrently.
    fileParallelism: false,
    projects: [
      {
        test: {
          name: 'unit',
          include: ['test/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'integration',
          include: ['test/integration/**/*.test.ts'],
          environment: 'node',
          testTimeout: 20_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
