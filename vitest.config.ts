// Unit tests (npm test): tests/unit/*.test.ts. The integration and browser tests are plain Node scripts
// (npm run test:integration / test:e2e) because they start the real server and Chrome.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['tests/unit/**/*.test.ts'] },
});
