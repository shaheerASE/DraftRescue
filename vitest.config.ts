import { defineConfig } from 'vitest/config';

// Vitest here is deliberately NOT running the extension. It runs the pure
// functions the extension depends on — shouldCapture, the redaction pass, the
// fingerprint scorer. Those are the parts where a bug is invisible in manual
// testing and catastrophic in production.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
  },
});
