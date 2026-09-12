/**
 * The inline restore prompt, tested in a real browser with the real extension.
 *
 *   npm run build && npm run smoke:prompt
 *
 * WHY THIS CANNOT BE A UNIT TEST
 * Everything interesting about the pill is layout and focus:
 *
 *   where it lands relative to the field, and whether it keeps up when the page
 *   scrolls — neither exists without real layout;
 *
 *   whether clicking it restores the draft without first blurring the field,
 *   which is the difference between a rich editor accepting the text and having
 *   no selection to insert into.
 *
 * It also quietly checks the `open` shadow root decision: every selector below
 * reaches through the shadow boundary. With `mode: 'closed'` none of this could
 * be asserted at all.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFixtureServer } from './lib/fixture-server.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const EXT = resolve(ROOT, '.output/chrome-mv3');
const FIXTURES = resolve(ROOT, 'test');

/** Clears the 800ms debounce and the write. */
const SETTLE_MS = 2000;

const PILL = '[data-draft-rescue-ui] button.pill';
const DRAFT = 'Dear hiring manager, this is the draft that should come back.';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('Playwright is not installed. Run: npm install');
  process.exit(1);
}

const { base, crossOrigin, close: closeServer } = await startFixtureServer();
const userDataDir = mkdtempSync(join(tmpdir(), 'draft-rescue-prompt-'));

