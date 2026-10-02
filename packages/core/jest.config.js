module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: {
        module: 'CommonJS',
        moduleResolution: 'bundler',
        isolatedModules: true,
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        strict: true,
        skipLibCheck: true,
        resolveJsonModule: true,
        types: ['jest', 'node']
      }
    }]
  },
  transformIgnorePatterns: [
    'node_modules/(?!(ulid)/)'
  ],
  moduleNameMapper: {
    '^uuid$': '<rootDir>/src/__tests__/__mocks__/uuid.ts'
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/__tests__/**',
    '!src/examples*.ts',
    '!src/*-examples.ts',
    '!src/cli*.ts',
    '!src/integration-demo.ts',
    '!src/test-*.ts'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  verbose: true,
  testTimeout: 10000
};
