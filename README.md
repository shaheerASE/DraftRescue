# Draft Rescue

A Chrome extension that silently saves what you type, so a crashed tab or a
failed form submit does not cost you an hour of writing.

**Everything stays on your machine.** The extension makes no network requests at
all — that is a design constraint, not an aspiration, and it is checkable from
the built bundle.

> Status: **Phase 2 — matching and restore**. It captures, matches a live field
> against stored drafts, and can put text back. There is still no UI: restore is
> driven from the console. The inline prompt lands in Phase 3.

---

## Why this exists

Every other draft-recovery extension handles only `<textarea>` and `<input>`.
Every modern editor — Gmail, LinkedIn, Notion, Reddit, Jira, X — is built on
`contenteditable`. That is where people lose the text that actually mattered,
and it is where the existing tools do nothing. Handling `contenteditable`
correctly is the whole point of this project.

---

## Requirements

- Node 18+ (developed on Node 22)
- Google Chrome

## Commands

| Command | What it does |
|---|---|
| `npm install` | Install deps. Runs `wxt prepare`, which generates `.wxt/` types |
| `npm run dev` | Dev build with hot reload, watching for changes |
| `npm run build` | Production build into `.output/chrome-mv3/` |
| `npm run compile` | Typecheck only (`tsc --noEmit`) |
| `npm test` | Run the Vitest suite |
| `npm run smoke` | End-to-end test: loads the built extension in a real Chrome |
| `npm run build:dev` | Production-style build with the dev diagnostics left in |
| `npm run smoke:dev` | Checks the dev diagnostics report real problems and only those |
| `npm run smoke:restore` | Checks restore works against real editor behaviour in Chrome |
| `npm run size` | Check the content script against its 20 KB gzipped budget |
| `npm run icons` | Regenerate the placeholder icons |
| `npm run zip` | Package for Chrome Web Store upload |

`npm run smoke` needs a browser the first time: `npx playwright install chromium`.

---

## Loading it in Chrome

A browser extension is not installed from a file — you point Chrome at a folder
containing a `manifest.json` and it loads what it finds. That folder is
`.output/chrome-mv3/`, which our build produces. It is gitignored; build it
first.

1. `npm run build`
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (toggle, top right). Without this the next button
   does not appear.
4. Click **Load unpacked**.
5. Select the folder `.output/chrome-mv3` — the folder itself, not a file inside
   it.
6. "Draft Rescue" appears in the list with a version number.

### Hot reload during development

`npm run build` produces a static folder — change a file and nothing updates.
For development use `npm run dev` instead: WXT watches your files, rebuilds, and
tells Chrome to reload the extension itself.

`npm run dev` writes to a **different** folder: `.output/chrome-mv3-dev`. Load
that one while developing. (The first run may launch its own Chrome instance
with the extension preloaded; if it does, use that window.)

What reloads automatically and what does not:

| Change | What happens |
|---|---|
| Popup / options React code | Updates live, no action needed |
| Content script | Extension reloads; **refresh the web page** to reinject it |
| Service worker | Extension reloads automatically |
| `wxt.config.ts` (manifest) | Extension reloads; if it looks stale, hit reload on `chrome://extensions` |

---

## Verifying Phase 0

Three things have to be true. Check each one.

**1. The popup works.**
Click the Draft Rescue icon in the toolbar. (If you do not see it, click the
puzzle-piece icon and pin Draft Rescue.) You should get a small panel with the
name, a version, and an "Open settings" button. Click it — the settings page
should open in a full tab.

**2. The service worker runs.**
On `chrome://extensions`, find Draft Rescue and click the **service worker**
link. DevTools opens on the worker. In the Console you should see:

```
[Draft Rescue] service worker awake { at: ... }
```

Now wait about 30 seconds without touching anything. The link on
`chrome://extensions` changes to "service worker (inactive)" — Chrome killed it.
Click the extension icon and it comes back and logs again. That is the MV3
lifecycle, and it is the single most important thing to understand about the
background script: **it is not always running, and its variables do not
survive.**

**3. The content script is injected everywhere, in every frame.**
Open any normal website. Open the page's own DevTools (F12) → Console. You
should see:

```
[Draft Rescue] capturing { url: "...", isTopFrame: true }
```

Then open a page that contains iframes (any page with an embedded YouTube video
works). You should see **several** of those lines — one per frame, most with
`isTopFrame: false`. That proves `all_frames: true` is doing its job.

