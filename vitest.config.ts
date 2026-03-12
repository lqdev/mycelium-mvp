import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    passWithNoTests: true,
    // Run in forked child processes so Node.js built-ins (node:sqlite) are
    // resolved natively rather than through Vite's module transformer.
    pool: 'forks',
    poolOptions: {
      forks: {
        // Suppress the node:sqlite experimental warning in test output
        execArgv: ['--no-warnings'],
      },
    },
    coverage: {
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/demo/**'],
    },
  },
  // No plugins needed — node:sqlite is accessed via createRequire in src/db-sync.ts
  // to bypass Vite's static import analysis (node:sqlite is not in builtinModules).
});
