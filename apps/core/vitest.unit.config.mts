import { resolve } from 'node:path'

import swc from 'unplugin-swc'
import tsconfigPath from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

/**
 * Fast unit-test configuration.
 *
 * The default Core test config boots disposable PostgreSQL and Redis services
 * for every run. Pure service tests that mock repositories do not need that
 * infrastructure, so this config deliberately omits the global container
 * setup and database lifecycle hooks.
 */
export default defineConfig({
  root: './test',
  test: {
    include: ['**/*.spec.ts'],
    exclude: ['**/*.e2e-spec.ts', '**/node_modules/**', '**/.git/**'],
    globals: true,
    setupFiles: [resolve(__dirname, './test/setup-global.ts')],
    environment: 'node',
  },
  resolve: {
    alias: {
      '~/app.config': resolve(__dirname, './src/app.config.test.ts'),
      '~/common/decorators/auth.decorator': resolve(
        __dirname,
        './test/mock/decorators/auth.decorator.ts',
      ),
    },
  },
  esbuild: false,
  define: {
    __DEV__: 'true',
    __TEST__: 'true',
  },
  plugins: [
    swc.vite(),
    tsconfigPath({
      projects: [
        resolve(__dirname, './test/tsconfig.json'),
        resolve(__dirname, './tsconfig.json'),
      ],
    }),
  ],
})
