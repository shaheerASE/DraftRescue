# Design brief — icons and store graphics

Everything visual that is still blocking submission, with a prompt for each.

Paste a prompt into a fresh Claude conversation (say "use the design skill" if
it does not pick it up on its own). Each one is written to stand alone — a
design session has no access to this repository, so all the context it needs is
in the prompt itself.

---

## What is actually needed

| Asset | Size | Required? | Where it goes |
|---|---|---|---|
| Extension icons | 16, 32, 48, 96, 128 px PNG | **Yes** | `public/icon/` |
| Store icon | 128 × 128 PNG | **Yes** | Dashboard — the grid thumbnail |
| Screenshots | 1280 × 800 PNG, up to 5 | **Yes** | Dashboard |
| Small promo tile | 440 × 280 PNG | Recommended | Dashboard — category and search rows |
| Marquee promo tile | 1400 × 560 PNG | Only for featuring | Dashboard |

The 128 does double duty: it is both the largest extension icon and the store
thumbnail. One file, two jobs.

---

## What exists now, and why it is not enough

`public/icon/` holds placeholders from `scripts/make-icons.mjs` — a rounded
square in `#5a6cf5` with a white circular arrow, drawn by hand in code with 4×
supersampling. They are geometry, not design. They exist so the extension looks
deliberate while it is being built.

The **concept** is right: a circular restore arrow says "get it back" without
needing a word. It is the execution that needs a designer.

---

## The palette to hand the designer

These are not invented for the brief — they are the colours the extension
already draws with, so the icon will match the product rather than sit next to
it.

| | Hex | Where it comes from |
|---|---|---|
| Deep navy | `#1f2333` | The restore pill's background |
| Brand indigo | `#5a6cf5` | The current icon, `--color-rescue-500` |
| Accent periwinkle | `#7c8cff` | The pill's focus ring |
| White | `#ffffff` | The pill's glyph and label |

---

# Prompt 1 — The icon

**The one that actually blocks you.** Everything else is optional or can be
captured from the running extension.

```
I need an icon for a Chrome extension called Draft Rescue, and I'd like you to
use the design skill to explore it properly.

WHAT THE PRODUCT IS
Draft Rescue silently saves everything you type into text boxes on web pages —
comment fields, job applications, support tickets, email composers — so that
when a tab crashes or a form submit fails, the text isn't gone. A small button
appears in the corner of the empty box offering it back. One click and it's
there.

The thing that makes it different from similar tools: everything stays on the
user's own computer. There is no server, no account, and literally no network
code in the extension. That's the product's whole character — quiet,
trustworthy, out of the way. It should not look like a cloud backup service.

WHAT I NEED
An icon, delivered as SVG first and then rasterised to 16, 32, 48, 96 and
128 px PNG.

THE CONSTRAINTS THAT MATTER MOST
1. It has to read at 16 px. That's the size in the browser toolbar and it's
   where most icons die. Don't design at 128 and shrink — design the 16 first,
   or at minimum hand-tune it: snap edges to the pixel grid, thicken strokes,
   and delete detail until only the silhouette is left. If the 16 doesn't work,
   the icon doesn't work.
2. It sits on both light and dark browser toolbars, and on both light and dark
   store pages. It must hold up on all four without an outline hack.
3. It has to be picked out of a crowded store grid next to dozens of other
   extensions, so silhouette and colour matter more than detail.
4. No lettering. Text is unreadable at 16 px and looks like noise.
5. Square canvas with a small amount of padding — Chrome does not add any, so
   an icon drawn edge-to-edge looks cramped beside ones that aren't.

DIRECTION
The current placeholder is a rounded square in indigo with a white circular
"restore" arrow. I think the circular arrow is the right idea — it says "get it
back" without a word — but the execution is generic.

Please explore 3 or 4 distinct directions before settling, including at least
one that isn't a rotational arrow. Things worth pushing on: the idea of text
being caught rather than lost; a document or line of text with something holding
it; a mark that reads as "undo" without being the standard undo arrow.

PALETTE (the extension's own UI colours — I'd like the icon to match it)
  Deep navy          #1f2333   the restore button's background
  Brand indigo       #5a6cf5   the current icon
  Accent periwinkle  #7c8cff   the focus ring
  White              #ffffff   the glyph

You don't have to use all of these, and you can shift them. But the icon should
look like it belongs to the same product as a small dark-navy pill with white
text and a periwinkle focus ring.

DELIVERABLE
Show each direction at 128 px and at actual 16 px size, side by side, on a light
background and a dark one, so I can judge the small size honestly rather than
being flattered by the large one. Then give me the winner as clean SVG.
```

