import { env } from '../config/env';
import { createDb } from './connect';

export type { Database, Transaction } from './connect';

const app = createDb(env.DATABASE_URL);

/** Connection as the least-privileged `clinic_app` role; subject to row-level security. */
export const db = app.db;
export const dbClient = app.client;
