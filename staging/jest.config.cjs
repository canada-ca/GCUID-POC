/*!
 * GCUID — Government of Canada Unique Identifier System
 *
 * @license
 * Copyright (c) 2024-2026 NOETRONIQ Strategic Initiatives. All rights reserved.
 * Author: Philippe R. Beauchamp <prb@noetroniq.com>
 *
 * Licensed for use and modification by the Treasury Board of Canada Secretariat.
 * See LICENSE in the project root for full terms.
 */
/**
 * Jest configuration for the staging API tests.
 *
 * Why a separate config: the staging project is ESM (`"type": "module"`,
 * `module: "ES2022"` in tsconfig) and most route files import with `.js`
 * extensions. ts-jest's `isolatedModules: true` lets us bypass full
 * type-checking here, matching the same pattern used in packages/core.
 */

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/api/__tests__'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  // Increase timeout — some tests do supertest + db seed + http-in-process.
  testTimeout: 30000,
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: {
        module: 'CommonJS',
        moduleResolution: 'bundler',
        isolatedModules: true,
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        strict: false,
        skipLibCheck: true,
        resolveJsonModule: true,
        types: ['jest', 'node'],
      },
    }],
  },
  transformIgnorePatterns: [
    'node_modules/(?!(ulid|uuid)/)',
  ],
  // The staging route files use ESM-style `.js` extensions when importing
  // TypeScript modules (required for native Node ESM, but ts-jest needs an
  // explicit hint). Map `.js` → `.ts` for paths that exist in our tree.
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  // Per-file test isolation: each test file gets its own temp dir via
  // setupTestEnv().  process.cwd() is global to the test file, but jest
  // runs each test file in its own context, so cwd changes don't leak.
  // We don't use --maxWorkers > 1 here to keep cwd management simple.
  maxWorkers: 1,
  collectCoverageFrom: [
    'api/routes/**/*.ts',
    '!api/**/*.d.ts',
    '!api/__tests__/**',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  verbose: true,
};
