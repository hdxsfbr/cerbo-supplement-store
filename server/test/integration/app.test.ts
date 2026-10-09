import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createTestContext, type TestContext } from './helpers.js';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.teardown();
});

describe('app shell (T010)', () => {
  it('GET /api/health reports ok + migration status', async () => {
    const res = await api(ctx.app, 'GET', '/api/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.migrations.applied).toBeGreaterThanOrEqual(6);
    expect(res.body.migrations.latest).toBe('008_supplement_list_and_requests.sql');
  });

  it('unknown API route → 404 error envelope', async () => {
    const res = await api(ctx.app, 'GET', '/api/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'not_found', message: expect.any(String) } });
  });

  it('seeds are present in the fresh test database', async () => {
    const [row] = await ctx.sql<
      { count: number }[]
    >`SELECT count(*)::int AS count FROM supplements`;
    expect(row?.count).toBe(8);
  });
});
