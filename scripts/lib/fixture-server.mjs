/**
 * Serves test/ on TWO origins at once.
 *
 * Two, because one of this extension's central claims needs two to check.
 * A cross-origin iframe is not a limitation for us — Chrome injects a separate
 * copy of the content script into every frame, so we capture inside them
 * normally. What is impossible is reaching INTO a cross-origin frame from the
 * parent, which we never do.
 *
 * That claim shaped the architecture and it had gone unproven, because a single
 * server can only ever produce same-origin frames. Two ports on 127.0.0.1 are
 * two different origins as far as the browser is concerned, which is all it
 * takes.
 *
 * `__CROSS_ORIGIN__` in any served HTML is replaced with the other origin, so
 * the fixture page does not need to know which ports it landed on.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '../../test');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
};

function listen(server, port) {
  return new Promise((done) => server.listen(port, '127.0.0.1', () => done()));
}

function handler(getOtherOrigin) {
  return async (req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    const file = join(FIXTURES, path === '/' ? 'fixtures.html' : path);

    // Never serve outside test/, even from a throwaway server.
    if (!file.startsWith(FIXTURES)) {
      res.writeHead(403).end('forbidden');
      return;
    }

    let body;
    try {
      body = await readFile(file);
    } catch {
      res.writeHead(404).end('not found');
      return;
    }

    const type = TYPES[extname(file)] ?? 'text/plain';
    if (type.startsWith('text/html')) {
      body = Buffer.from(
        body.toString('utf8').replaceAll('__CROSS_ORIGIN__', getOtherOrigin()),
      );
    }

    res.writeHead(200, { 'content-type': type }).end(body);
  };
}

/**
 * @returns {Promise<{ base: string, crossOrigin: string, close: () => void }>}
 */
export async function startFixtureServer() {
  let baseOrigin = '';
  let otherOrigin = '';

  // Each server's placeholder resolves to the OTHER one, so an iframe from
  // either side is genuinely cross-origin.
  const main = createServer(handler(() => otherOrigin));
  const other = createServer(handler(() => baseOrigin));

  await Promise.all([listen(main, 0), listen(other, 0)]);

  baseOrigin = `http://127.0.0.1:${main.address().port}`;
  otherOrigin = `http://127.0.0.1:${other.address().port}`;

  return {
    base: baseOrigin,
    crossOrigin: otherOrigin,
    close() {
      main.close();
      other.close();
    },
  };
}
