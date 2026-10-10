// Catalog: the practice's supplement list with cost basis and default price. The practice
// drop-ships (DECISIONS #19): COGS is the supplier's landed unit price, and there is no stock.

import type { FastifyInstance } from 'fastify';
import { requireProvider } from '../app.js';

export interface SupplementRow {
  id: number;
  name: string;
  sku: string | null;
  unit_cogs_cents: number;
  default_price_cents: number;
}

export async function catalogRoutes(app: FastifyInstance): Promise<void> {
  const { sql } = app.deps;

  app.get('/api/supplements', async (req) => {
    await requireProvider(req);
    const supplements = await sql<SupplementRow[]>`
      SELECT id, name, sku, unit_cogs_cents, default_price_cents
      FROM supplements ORDER BY name`;
    return { supplements };
  });
}
