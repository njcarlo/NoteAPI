import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    server: 'src/server.ts',
    worker: 'src/worker.ts',
    'db/migrate': 'src/db/migrate.ts',
    'db/seed': 'src/db/seed.ts',
    'scripts/create-platform-admin': 'src/scripts/create-platform-admin.ts',
  },
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  clean: true,
  sourcemap: true,
  noExternal: ['@clinic/shared'],
});
