import { defineConfig } from 'vitest/config';

// The capture gate, the redaction pass and the fingerprint scorer are the three
// places where a bug is invisible in manual testing and expensive in
// production, so they get real unit tests.
//
// happy-dom rather than node: shouldCapture takes a live Element and walks
// labels, forms and shadow roots. Testing it against real HTML strings is worth
// far more than testing a hand-rolled descriptor object that cannot be wrong in
// the ways real markup is.
export default defineConfig({
  test: {
    globals: true,
    environment: 'happy-dom',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
  },
});
