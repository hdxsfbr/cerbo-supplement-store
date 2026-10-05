// Environment-driven config. Read once at boot; nothing else touches process.env.

export interface Config {
  databaseUrl: string;
  port: number;
  nodeEnv: 'development' | 'test' | 'production';
  logLevel: string;
  /** Origin the patient-facing checkout links should point at (the "email" stub prints these). */
  publicWebOrigin: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const nodeEnv = (env.NODE_ENV ?? 'development') as Config['nodeEnv'];
  const databaseUrl = env.DATABASE_URL ?? 'postgres://cerbo:cerbo@localhost:5432/cerbo_store';
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port <= 0) throw new Error(`Invalid PORT: ${env.PORT}`);
  return {
    databaseUrl,
    port,
    nodeEnv,
    logLevel: env.LOG_LEVEL ?? (nodeEnv === 'test' ? 'silent' : 'info'),
    publicWebOrigin:
      env.PUBLIC_WEB_ORIGIN ?? `http://localhost:${nodeEnv === 'production' ? port : 5173}`,
  };
}
