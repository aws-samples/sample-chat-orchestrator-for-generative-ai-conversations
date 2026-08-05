module.exports = {
  roots: ['<rootDir>/lib/lambdas/handlers/node/response-generators/__tests__'],
  testMatch: ['**/*.test.ts', '**/*.test.mjs'],
  transform: {
    '^.+\\.tsx?$': 'ts-jest',
    '^.+\\.mjs$': ['babel-jest', { presets: [['@babel/preset-env', { targets: { node: 'current' } }]] }]
  },
  transformIgnorePatterns: [
    '/node_modules/(?!fast-check)'
  ]
};