These log lines only appear in a **dev build** (`npm run dev`). The production
build is silent on purpose — it is not our place to write to other people's
consoles.

If you look for the line on `chrome://extensions` — you will not find it, and
should not. Chrome blocks content scripts on its own pages, the Web Store, and
other extensions' pages. That is a hard browser restriction.

---

## Verifying Phase 1

Run `npm run dev` and load `.output/chrome-mv3-dev`.

**The automated check, first.** This is the honest one, and it takes 30 seconds:

```bash
npm test        # 292 unit tests: the capture gate, redaction, keys, storage
npm run build
npm run smoke   # loads the real extension in a real Chrome and types into it
```

`npm run smoke` opens the fixture page, types into every kind of field, and then
reads the service worker's IndexedDB to check what actually landed. It asserts
both directions: the drafts that must be there, and the passwords and card
numbers that must not.

**Then check it by hand, because that is what you will trust.**

1. Go to any site with a big text box — Reddit's comment box, a Gmail draft, a
   LinkedIn post box.
2. Type at least 15 characters. Wait a second (there is an 800ms debounce).
3. Open DevTools → **Application** tab → **Storage** → **IndexedDB**.

Here is the part that catches people out: you are looking at **the page's**
storage, and our database is not there. It is in the *extension's* origin.

To see it: go to `chrome://extensions` → click the **service worker** link under
Draft Rescue → in that DevTools window, **Application** → **IndexedDB** →
`draft-rescue` → `snapshots`.

You should see a row per field, with `text`, `signals`, `createdAt` and a
`fieldKey`. Keep typing, change the text, wait — a second row appears with the
same `fieldKey`. That is version history.

**Now check the refusals, which matter more.**

Open `test/fixtures.html` (run `npx http-server test -p 8080` and visit
`http://localhost:8080/fixtures.html`). Every section is labelled green for
"must be captured" or red for "must never be captured". Type into all of them,
then look at the `snapshots` store. Nothing you typed into a red section should
be there. The comment box containing a card number should be there, with the
number replaced by `[redacted]`.

---

## If a site is not being captured

Load the **dev** build (`npm run dev` → `.output/chrome-mv3-dev`). The dev build
explains itself; the production build is silent on purpose.

Open the page's DevTools (F12) → Console. **Switch the context dropdown at the
top of the Console from `top` to the Draft Rescue entry** — content scripts run
in their own isolated world, and that dropdown is how you reach ours. Then type
into the field.

You will see one of these:

| Console line | What it means |
|---|---|
| nothing at all | The `input` event never reached us. The field may be in a cross-origin frame we are blocked from, or the site is stopping the event. |
| `REFUSED <field> — identifier: "..."` | The gate refused it, and names the word that did it. If that word is innocent, it is a bug in `src/capture/patterns.ts` — tell us which word and which site. |
| `REFUSED <field> — payment-origin` / `payment-form` | We think this is a checkout. Intentional. |
| `UNRESOLVED input event ... likelyClosedShadowRoot: true` | The field is inside a **closed** shadow root. No extension can see into one — see Known limitations. |
| `UNRESOLVED input event ... likelyClosedShadowRoot: false` | The event came from something we do not recognise as a field. Worth reporting. |

You will *not* see an `UNRESOLVED` line for a component that re-announces a
field we can already see inside it. Reddit does this — typing in the comment box
fires the real event on the `contenteditable`, and then `<reddit-rte>` and
`<shreddit-composer>` each re-dispatch one as themselves. Those duplicates
resolve to nothing and are ignored silently, because a debugging tool that cries
wolf is worse than no tool.

Three commands, in that same console context:

```js
__draftRescue.dump()        // table of what is ACTUALLY in the database
__draftRescue.stats         // captured / refused / unresolved counts
__draftRescue.probe()       // click into the field first, then run this
__draftRescue.candidates()  // which stored drafts match this field, and how well
__draftRescue.restore()     // put the best match back into the focused field
```

`probe()` is the one to reach for. Click into the field that is not working, run
it, and it reports what we resolved, the decision, the text length against the
minimum, and whether the field is inside a shadow root.

`dump()` asks the service worker what it stored and prints a table — far quicker
than hunting for the service worker's DevTools.

### Two things that look like faults and are not

**"Errors" on `chrome://extensions`.** Click it and read them. Yellow ⚠ warnings
about `modulepreload` or preloaded resources are cosmetic and came from the
build tooling, not from capture. (They are fixed as of Phase 1; if you still see
them, you are running an older build.)

