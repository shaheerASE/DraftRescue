# Draft Rescue

A Chrome extension that silently saves what you type, so a crashed tab or a
failed form submit does not cost you an hour of writing.

**Everything stays on your machine.** The extension makes no network requests at
all — that is a design constraint, not an aspiration, and it is checkable from
the built bundle.

> Status: **Phase 0 — scaffold**. It builds and loads. It does not capture
> anything yet.

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
| `npm run size` | Check the content script against its 20 KB gzipped budget |
| `npm run icons` | Regenerate the placeholder icons |
| `npm run zip` | Package for Chrome Web Store upload |

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
[Draft Rescue] content script attached { url: "...", isTopFrame: true }
```

Then open a page that contains iframes (any page with an embedded YouTube video
works). You should see **several** of those lines — one per frame, most with
`isTopFrame: false`. That proves `all_frames: true` is doing its job, which is
what will let us capture text inside embedded editors later.

If you see the line on `chrome://extensions` — you will not, and should not.
Chrome blocks content scripts on its own pages, the Web Store, and other
extensions' pages. That is a hard browser restriction, not something we can
configure.

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
- **Cross-origin iframes are *not* a limitation.** Chrome injects a separate
  copy of the content script into each frame, so we capture inside them
  normally. What is impossible — and unnecessary for us — is reaching into a
  cross-origin iframe from the top frame's script.

---

## Licence

Not yet decided.
