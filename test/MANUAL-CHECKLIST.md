# Manual test checklist

The automated suites cover the mechanism. This covers the thing they cannot:
**real sites, whose editors are the entire reason this extension exists.**

Every site below uses a different rich-text engine, and each one has its own
ideas about how text gets into it. A fixture that mimics Lexical is not Lexical.

> Run this before any release, and again after any change to
> `src/capture/field.ts`, `src/restore/restore.ts` or `src/match/score.ts`.

---

## Setup

```bash
npm run build:dev          # the dev build explains its refusals
```

Load `.output/chrome-mv3-dev` at `chrome://extensions`, and make sure it is
loaded **once** — two copies capture into two databases and log everything
twice.

Then, on each site:

1. Open DevTools (F12) → Console → switch the context dropdown from `top` to
   **Draft Rescue**. Content scripts run in their own isolated world; that
   dropdown is how you reach ours.
2. Keep the console visible. A refusal announces itself there.

---

## The five steps, on every site

For each field listed under a site:

| # | Do this | Expect |
|---|---|---|
| 1 | Type 40+ characters. Wait 2 seconds. | No console complaint. |
| 2 | Run `__draftRescue.dump()` | Your text, with the right site and field name. |
| 3 | Select all, delete. Click elsewhere. Click back into the field. | The pill appears, bottom-right. |
| 4 | Hover the pill | Tooltip previews the text it will restore. |
| 5 | Click it | **The text comes back, and stays back.** |

**Step 5 is the one that matters.** Watch the field for a few seconds after
restoring, and type a character. If the text vanishes, the editor discarded our
write — that is the `execCommand` path failing, and it is the single most
important thing this checklist is looking for.

If a field is not captured, run `__draftRescue.probe()` with the cursor in it.
It names the rule that refused it.

---

## Sites

Tick the box, or write what happened.

### Reddit — Lexical
`reddit.com`, any post → comment box.

- [ ] Comment box captures
- [ ] Restores, and survives typing afterwards
- [ ] Reply-to-a-comment box (a different instance of the same editor)

*Already verified once during development. Treat as the regression canary: it is
a web component with an open shadow root wrapping a Lexical editor, so it
exercises `composedPath` and the rich-text restore together.*

### Gmail — contenteditable
`mail.google.com` → Compose.

- [ ] Message body captures
- [ ] Subject line captures
- [ ] Restores into the body, and survives
- [ ] The pill is not hidden behind the compose window's own chrome

*Gmail autosaves its own drafts, so the value here is compatibility rather than
rescue. The body is `[aria-label="Message Body"]` with `g_editable="true"`.*

### LinkedIn — Quill
`linkedin.com` → "Start a post", and a message thread.

- [ ] Post composer captures
- [ ] Message box captures
- [ ] Restores into the post composer, and survives
- [ ] The post modal's own "discard?" prompt does not interfere

*The composer is `.ql-editor`, a Quill contenteditable, with the placeholder in
`data-placeholder` rather than a real placeholder attribute.*

### X — Draft.js
`x.com` → the compose box.

- [ ] Compose box captures
- [ ] Restores, and survives

*The hardest one, and the most likely to fail. Draft.js maintains its own
immutable editor state and is historically hostile to programmatic input. The
field is `[data-testid="tweetTextarea_0"]`. If restore fails anywhere, expect it
here first — and note exactly what happens: does the text appear and vanish, or
never appear at all? The two have different causes.*

### Notion — one contenteditable per block
`notion.so` → any page.

- [ ] Typing in a paragraph block captures
- [ ] The page title captures
- [ ] Restores into an emptied block

*The awkward one. Every block is its own `contenteditable`, so a page of writing
is dozens of separate fields rather than one, and block ids are generated. Two
things to watch:*

- **Noise.** Open the popup after a few minutes of writing. If it is full of
  one-line fragments, the per-block model is producing more rows than it is
  worth, and that is worth telling me.
- **Key stability.** Write in a block, move it up or down the page, then empty it
  and refocus. If the pill does not appear, the DOM-path fallback did not
  survive the reorder — expected, but worth confirming how badly.

### Jira — ProseMirror
Any issue → Description, and a comment.

- [ ] Description field captures
- [ ] Comment field captures
- [ ] Restores into the description, and survives

*`.ProseMirror` contenteditable. ProseMirror reconciles from its own document
model, so this is a direct test of the `execCommand` decision.*

### Upwork — plain textarea
A job posting → Apply → cover letter.

- [ ] Cover letter captures
- [ ] Restores, and survives
- [ ] Reloading the page and returning to the same proposal still offers it

*The easy case, and the motivating one — this is the draft people actually lose.
The last item tests path normalisation: `/proposals/12345` should match itself
across a reload.*

### WordPress — Gutenberg, and the classic editor
`wordpress.com` or any self-hosted admin → new post.

- [ ] Gutenberg paragraph block captures
- [ ] Post title captures
- [ ] Restores into a block
- [ ] **Classic editor**: the body captures (it is TinyMCE inside an iframe)

*The classic editor is the interesting half: the body is a `contenteditable`
inside a same-origin `<iframe id="content_ifr">`. If Gutenberg works and classic
does not, the problem is frame injection rather than the editor.*

---

## Safety pass — do this one carefully

Nothing below should ever appear in `__draftRescue.dump()`.

- [ ] A real login page: type into the password field, then click "show
      password" if there is one, and type more
- [ ] A real checkout page (a shop's cart, not a test page): type into any field
- [ ] Stripe-hosted card fields, if you can reach one without paying
- [ ] Your own bank's login page
- [ ] Type a card number into an ordinary comment box on any site — it **should**
      be captured, with the number replaced by `[redacted]`

> If anything sensitive appears in the dump, that is a release blocker, not a
> bug report. Stop and tell me exactly which field and which site.

---

## Performance pass

- [ ] Open Gmail or Notion. DevTools → Performance → record while typing a
      paragraph at normal speed. Look for dropped frames attributable to us.
- [ ] Leave a heavy page (Gmail, a long Twitter feed) open for ten minutes with
      the extension active. Memory should not climb.
- [ ] `npm run size` — the content script must stay under 20 KB gzipped.

---

## The local fixture page

```bash
npm run fixtures
```

Covers the shapes that are awkward to find in the wild: open and closed shadow
roots, same-origin, cross-origin and sandboxed iframes, a password field that
toggles to `type="text"`, a checkout form, and a comment box containing a card
number. Green sections must end up in the popup; red sections must not.

`npm run smoke` asserts all of it automatically — the page is there for when you
want to see it happen.

---

## Recording results

Copy this into a comment on the PR, or a file:

```
Date:
Chrome version:
Build: (git rev-parse --short HEAD)

Site          Capture  Restore  Survives  Notes
Reddit
Gmail
LinkedIn
X
Notion
Jira
Upwork
WordPress

Safety pass:   PASS / FAIL
Performance:   PASS / FAIL
```

"Survives" means the text was still there ten seconds and one keystroke after
restoring. It is the column that finds real bugs.