**Two copies of Draft Rescue installed.** If `chrome://extensions` shows Draft
Rescue twice with different IDs, you have loaded both `.output/chrome-mv3` and
`.output/chrome-mv3-dev`. Both will capture, into two separate databases, and
every console line appears twice. Remove one — keep the `-dev` one while
developing.

---

**A console helper, in dev builds.** In the page's DevTools console, switch the
context dropdown at the top of the Console from `top` to the Draft Rescue entry
— content scripts run in their own isolated world, so this is how you reach
ours. Then:

```js
__draftRescue.stats                                  // captured / refused counts
__draftRescue.explain(document.querySelector('#some-field'))  // why a field was refused
```

`explain` returns the actual decision, e.g.
`{ capture: false, reason: 'identifier', detail: 'cardnumber' }`. If a site is
not being captured and you want to know why, that is the tool.

---

## How it fits together

```
you type
   │
   ▼
CONTENT SCRIPT  (inside the web page)
   one `input` listener on document, capture phase
   → composedPath() to find the real field, even inside a shadow root
   → shouldCapture() — refuse passwords, cards, checkout forms, blocked sites
   → 800ms debounce per field, flushed on visibilitychange / pagehide
   → redact() — Luhn-checked card numbers and CNICs replaced
   → sanitizeHtml() for contenteditable
   │
   │  chrome.runtime.sendMessage  (text only; no network, ever)
   ▼
SERVICE WORKER  (the extension's own origin)
   the single writer
   → IndexedDB: 10 versions per field, 7-day retention, 50 MB cap
   → chrome.alarms wakes it every 6 hours to purge
   → scores a live field against stored drafts and ranks candidates
   │
   │  ranked candidates
   ▼
CONTENT SCRIPT
   → restoreInto() puts a draft back, by a route the page actually respects
```

Three rules that explain most of the design:

**The content script never stores anything.** IndexedDB is scoped per origin, so
a content script writing to it would write to *that website's* database — siloed
per site, and wiped whenever the user clears site data. Only the service worker
has our origin.

**The service worker has no DOM.** No `document`, no `DOMParser`. That is why
HTML sanitising happens in the content script rather than next to the code that
writes it.

**Scoring runs in the service worker, restoring runs in the content script.**
Scoring needs no DOM and the content script pays for every byte on every page
the user visits. Restoring needs the live element, so it has no choice.

---

## Matching: is this the same field as yesterday?

`src/match/score.ts`. Every stored fingerprint is scored against the live field
and the best one wins, if it is good enough. The asymmetry that drives the
design:

- **A missed match** costs an inline prompt. The draft is still in the popup,
  searchable. Annoying, recoverable.
- **A wrong match** offers someone text from a different box — possibly a
  different conversation. Restoring is one click, and the click comes before
  they have read what it is.

So it leans towards refusing. Signals are weighted by how well they survive a
redesign — `fieldName` 30, `labelText` and `ariaLabel` 26, `domPath` only 12,
because a site can rewrite its markup completely and still call the box "Cover
letter". Three rules do most of the work:

- A name or label that **actively disagrees** caps the score at 0.2. Two
  textareas side by side named `coverLetter` and `clientQuestion` must never
  match, however alike everything else is.
- A **different page** multiplies by 0.35, so even a perfect signal match cannot
  cross the threshold from the wrong page. Paths are normalised first, so
  `/proposals/123` and `/proposals/456` count as the same page.
- A match must be **corroborated** by something that identifies *this* field. An
  early version scored two unrelated anonymous fields at 0.625 on `tagName` +
  `editorKind` alone — signals true of every text box on the site. Those can
  contribute, but they can no longer carry a match.

---

## Restoring: harder than setting .value

`src/restore/restore.ts`. Two failure modes, both of which look like success for
a second or two.

**A framework-controlled input.** The obvious code is `el.value = text` then
dispatch an `input` event. On a plain page that works. On a React-controlled
input it silently does nothing: React installs its own setter on the element
*instance* and keeps a private record of the last value it knows. Assigning
through that setter updates the record too, so by the time the event arrives
React sees no change and never calls `onChange`. The box looks right, the app
still holds the old text, and the form submits the old value.

The fix is to take the `value` setter off the **prototype**, bypassing the
instance property. The field changes, React's record is left stale, and the
event that follows shows a genuine difference.

