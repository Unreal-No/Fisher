import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { server: 'src/server.ts', seed: 'prisma/seed.ts', 'reset-password': 'src/cli/reset-password.ts' },
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // bundle workspace + generated prisma client; keep npm deps external
  noExternal: ['@fisher/shared'],
});