---

# Prompt 2 — The promo tiles

Optional, but the small tile appears in category and search rows, and a listing
without one looks unfinished next to listings with one.

```
I need two promotional tiles for a Chrome Web Store listing, using the design
skill.

THE PRODUCT
Draft Rescue — a Chrome extension that silently saves what you type into web
page text boxes, on your own computer, and gives it back when a tab crashes or a
form submit loses it. No server, no account, no network access at all. The
selling point is that it's quiet and private, not that it's clever.

SIZES (exact, these are Chrome's)
  Small promo tile:    440 × 280 px PNG
  Marquee promo tile:  1400 × 560 px PNG

WHAT THEY HAVE TO DO
The small tile is seen at thumbnail size in a scrolling row, so it has roughly
one second and about six words. The marquee is much wider than it is tall, so a
composition that works for one will not work for the other — treat them as two
designs, not one design cropped twice.

CONSTRAINTS
- Chrome overlays the extension name and rating on the tile in some placements,
  so keep the bottom third quiet and don't put anything important there.
- No screenshots inside the tile — they become illegible at thumbnail size.
- No promotional language ("Best!", "#1", "Free!"). Chrome rejects that and it
  cheapens a privacy tool anyway.
- Text large enough to survive being rendered at half size.

TONE
Calm and slightly technical. The product's appeal is relief, not excitement —
the feeling of getting back forty minutes of writing you thought you'd lost. A
good tile probably states the problem rather than the product.

Lines worth trying, or better ones of your own:
  "Your browser doesn't save what you type. This does."
  "Forty minutes of writing. One crashed tab."
  "It's already saved."

PALETTE (the extension's own UI colours)
  Deep navy          #1f2333
  Brand indigo       #5a6cf5
  Accent periwinkle  #7c8cff
  White              #ffffff

I'll send you the finished icon separately — leave a clearly marked space for it
if the composition wants one.
```

---

# Prompt 3 — Screenshot treatment

> **Read this before using it.** Chrome screenshots must show the **real
> extension**. A mocked-up interface that does not match what the extension does
> is a listing rejection, and it is dishonest regardless. So this prompt is for
> the *frame* around real captures — background, caption bar, cropping — and
> never for the app content itself.
>
> Capture the five screens first, from the running extension, following
> `store/LISTING.md` for what each one shows. Then hand those captures to this
> prompt.

```
I have five real screenshots from a Chrome extension and I need a consistent
frame for them, using the design skill. Final size 1280 × 800 px PNG each.

IMPORTANT: the screenshots are real captures and their content must not be
altered, redrawn, or recomposed. I need a treatment around them — background,
padding, and a caption — not a redesign of what's in them.

THE PRODUCT
Draft Rescue — a Chrome extension that saves what you type into web page text
boxes, locally, and gives it back when it's lost. Quiet and private.

WHAT I NEED PER SCREENSHOT
- The capture placed on a plain background with generous, consistent padding
- One caption line, same position and same type treatment on all five
- Nothing else: no device mockups, no floating arrows, no drop shadows fighting
  the screenshot's own UI

The five captions, in order:
1. "Your text is one click away, right where you lost it."
2. "Everything you've written, searchable, on your machine only."
3. "Card numbers are replaced before anything is saved."
4. "Keep what you want, for as long as you want."
5. "No host permissions. No network access. Nothing to send."

PALETTE
  Deep navy          #1f2333
  Brand indigo       #5a6cf5
  Accent periwinkle  #7c8cff
  White              #ffffff

Show me all five as a set so I can check they read as one sequence rather than
five separate images.
```

---

## When the icon comes back

Drop the five PNGs into `public/icon/` (16, 32, 48, 96, 128 — the manifest
lists all five), keep the SVG somewhere safe as the master, then:

```bash
npm run build
npm run size          # icons are not in the content script budget, but check anyway
```

Load the unpacked extension and **look at the toolbar**, in both a light and a
dark Chrome theme. That is the only test that counts for a 16 px icon.

`scripts/make-icons.mjs` can be deleted once real icons exist — or kept, since
it documents what the placeholders were. It is not part of the build.
