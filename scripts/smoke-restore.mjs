/**
 * Restore engine, tested in a real browser against real editor behaviour.
 *
 *   npm run smoke:restore
 *
 * WHY THIS CANNOT BE A UNIT TEST
 * The two things this checks only exist in a browser:
 *
 *   `document.execCommand('insertText')` — no DOM implementation used for unit
 *   testing implements it, and it is the entire mechanism by which a rich
 *   editor's own model learns about our write.
 *
 *   The order in which a framework's value tracker, our prototype-level setter
 *   and the dispatched event interact — which is the difference between the
 *   app knowing about the restored text and silently submitting the old value.
 *
 * So restore.ts is bundled on its own and loaded into a plain page alongside
 * two fixtures that reproduce how real editors behave. No extension involved:
 * this is about whether the technique works, not whether the wiring does.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const FIXTURES = resolve(ROOT, 'test');

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('Playwright is not installed. Run: npm install');
  process.exit(1);
}

// Bundle the real module, as a global the page can call.
const bundled = await build({
  entryPoints: [resolve(ROOT, 'src/restore/restore.ts')],
  bundle: true,
  format: 'iife',
  globalName: 'DraftRescueRestore',
  write: false,
  logLevel: 'silent',
});
const restoreJs = bundled.outputFiles[0].text;

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript' };
const server = createServer(async (req, res) => {
  const path = (req.url ?? '/').split('?')[0];

  if (path === '/restore.js') {
    res.writeHead(200, { 'content-type': 'text/javascript' }).end(restoreJs);
    return;
  }

  const file = join(FIXTURES, path === '/' ? 'editors.html' : path);
  if (!file.startsWith(FIXTURES)) {
    res.writeHead(403).end();
    return;
  }
  let body;
  try {
    body = await readFile(file);
  } catch {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'text/plain' }).end(body);
});

await new Promise((done) => server.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${server.address().port}`;

let failures = 0;
function check(label, condition, detail) {
  if (condition) console.log(`  PASS  ${label}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
  }
}

const browser = await chromium.launch({ headless: true, channel: 'chromium' }).catch((error) => {
  console.error('Could not launch Chromium. If the browser is missing:');
  console.error('  npx playwright install chromium');
  console.error(String(error));
  process.exit(1);
});

const page = await browser.newPage();
await page.goto(`${base}/editors.html`, { waitUntil: 'load' });
await page.addScriptTag({ url: '/restore.js' });

console.log('\nDraft Rescue restore-engine smoke test\n');

// --- 1. A framework-controlled input -----------------------------------------

const naive = await page.evaluate(() => {
  const el = document.getElementById('controlled');
  el.value = 'restored the naive way, by assignment';
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return { shown: el.value, frameworkState: window.__controlled.state };
});

check(
  'the naive assignment puts text in the box',
  naive.shown === 'restored the naive way, by assignment',
);
check(
  '...but the framework never hears about it (this is the bug)',
  naive.frameworkState === '',
  `framework state was ${JSON.stringify(naive.frameworkState)}`,
);

const proper = await page.evaluate(() => {
  const el = document.getElementById('controlled');
  const result = window.DraftRescueRestore.restoreInto(el, 'textarea', 'restored properly');
  return { result, shown: el.value, frameworkState: window.__controlled.state };
});

check('restoreInto puts text in the box', proper.shown === 'restored properly');
check(
  'restoreInto DOES notify the framework',
  proper.frameworkState === 'restored properly',
  `framework state was ${JSON.stringify(proper.frameworkState)}`,
);
check('and reports the method it used', proper.result.method === 'native-setter');

// --- 2. A model-driven rich editor -------------------------------------------

const naiveRich = await page.evaluate(() => {
  const el = document.getElementById('rich');
  el.innerHTML = 'restored by writing innerHTML';
  const immediately = el.innerText;
  window.__rich.rerender(); // the editor's next state update
  return { immediately, afterRerender: el.innerText, model: window.__rich.model };
});

check(
  'writing innerHTML looks like it worked',
  naiveRich.immediately.includes('restored by writing innerHTML'),
);
check(
  '...and then vanishes on the editor’s next render (this is the bug)',
  !naiveRich.afterRerender.includes('restored by writing innerHTML'),
  `after rerender the box held ${JSON.stringify(naiveRich.afterRerender)}`,
);

const properRich = await page.evaluate(() => {
  const el = document.getElementById('rich');
  const result = window.DraftRescueRestore.restoreInto(
    el,
    'contenteditable',
    'restored through the editing pipeline',
  );
  const immediately = el.innerText;
  window.__rich.rerender();
  return { result, immediately, afterRerender: el.innerText, model: window.__rich.model };
});

check(
  'restoreInto uses execCommand in a real browser',
  properRich.result.method === 'exec-command',
  `method was ${properRich.result.method}: ${properRich.result.note ?? ''}`,
);
check(
  'the editor’s own model learns about the text',
  properRich.model.includes('restored through the editing pipeline'),
  `model was ${JSON.stringify(properRich.model)}`,
);
check(
  'and the text SURVIVES the editor’s next render',
  properRich.afterRerender.includes('restored through the editing pipeline'),
  `after rerender the box held ${JSON.stringify(properRich.afterRerender)}`,
);

// --- 3. Replacing, not appending ---------------------------------------------

const replaced = await page.evaluate(() => {
  const el = document.getElementById('rich');
  window.DraftRescueRestore.restoreInto(el, 'contenteditable', 'the second draft');
  window.__rich.rerender();
  return el.innerText;
});
check(
  'a second restore replaces the first rather than appending',
  replaced.trim() === 'the second draft',
  `box held ${JSON.stringify(replaced)}`,
);

// --- 4. Undo still works ------------------------------------------------------
// execCommand joins the browser's native undo stack, which a raw DOM write does
// not. Losing Ctrl+Z after a restore would be its own small betrayal: the user
// clicks restore, sees the wrong draft, and has no way back.
//
// Checked on the plain contenteditable rather than the model-driven one,
// because that fixture's rerender() writes to the DOM directly and the undo
// stack has no idea those writes happened.
await page.locator('#plain').click();
await page.keyboard.type('what the user had already written');

const undone = await page.evaluate(() => {
  const el = document.getElementById('plain');
  window.DraftRescueRestore.restoreInto(el, 'contenteditable', 'the restored draft');
  return el.innerText;
});
check(
  'restore replaces what was in a plain contenteditable',
  undone.includes('the restored draft'),
  `box held ${JSON.stringify(undone)}`,
);

await page.keyboard.press('Control+z');
const afterUndo = await page.evaluate(() => document.getElementById('plain').innerText);
check(
  'Ctrl+Z undoes the restore and brings the old text back',
  afterUndo.includes('what the user had already written') &&
    !afterUndo.includes('the restored draft'),
  `after undo the box held ${JSON.stringify(afterUndo)}`,
);

await browser.close();
server.close();

console.log(
  `\n${failures === 0 ? 'All restore-engine checks passed.' : `${failures} check(s) FAILED.`}\n`,
);
process.exit(failures === 0 ? 0 : 1);