let failures = 0;
function check(label, condition, detail) {
  if (condition) console.log(`  PASS  ${label}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
  }
}

let ctx;
try {
  ctx = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    channel: 'chromium',
    viewport: { width: 1000, height: 700 },
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
} catch (error) {
  console.error('Could not launch Chromium. If the browser is missing:');
  console.error('  npx playwright install chromium');
  console.error(String(error));
  process.exit(1);
}

console.log('\nDraft Rescue restore-prompt smoke test\n');

let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 20000 }).catch(() => null);
if (!sw) {
  console.log('  FAIL  service worker never registered');
  await ctx.close();
  closeServer();
  process.exit(1);
}

const page = await ctx.newPage();
await page.goto(`${base}/fixtures.html`, { waitUntil: 'load' });

/** Leave the field so a later focus counts as a fresh one. */
async function blur() {
  await page.locator('h1').click();
}

// --- Save a draft, then empty the box ----------------------------------------
await page.locator('#ta').pressSequentially(DRAFT, { delay: 1 });
await page.waitForTimeout(SETTLE_MS);

check('nothing is offered while the user is still typing', !(await page.locator(PILL).isVisible()));

await page.locator('#ta').fill('');
await blur();

// --- Focusing the now-empty field offers the draft back ----------------------
await page.locator('#ta').click();

let appeared = true;
try {
  await page.locator(PILL).waitFor({ state: 'visible', timeout: 5000 });
} catch {
  appeared = false;
}
check('focusing an empty field we have a draft for shows the pill', appeared);

if (!appeared) {
  await ctx.close();
  closeServer();
  console.log('\nCannot continue without the pill.\n');
  process.exit(1);
}

check(
  'the pill reads as a restore offer, with the draft’s age',
  /Restore draft \((just now|\d+[mhdw] ago)\)/.test(await page.locator(PILL).textContent()),
  await page.locator(PILL).textContent(),
);
check(
  'it is reachable through the shadow boundary, because the root is open',
  (await page.locator(PILL).count()) === 1,
);
check(
  'it names itself for screen readers',
  (await page.locator(PILL).getAttribute('aria-label'))?.startsWith('Restore the draft saved'),
);

// --- It sits on the field, not somewhere random ------------------------------
{
  const fieldBox = await page.locator('#ta').boundingBox();
  const pillBox = await page.locator(PILL).boundingBox();
  check(
    'it sits at the bottom-right of the field',
    pillBox.x + pillBox.width <= fieldBox.x + fieldBox.width + 2 &&
      pillBox.x > fieldBox.x &&
      pillBox.y + pillBox.height <= fieldBox.y + fieldBox.height + 2 &&
      pillBox.y > fieldBox.y,
    `field ${JSON.stringify(fieldBox)} pill ${JSON.stringify(pillBox)}`,
  );
}

// --- It keeps up with the page -----------------------------------------------
{
  const before = await page.locator(PILL).boundingBox();
  const fieldBefore = await page.locator('#ta').boundingBox();
  await page.mouse.wheel(0, 200);
  await page.waitForTimeout(300);
  const after = await page.locator(PILL).boundingBox();
  const fieldAfter = await page.locator('#ta').boundingBox();

  const fieldMoved = Math.abs(fieldAfter.y - fieldBefore.y);
  const pillMoved = Math.abs(after.y - before.y);
  check(
    'it follows the field when the page scrolls',
    fieldMoved > 50 && Math.abs(pillMoved - fieldMoved) < 4,
    `field moved ${fieldMoved}px, pill moved ${pillMoved}px`,
  );

  await page.mouse.wheel(0, -200);
  await page.waitForTimeout(300);
}

// --- Clicking it restores, without first blurring the field ------------------
await page.locator(PILL).click();
await page.waitForTimeout(300);

check(
  'clicking it puts the draft back',
  (await page.locator('#ta').inputValue()) === DRAFT,
  JSON.stringify(await page.locator('#ta').inputValue()),
);
check('it disappears once used', !(await page.locator(PILL).isVisible()));
check(
  'the field still has focus, so the user can carry on typing',
  await page.evaluate(() => document.activeElement?.id === 'ta'),
  await page.evaluate(() => document.activeElement?.tagName),
);

// --- It never offers over text the user already has --------------------------
await blur();
await page.locator('#ta').click();
await page.waitForTimeout(1200);
check(
  'it does NOT appear on a field that already has text',
  !(await page.locator(PILL).isVisible()),
);

// --- Escape dismisses ---------------------------------------------------------
await page.locator('#ta').fill('');
await blur();
await page.locator('#ta').click();
await page.locator(PILL).waitFor({ state: 'visible', timeout: 5000 });
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
check('Escape dismisses it', !(await page.locator(PILL).isVisible()));

// --- Typing dismisses ---------------------------------------------------------
await blur();
await page.locator('#ta').click();
await page.locator(PILL).waitFor({ state: 'visible', timeout: 5000 });
await page.keyboard.type('I would rather write something new');
await page.waitForTimeout(300);
check('starting to type dismisses it', !(await page.locator(PILL).isVisible()));

// --- Nothing is offered for a field we hold no draft for ----------------------
await blur();
await page.locator('#ti').click();
await page.waitForTimeout(1200);
check(
  'no offer on a field we have never seen a draft for',
  !(await page.locator(PILL).isVisible()),
);

// --- A field too short to hold the pill gets it underneath -------------------
{
  const TINY = 'a short note worth keeping around';
  await blur();
  await page.locator('#tiny').pressSequentially(TINY, { delay: 1 });
  await page.waitForTimeout(SETTLE_MS);
  await page.locator('#tiny').fill('');
  await blur();
  await page.locator('#tiny').click();

  let shown = true;
  try {
    await page.locator(PILL).waitFor({ state: 'visible', timeout: 5000 });
  } catch {
    shown = false;
  }
  check('a short field still gets an offer', shown);

  if (shown) {
    const fieldBox = await page.locator('#tiny').boundingBox();
    const pillBox = await page.locator(PILL).boundingBox();
    check(
      'and the pill sits BELOW it rather than covering it',
      pillBox.y >= fieldBox.y + fieldBox.height,
      `field bottom ${fieldBox.y + fieldBox.height}, pill top ${pillBox.y}`,
    );
    await page.keyboard.press('Escape');
  }
}

// --- A rich editor gets the same treatment -----------------------------------
const RICH = 'This is a rich text draft that should also come back.';
await page.locator('#ce').click();
await page.keyboard.type(RICH);
await page.waitForTimeout(SETTLE_MS);

await page.evaluate(() => {
  const el = document.getElementById('ce');
  el.textContent = '';
  el.dispatchEvent(new InputEvent('input', { bubbles: true }));
});
await blur();
await page.locator('#ce').click();

let richAppeared = true;
try {
  await page.locator(PILL).waitFor({ state: 'visible', timeout: 5000 });
} catch {
  richAppeared = false;
}
check('a contenteditable gets the offer too', richAppeared);

if (richAppeared) {
  await page.locator(PILL).click();
  await page.waitForTimeout(300);
  check(
    'and the rich draft is restored into it',
    (await page.locator('#ce').innerText()).includes(RICH),
    JSON.stringify(await page.locator('#ce').innerText()),
  );
}

// --- We never capture our own UI ----------------------------------------------
{
  const rows = await sw.evaluate(async () => {
    const db = await new Promise((res, rej) => {
      const req = indexedDB.open('draft-rescue');
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    const all = await new Promise((res, rej) => {
      const req = db.transaction('snapshots').objectStore('snapshots').getAll();
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    db.close();
    return all;
  });
  check(
    'the pill itself is never captured as a page field',
    !rows.some((r) => r.text.includes('Restore draft')),
  );
}

await ctx.close();
closeServer();
rmSync(userDataDir, { recursive: true, force: true });

console.log(`\n${failures === 0 ? 'All prompt checks passed.' : `${failures} check(s) FAILED.`}\n`);
process.exit(failures === 0 ? 0 : 1);
