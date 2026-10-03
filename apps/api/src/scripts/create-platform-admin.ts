import { parseArgs } from 'node:util';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { createDb } from '../db/connect';
import { upsertPerson } from '../db/provision';
import { users } from '../db/schema';
import { randomToken } from '../lib/crypto';

const { values } = parseArgs({ options: { name: { type: 'string' }, email: { type: 'string' } } });
const args = z.object({ name: z.string().min(1), email: z.email() }).parse(values);

const url = process.env.MIGRATION_DATABASE_URL;
if (!url) throw new Error('MIGRATION_DATABASE_URL is required');

const { db, client } = createDb(url, 1);
const password = randomToken(12);
try {
  const { id, created } = await upsertPerson(db, { ...args, password, isPlatformAdmin: true });
  await db.update(users).set({ isPlatformAdmin: true }).where(eq(users.id, id));
  console.log(`Platform admin: ${args.email}`);
  console.log(
    created
      ? `Temporary password (shown once): ${password}`
      : 'Existing account promoted; password unchanged.',
  );
} finally {
  await client.end();
}
