/**
 * Proves the central privacy claim against the BUILT extension.
 *
 *   npm run build && npm run check:offline
 *
 * Draft Rescue's whole argument is that your drafts cannot leave the machine,
 * because there is no code in it that could send them. That is a strong claim
 * and a fragile one: a single dependency, or one careless line, turns it into a
 * lie that nobody would notice — least of all the person who wrote it.
 *
 * So it is checked mechanically, on the shipped bundles rather than the source,
 * because the source is not what runs. If this ever fails, the README, the
 * privacy policy and the store listing are all wrong at the same time.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, '.output/chrome-mv3');

/**
 * Every way a page can TRANSMIT over the network.
 *
 * Matched as whole words against the bundled JavaScript. Minification renames
 * local variables but never these — they are properties of globals the runtime
 * provides, so they survive verbatim.
 *
 * Deliberately not on this list: `navigator.connection`, which React reads to
 * estimate connection speed for scheduling. It reports a number ABOUT the
 * network; it cannot put anything on it. Listing it made the check fail on a
 * dependency doing something harmless, which is how a check stops being read.
 */
const NETWORK_APIS = [
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'sendBeacon',
  'importScripts',
  'RTCPeerConnection',
];

/** Extension APIs that would let us reach the network indirectly. */
const NETWORK_PERMISSIONS = ['webRequest', 'declarativeNetRequest', 'proxy'];

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...walk(full));
    else files.push(full);
  }
  return files;
}

let failures = 0;
function fail(message) {
  failures++;
  console.log(`  FAIL  ${message}`);
}

console.log('\nDraft Rescue offline check\n');

let files;
try {
  files = walk(OUT);
} catch {
  console.error(`No build at ${OUT}. Run \`npm run build\` first.`);
  process.exit(1);
}

// --- 1. No network API in any shipped script ---------------------------------
const scripts = files.filter((f) => ['.js', '.mjs'].includes(extname(f)));
for (const file of scripts) {
  const source = readFileSync(file, 'utf8');
  for (const api of NETWORK_APIS) {
    const pattern = new RegExp(`\\b${api.replace('.', '\\.')}\\b`);
    if (pattern.test(source)) {
      fail(`${relative(ROOT, file)} references ${api}`);
    }
  }
}
if (failures === 0) {
  console.log(`  PASS  no network API in ${scripts.length} shipped script(s)`);
}

// --- 2. No remote URL in any shipped script ----------------------------------
// A bare URL string cannot fetch anything on its own — rule 1 already
// established there is nothing here that could fetch it. It is checked anyway
// because a literal endpoint in the bundle would mean rule 1 missed something,
// and because `https://` + a variable is precisely the shape an exfiltration
// endpoint takes.
//
// XML namespace URIs are the one genuine exception. React passes them to
// createElementNS to say "this element is SVG" or "this is MathML"; they are
// identifiers that happen to look like addresses, defined by specification never
// to be dereferenced. Allowing them by exact match keeps the rule strict.
const INERT_URLS = new Set([
  // React's minified-error decoder. Concatenated into an Error message —
  // "visit this address for the full text" — and never requested. Allowed by
  // exact match so a different react.dev path would still fail.
  'https://react.dev/errors/',
]);

const NAMESPACE_URIS = new Set([
  'http://www.w3.org/2000/svg',
  'http://www.w3.org/1998/Math/MathML',
  'http://www.w3.org/1999/xlink',
  'http://www.w3.org/XML/1998/namespace',
  'http://www.w3.org/1999/xhtml',
  'http://www.w3.org/2000/xmlns/',
]);

const before = failures;
for (const file of scripts) {
  const source = readFileSync(file, 'utf8');
  for (const url of source.match(/https?:\/\/[^\s"'`)]+/g) ?? []) {
    if (NAMESPACE_URIS.has(url) || INERT_URLS.has(url)) continue;
    fail(`${relative(ROOT, file)} contains a remote URL: ${url}`);
  }
}
if (failures === before) {
  console.log('  PASS  no remote endpoint in shipped scripts');
}

// --- 3. No remotely-loaded resource in any shipped page ----------------------
// This is where a web font, an analytics snippet or a CDN stylesheet would
// appear, so it looks at LOADING positions rather than at any URL: a licence
// banner naming a project's website is not a request, and failing on it would
// train whoever runs this to ignore it.
const pages = files.filter((f) => ['.html', '.css'].includes(extname(f)));
const beforePages = failures;

/** Strip comments, which cannot load anything and often carry attribution. */
function withoutComments(source, ext) {
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, ' ');
  return ext === '.html' ? stripped.replace(/<!--[\s\S]*?-->/g, ' ') : stripped;
}

const LOADERS = [
  // CSS: @import url(...) and any url(...) — backgrounds, and web fonts.
  /@import\s+(?:url\()?["']?(https?:\/\/[^"')\s]+)/gi,
  /url\(\s*["']?(https?:\/\/[^"')\s]+)/gi,
  // HTML: anything with a src, and <link href> — but not an ordinary <a href>,
  // which is a destination the user chooses, not a resource we load.
  /\ssrc\s*=\s*["']?(https?:\/\/[^"'\s>]+)/gi,
  /<link\b[^>]*?\shref\s*=\s*["']?(https?:\/\/[^"'\s>]+)/gi,
];

for (const file of pages) {
  const source = withoutComments(readFileSync(file, 'utf8'), extname(file));
  for (const pattern of LOADERS) {
    for (const match of source.matchAll(pattern)) {
      fail(`${relative(ROOT, file)} loads something remote: ${match[1]}`);
    }
  }
}
if (failures === beforePages) {
  console.log(`  PASS  no remote resource loaded by ${pages.length} shipped page(s)`);
}

// --- 4. The manifest asks for nothing network-shaped -------------------------
const manifest = JSON.parse(readFileSync(join(OUT, 'manifest.json'), 'utf8'));
const beforeManifest = failures;

for (const permission of manifest.permissions ?? []) {
  if (NETWORK_PERMISSIONS.includes(permission)) {
    fail(`manifest requests the ${permission} permission`);
  }
}
if (manifest.host_permissions?.length) {
  fail(`manifest requests host_permissions: ${manifest.host_permissions.join(', ')}`);
}
if (manifest.content_security_policy) {
  fail('manifest overrides the content security policy');
}
if (failures === beforeManifest) {
  console.log('  PASS  manifest requests no network-capable permission');
}

console.log(
  `\n${failures === 0 ? 'Nothing in this extension can reach the network.' : `${failures} problem(s) found — the privacy claim is currently FALSE.`}\n`,
);
process.exit(failures === 0 ? 0 : 1);
