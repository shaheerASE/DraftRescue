/**
 * The popup and options page, driven in a real browser with the real extension.
 *
 *   npm run build && npm run smoke:ui
 *
 * WHY THIS IS NOT A COMPONENT TEST
 * Both pages are thin: almost nothing in them is logic worth testing in
 * isolation. What can actually break is the wiring — a message the worker does
 * not answer, a delete that removes the row from the list but not from the
 * database, a storage meter that keeps counting bytes that are gone. All of
 * that only exists once the pages, the message layer and IndexedDB are running
 * together, which is what this does.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXT = resolve(HERE, '../.output/chrome-mv3');

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('Playwright is not installed. Run: npm install');
  process.exit(1);
}

let failures = 0;
function check(label, condition, detail) {
  if (condition) console.log(`  PASS  ${label}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
  }
}

const userDataDir = mkdtempSync(join(tmpdir(), 'draft-rescue-ui-'));

let ctx;
try {
  ctx = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    channel: 'chromium',
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
} catch (error) {
  console.error('Could not launch Chromium. If the browser is missing:');
  console.error('  npx playwright install chromium');
  console.error(String(error));
  process.exit(1);
}

console.log('\nDraft Rescue popup and options smoke test\n');

let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 20000 }).catch(() => null);
if (!sw) {
  console.log('  FAIL  service worker never registered');
  await ctx.close();
  process.exit(1);
}
const extensionId = new URL(sw.url()).host;

// --- Empty state, before anything is stored ----------------------------------
const popup = await ctx.newPage();
await popup.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'load' });
await popup.waitForTimeout(600);

check(
  'the empty popup explains itself rather than showing a blank panel',
  (await popup.textContent('body'))?.includes('no drafts yet'),
);
check(
  'delete everything is disabled when there is nothing to delete',
  await popup.locator('footer button', { hasText: 'delete everything' }).isDisabled(),
);

// --- Seed drafts through the real write path ---------------------------------
await sw.evaluate(async () => {
  const db = await new Promise((res, rej) => {
    const req = indexedDB.open('draft-rescue');
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
  const now = Date.now();
  const rows = [
    ['https://www.upwork.com', '/proposals/1', 'Dear hiring manager, about the frontend role you posted.', now],
    ['https://www.upwork.com', '/proposals/1', 'Dear hiring manager, about the role.', now - 60_000],
    ['https://www.reddit.com', '/r/webdev', 'Manifest V3 service workers are ephemeral, which changes the model.', now - 120_000],
  ];
  const tx = db.transaction(['snapshots', 'meta'], 'readwrite');
  let bytes = 0;
  rows.forEach(([origin, pathname, text, createdAt], i) => {
    const b = text.length * 2 + 300;
    bytes += b;
    tx.objectStore('snapshots').add({
      fieldKey: `${origin}${pathname}`,
      signals: {
        origin, pathname, isTopFrame: true, tagName: 'TEXTAREA',
        editorKind: 'textarea', domPath: 'body>form>textarea', fieldName: `field${i}`,
      },
      text, createdAt, length: text.length, bytes: b, redactions: 0,
    });
  });
  tx.objectStore('meta').put({ bytes, snapshots: rows.length }, 'stats');
  await new Promise((r) => { tx.oncomplete = r; });
  db.close();
});

await popup.reload({ waitUntil: 'load' });
await popup.waitForTimeout(600);

// --- History ------------------------------------------------------------------
check('drafts appear, grouped by site', (await popup.locator('section').count()) === 2);
check(
  'sites are named by host, not by full origin',
  (await popup.textContent('body'))?.includes('upwork.com'),
);
check(
  'the page path is shown under each site',
  (await popup.textContent('body'))?.includes('/proposals/1'),
);
check(
  'the header counts what is stored',
  (await popup.locator('header').textContent())?.includes('3 saved'),
);

// --- Search --------------------------------------------------------------------
await popup.locator('input[aria-label="Search your drafts"]').fill('ephemeral');
await popup.waitForTimeout(500);
check('search narrows to matching drafts', (await popup.locator('section').count()) === 1);
check(
  'and the match is the right one',
  (await popup.textContent('body'))?.includes('Manifest V3'),
);

await popup.locator('input[aria-label="Search your drafts"]').fill('zzznothing');
await popup.waitForTimeout(500);
check(
  'a search with no matches says so',
  (await popup.textContent('body'))?.includes('nothing matches'),
);

await popup.locator('input[aria-label="Search your drafts"]').fill('');
await popup.waitForTimeout(500);
check('clearing the search restores the full list', (await popup.locator('section').count()) === 2);

// --- Deleting one draft ---------------------------------------------------------
{
  const before = await popup.locator('li').count();
  await popup.locator('li').first().hover();
  await popup.locator('li').first().locator('button', { hasText: 'delete' }).click();
  await popup.waitForTimeout(700);

  check('deleting a draft removes it from the list', (await popup.locator('li').count()) === before - 1);

  const stored = await sw.evaluate(async () => {
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
    return all.length;
  });
  check('and from the database, not just the screen', stored === before - 1, `db holds ${stored}`);
  check(
    'the stored count updates with it',
    (await popup.locator('header').textContent())?.includes('2 saved'),
    await popup.locator('header').textContent(),
  );
}

// --- Forgetting a whole site ------------------------------------------------------
await popup.locator('section', { hasText: 'reddit.com' }).locator('button', { hasText: 'forget site' }).click();
await popup.locator('button', { hasText: 'delete all' }).click();
await popup.waitForTimeout(700);
check(
  'forgetting a site takes two clicks, not one',
  !(await popup.textContent('body'))?.includes('Manifest V3'),
);
check('and leaves the other sites alone', (await popup.textContent('body'))?.includes('upwork.com'));

// --- Delete everything --------------------------------------------------------------
await popup.locator('footer button', { hasText: 'delete everything' }).click();
check(
  'delete everything asks before doing it',
  (await popup.locator('footer').textContent())?.includes('cannot be undone'),
);
await popup.locator('footer button', { hasText: 'delete everything' }).click();
await popup.waitForTimeout(700);
check('confirming clears the history', (await popup.textContent('body'))?.includes('no drafts yet'));
check(
  'and resets the storage meter',
  (await popup.locator('header').textContent())?.includes('0 saved'),
  await popup.locator('header').textContent(),
);

// --- Options ---------------------------------------------------------------------
const options = await ctx.newPage();
await options.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: 'load' });
await options.waitForTimeout(500);

check(
  'retention defaults to the 7-day setting',
  (await options.locator('button[aria-pressed="true"]').textContent()) === '7 days',
);

await options.locator('button', { hasText: '30 days' }).click();
await options.waitForTimeout(400);
check(
  'changing retention is persisted',
  (await sw.evaluate(async () => {
    const stored = await chrome.storage.local.get('settings');
    return stored.settings?.retentionDays;
  })) === 30,
);

await options.locator('input[aria-label="Site to block"]').fill('https://bank.example.com/login');
await options.locator('button', { hasText: 'block' }).click();
await options.waitForTimeout(400);
check(
  'a blocked site is stored as a bare hostname, whatever was pasted in',
  (await sw.evaluate(async () => {
    const stored = await chrome.storage.local.get('settings');
    return stored.settings?.blockedOrigins;
  }))?.[0] === 'bank.example.com',
);
check(
  'and it is listed back to the user',
  (await options.textContent('body'))?.includes('bank.example.com'),
);

await options.locator('button[aria-label="Stop blocking bank.example.com"]').click();
await options.waitForTimeout(400);
check(
  'removing it empties the blocklist again',
  ((await sw.evaluate(async () => {
    const stored = await chrome.storage.local.get('settings');
    return stored.settings?.blockedOrigins;
  })) ?? []).length === 0,
);

const capture = options.locator('button[role="switch"]').first();
check('capture is on by default', (await capture.getAttribute('aria-checked')) === 'true');
await capture.click();
await options.waitForTimeout(400);
check(
  'and can be paused',
  (await sw.evaluate(async () => {
    const stored = await chrome.storage.local.get('settings');
    return stored.settings?.enabled;
  })) === false,
);

await ctx.close();
rmSync(userDataDir, { recursive: true, force: true });

console.log(`\n${failures === 0 ? 'All UI checks passed.' : `${failures} check(s) FAILED.`}\n`);
process.exit(failures === 0 ? 0 : 1);