**A model-driven rich editor.** Lexical, ProseMirror, Slate, Draft.js and Quill
keep their own document model and reconcile the DOM against it. Writing
`innerHTML` changes the DOM without telling the model, so the text appears and
then vanishes on the editor's next render.

The fix is `document.execCommand('insertText')` — deprecated, and still correct.
It goes through the browser's own editing pipeline, firing the same
`beforeinput`/`input` events a real keystroke fires, which is exactly what those
editors listen for. It also joins the native undo stack, so Ctrl+Z works.

Both failures and both fixes are asserted in a real Chrome by
`npm run smoke:restore`, against fixtures in `test/editors.html` that reproduce
how the real editors behave.

---

## What is never captured

Built as a tested gate (`src/capture/should-capture.ts`, 157 tests) that every
field passes through before anything is stored:

- `input[type="password"]` — and the element is remembered, so a "show password"
  toggle that flips it to `type="text"` does not open a window
- `autocomplete` of `current-password`, `new-password`, `one-time-code`, or
  anything starting with `cc-`
- A name, id, placeholder, aria-label, title or `<label>` that looks sensitive
- Any field inside a form whose action, id or name looks like a checkout
- Any frame on a payment processor's domain (Stripe, PayPal, Adyen, Razorpay,
  JazzCash and others) — we are injected into cross-origin iframes, so we do run
  inside hosted card fields
- Sites on your blocklist
- Incognito windows, unless explicitly enabled twice over (see below)

Then, independently, a **redaction pass runs on the text itself**: anything
Luhn-valid and 13–19 digits long, and anything CNIC-shaped, is replaced with
`[redacted]` before it is stored. This is what catches a card number pasted into
an ordinary comment box, which no amount of attribute-checking would.

### A note on the sensitive-word list

The obvious implementation is one regex of substrings —
`/pass|card|pin|cvv|.../i`. It is wrong, and quietly so: `pin` is inside
*shipping*, *typing* and *opinion*; `card` is inside *flashcard* and
*wildcard*; `pass` is inside *passenger* and *compass*. A field named
`shippingAddress` or `card-description` would be silently refused, and the user
would only find out when they needed the draft back.

So matching happens at two levels instead — normalised substrings for long
unambiguous patterns, whole-word tokens for short ambiguous ones. See
`src/capture/patterns.ts`. The test suite lists every real-world word this
distinction saves.

### Incognito

Chrome does not run extensions in incognito at all unless you tick "Allow in
incognito" on `chrome://extensions` — that is the browser's switch, not ours,
and we cannot grant it. Our own setting is a second refusal on top, so capturing
in a private window takes two separate deliberate acts.

---

## Project layout

```
entrypoints/          Each subfolder/file here becomes part of the extension
  background.ts         The MV3 service worker. Ephemeral — see the file's
                        comment for why that shapes everything
  content.ts            Injected into every page, in every frame. Zero
                        dependencies, hard size budget
  popup/                React. Our own origin, so React + Tailwind are free here
  options/              React. Full-tab settings page
src/                  Shared, testable logic imported by entrypoints
assets/               Styles processed by the build (Tailwind entry)
public/               Copied verbatim into the build (icons)
scripts/              Build-time tooling (icon generation, size budget)
test/                 Test fixtures and integration-ish tests
```

`.output/` (build result) and `.wxt/` (generated types) are both gitignored.

---

## Known limitations

Documented as we hit them, not hidden:

- **Chrome's own pages.** `chrome://`, the Chrome Web Store, and other
  extensions' pages cannot be touched by any extension. Nothing is captured
  there.
- **Closed Shadow DOM.** If a site attaches a shadow root with `mode: 'closed'`,
  its contents are invisible to us. This is rare and deliberate on the site's
  part. There is no workaround that is not a hack.
- **Sandboxed iframes.** An iframe with a `sandbox` attribute that omits
  `allow-same-origin` gets an opaque origin; we are injected but have no useful
  storage identity there.
- **Text below 15 characters** is not stored. It is not a draft.
- **No restore yet.** Phase 1 captures only. Getting text back arrives in
  Phase 2 (engine) and Phase 3 (the inline prompt).
- **Cross-origin iframes are *not* a limitation.** Chrome injects a separate
  copy of the content script into each frame, so we capture inside them
  normally. What is impossible — and unnecessary for us — is reaching into a
  cross-origin iframe from the top frame's script.

---

## Licence

Not yet decided.
