import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    server: 'src/server.ts',
    'db/migrate': 'src/db/migrate.ts',
    'db/seed': 'src/db/seed.ts',
    'scripts/create-clinic': 'src/scripts/create-clinic.ts',
  },
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  clean: true,
  sourcemap: true,
  noExternal: ['@clinic/shared'],
});
