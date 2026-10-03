import { parseArgs } from 'node:util';
import { z } from 'zod';
import { createDb } from '../db/connect';
import { provisionClinic } from '../db/provision';
import { randomToken } from '../lib/crypto';

const { values } = parseArgs({
  options: {
    name: { type: 'string' },
    slug: { type: 'string' },
    'admin-name': { type: 'string' },
    'admin-email': { type: 'string' },
    doctor: { type: 'boolean', default: false },
    'prc-no': { type: 'string' },
  },
});

const args = z
  .object({
    name: z.string().min(1),
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'lowercase letters, digits and dashes'),
    'admin-name': z.string().min(1),
    'admin-email': z.email(),
    doctor: z.boolean(),
    'prc-no': z.string().optional(),
  })
  .refine((v) => !v.doctor || v['prc-no'], { message: '--prc-no is required with --doctor' })
  .parse(values);

const url = process.env.MIGRATION_DATABASE_URL;
if (!url) throw new Error('MIGRATION_DATABASE_URL is required');

const { db, client } = createDb(url, 1);
const password = randomToken(12);
try {
  const { clinic, user } = await provisionClinic(db, {
    clinic: { slug: args.slug, name: args.name },
    admin: {
      name: args['admin-name'],
      email: args['admin-email'],
      password,
      roles: args.doctor ? ['admin', 'doctor'] : ['admin'],
      doctor: args.doctor ? { prcNo: args['prc-no'] as string } : undefined,
    },
  });
  console.log(`Created clinic "${clinic.name}" (/c/${clinic.slug})`);
  console.log(`Admin: ${user.email}`);
  console.log(`Temporary password (shown once): ${password}`);
} finally {
  await client.end();
}
