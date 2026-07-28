import { defineConfig } from 'tsdown'

export default defineConfig({
  clean: true,
  target: 'es2022',
  // `cli.ts` is the runnable CLI binary; `index.ts` is the library entry that
  // re-exports helpers (createResolver, MigrationContext, …) consumed by
  // mx-core specs.
  entry: ['src/cli.ts', 'src/index.ts'],
  outDir: 'dist',
  dts: { eager: true },
  format: ['esm'],
  platform: 'node',
  // Inline every runtime dependency so the produced CLI is a single runnable
  // file. Keep third-party declaration files external: bundling Drizzle's
  // conditional .d.ts graph makes rolldown treat type-only exports as values.
  deps: {
    alwaysBundle: () => true,
    dts: {
      neverBundle: [/.*/],
    },
  },
  sourcemap: true,
  shims: true,
})
