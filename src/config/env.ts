import 'dotenv/config';
import { resolve } from 'node:path';

export type Env = {
  port: number;
  host: string;
  dataDir: string;
  publicBaseUrl: string;
  githubToken?: string;
  corsOrigin: string;
};

export function loadEnv(): Env {
  return {
    port: Number(process.env.ECHO_SERVER_PORT ?? 8080),
    host: process.env.ECHO_SERVER_HOST ?? '0.0.0.0',
    dataDir: resolve(process.env.ECHO_DATA_DIR ?? './data'),
    publicBaseUrl: (process.env.ECHO_PUBLIC_BASE_URL ?? 'http://localhost:8080').replace(/\/$/, ''),
    githubToken: process.env.ECHO_GITHUB_TOKEN || undefined,
    corsOrigin: process.env.ECHO_CORS_ORIGIN ?? '*',
  };
}
