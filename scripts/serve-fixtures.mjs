/**
 * Serves the fixture page so you can try it by hand.
 *
 *   npm run fixtures
 *
 * Two origins, because one of them is the cross-origin iframe case and a single
 * server can only ever produce same-origin frames.
 */
import { startFixtureServer } from './lib/fixture-server.mjs';

const { base, crossOrigin, close } = await startFixtureServer();

console.log(`
  Draft Rescue fixtures

    ${base}/fixtures.html

  The second origin, for the cross-origin iframe, is ${crossOrigin}.

  Load the DEV build (.output/chrome-mv3-dev) so the console explains its
  refusals, then open the page and type into every box. Green sections must end
  up in the popup; red sections must not.

  Ctrl+C to stop.
`);

const stop = () => {
  close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
