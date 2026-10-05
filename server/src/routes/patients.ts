// Patients of the acting provider (identity seam) — feeds the order builder's patient picker.

import type { FastifyInstance } from 'fastify';
import { requireProvider } from '../app.js';

export interface PatientRow {
  id: number;
  name: string;
  email: string | null;
}

export async function patientsRoutes(app: FastifyInstance): Promise<void> {
  const { sql } = app.deps;

  app.get('/api/patients', async (req) => {
    const provider = await requireProvider(req);
    const patients = await sql<PatientRow[]>`
      SELECT id, name, email FROM patients WHERE provider_id = ${provider.id} ORDER BY name`;
    return { provider: { id: provider.id, name: provider.name }, patients };
  });
}
