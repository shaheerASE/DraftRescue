# Guidebook 3 — Publishing on the Chrome Web Store

`store/SUBMISSION.md` is the short checklist. **This is the long version** — what
each step actually looks like, what review will do, and what to say when they
push back.

---

## The five things blocking you right now

Nothing below matters until these exist. Four of the five need a person, not
code.

| # | Blocker | Who | Roughly |
|---|---|---|---|
| 1 | **Icons** — 16/32/48/128 px PNG | A designer | 1–3 days |
| 2 | **Screenshots** — five, 1280×800 | You | An afternoon |
| 3 | **Hosted privacy policy URL** | You | 30 minutes |
| 4 | **A source licence** | You — Guidebook 1 | 10 minutes |
| 5 | **Developer account** — $5, one-time | You | 15 minutes |

Plus one that is not on Google's list but is on mine:

| 6 | **`test/MANUAL-CHECKLIST.md` run on real sites** | You | Half a day |

You have tested the fixtures. The fixtures prove the mechanism. The checklist
proves the product, and the listing describes the product.

---

## Step 1 — The developer account

Go to `chrome.google.com/webstore/devconsole`, sign in with the Google account
you intend to own this forever (not a throwaway — transferring an item later is
painful), and pay the **one-time $5 USD** registration fee.

> **From Pakistan:** this is a Google Payments charge, not Stripe, so the
> restriction that rules out much of the payment ecosystem does not apply here.
> An international debit or credit card should work. **Do this first, before any
> other work** — if the card is declined you want to know now, not after the
> screenshots are done.

You will also need to verify a **contact email**, which is published on your
listing. Use an address you will still read in two years. Google may ask for
further identity verification depending on your account and region; have ID
ready.

---

## Step 2 — Build the package

```bash
npm test              # 447 unit tests
npm run compile       # typecheck
npm run build
npm run check:offline # proves the privacy claim against the BUILT files
npm run smoke         # capture path, real browser
npm run smoke:prompt  # the restore prompt
npm run smoke:restore # the restore engine
npm run smoke:ui      # popup and settings
npm run size          # content script under its 20 KB budget
npm run zip           # → .output/draft-rescue-0.1.0-chrome.zip
```

All ten must pass. `npm run zip` produces the file you upload.

> **Version numbers are one-way.** Chrome will not accept the same version twice
> and will not accept one lower than a published version. Bump `version` in
> `package.json` before every single upload — even to fix a typo in a screenshot
> caption. There is no undo.

---

## Step 3 — The listing

In the dashboard: **Items → Add new item → upload the zip.** The form then opens.

Every field below already has copy written for it. Paste, do not improvise.

| Dashboard field | Where the copy is |
|---|---|
| Name | `store/LISTING.md` → Name |
| Short description (132 char max) | `store/LISTING.md` → Short description |
| Detailed description | `store/LISTING.md` → Detailed description |
| Category | **Productivity** (not Developer Tools) |
| Language | English |
| Screenshots (up to 5) | You capture them; captions in `store/LISTING.md` |
| Store icon (128×128) | From your designer |
| Privacy policy URL | The URL from Step 4 below |
| Single purpose | `store/LISTING.md` → Single purpose |
| Permission justifications | `store/PERMISSIONS.md` — one per permission |

### The "after the checklist" paragraph

`store/LISTING.md` ends with an alternate section that names real sites — Gmail,
LinkedIn, Reddit, Notion, Jira, X, Upwork, WordPress. **Do not paste it until
you have actually tested each one**, and drop any site that failed rather than
softening the sentence. A named site that does not work is a one-star review
with a quotable complaint attached.

### Screenshots

Five, 1280×800 (or 640×400) PNG. Captions are in `store/LISTING.md`.

Take them from the real extension with realistic content. Never mock them up — a
screenshot that does not match behaviour is a rejection, and it is dishonest
anyway. Use content you are happy for strangers to read; whatever is in those
images is public forever.

The fifth one — a screenshot of the extension's own Chrome permissions page — is
unusual and worth doing. The biggest objection to a tool that reads what you type
is "why should I trust this", and a picture of an empty permission list answers
it faster than any paragraph.

---

## Step 4 — Host the privacy policy

Chrome requires a **publicly reachable URL**. A file in the repository is not
enough for the form, even though it is the source of truth.

The cheapest option that will not rot is **GitHub Pages on this repository**:

```
Repository → Settings → Pages
  Source: "Deploy from a branch"
  Branch: your default branch,  Folder: / (root)
```

`PRIVACY.md` sits at the repository root, so it is then served at
`https://<your-github-username>.github.io/DraftRescue/PRIVACY` — GitHub renders
the Markdown as a page. Load that URL in a private window before you paste it
into the dashboard; a 404 there is a rejection.

Whatever you pick, keep `PRIVACY.md` in the repo as the canonical copy and
publish *from* it, so the two can never disagree. Publish `TERMS.md` the same way
once it exists.

---

## Step 5 — Privacy practices

The section reviewers read most carefully. Answers are in `store/PERMISSIONS.md`:

| Question | Answer |
|---|---|
| Personally identifiable information | No |
| Health information | No |
| Financial and payment information | No |
| Authentication information | No |
| Personal communications | **No** — see below |
| Location | No |
| Web history | No |
| User activity | No |
| Website content | **No** — see below |

Then tick all three certifications (no selling data, no unrelated use, no
creditworthiness use).

**Why "Personal communications" and "Website content" are No.** These are the two
a reviewer might expect a Yes on, since the extension genuinely reads text the
user types. The dashboard's question is about **collection** — whether data is
transmitted to the developer or a third party. Draft Rescue transmits nothing.
There is no server to receive it.

If queried, that is the whole answer, in one sentence, with an offer to
demonstrate. Do not argue it at length.

---

## Step 6 — Submit, and wait

Choose visibility:

- **Public** — listed and searchable.
- **Unlisted** — reachable by direct link only. **Consider starting here.** You
  get a real install, on a real Chrome, from a real store listing, without the
  whole internet watching the first version. Switch to Public once you have used
  it yourself for a week.
- **Private** — specific accounts only. Useful for testing with friends.

Then **Submit for review**.

### What to expect

**Days, not hours.** An extension that reads text on every site sits in the
most-scrutinised category there is. A first review of one to three weeks is
normal, and this one may be slower than average because of `<all_urls>`.

**Do not resubmit while a review is pending.** It restarts the queue.

Use the wait: run the manual checklist on real sites, write `TERMS.md`, do the
name searches from Guidebook 1.

---

## Step 7 — Rejections, and what to say

Five are predictable. All five have an answer already written.

### "Why do you need access to all websites?"

The hardest question and the one they are really asking.

**Answer:** the block already written in `store/PERMISSIONS.md` — text is lost on
any site, there is no way to know in advance which site a given user will lose
work on, so the content script must run wherever they type.

**Do not hedge, and do not offer to narrow the list.** A narrower list makes the
product not work, and a developer who immediately offers to reduce a permission
signals that they did not need it.

### "Your listing says nothing is uploaded. Demonstrate it."

**Answer:** the package contains no network API and requests no host permissions.
`npm run check:offline` is the demonstration, and it runs against the built files
rather than the source. Offer it. Do not lecture.

### "Single purpose is not clear."

Usually triggered by a description that promises more than one thing. Your single
purpose line is one sentence and the description supports it. If challenged,
quote the sentence back and point at which paragraph supports which part.

### "Permission justification insufficient."

Means the text was too short or too generic. Yours are written literally and
match what the code does. Re-paste from `store/PERMISSIONS.md` in full — do not
summarise.

### "Privacy policy does not match declared practices."

Means the hosted policy says something the form does not, or the URL 404s. Check
the URL loads in a private window, and that the hosted copy is current.

### How to reply

One message. Answer the specific question, point at the specific file or command,
offer nothing extra. Reviewers process a lot of these; brevity and precision get
you through faster than enthusiasm.

---

## Step 8 — After it goes live

**Read every one-star review.** For this product they will mostly be "it didn't
work on <site>", which is a bug report with a site name attached — the most
useful thing you can get.

**Watch for anything about data.** If a user ever believes their drafts left
their machine, answer publicly and immediately, and point at the verification
step. A privacy claim that goes unanswered is assumed false.

**Keep the manual checklist current.** Sites rewrite their editors. Something
that works at launch will break, and it will break *quietly* — nobody reports a
thing that silently stopped saving, they just uninstall.

**Watch the dashboard's item metrics** — weekly users, uninstalls, impressions to
installs. Uninstall rate is the honest number.

---

## Step 9 — Shipping updates

```bash
# 1. Bump version in package.json     (never repeat, never go down)
# 2. Full suite: test, compile, build, check:offline, all four smokes, size
# 3. npm run zip
# 4. Dashboard → your item → Package → Upload new package
# 5. Submit for review
```

Updates review faster than the first submission, usually hours to a couple of
days — **unless** you add a permission, which sends you back to full review.

Use **staged rollout** for anything risky: release to a percentage of users
first, watch the error reports, then widen. For an extension that touches every
page, this is worth the extra step.

---

## Pre-flight checklist

Print this. Tick it before you press Submit.

```
PACKAGE
  [ ] version bumped in package.json
  [ ] npm test               447 passing
  [ ] npm run compile        clean
  [ ] npm run build          clean
  [ ] npm run check:offline  all four checks pass
  [ ] npm run smoke          all pass
  [ ] npm run smoke:prompt   all pass
  [ ] npm run smoke:restore  all pass
  [ ] npm run smoke:ui       all pass
  [ ] npm run size           under 20 KB
  [ ] npm run zip            file exists

BY HAND
  [ ] test/MANUAL-CHECKLIST.md run on real sites
  [ ] any site that failed is NOT named in the listing

ASSETS
  [ ] real icons at 16 / 32 / 48 / 128 px
  [ ] five screenshots from the real extension
  [ ] no private content visible in any screenshot

LISTING
  [ ] name, short + detailed description pasted from store/LISTING.md
  [ ] category: Productivity
  [ ] single purpose sentence pasted
  [ ] justification pasted for storage, alarms, and the content script
  [ ] remote code: No

LEGAL
  [ ] LICENSE file present, package.json "license" set
  [ ] privacy policy URL loads in a private window
  [ ] privacy practices table answered and all three certifications ticked
  [ ] TERMS.md hosted — only if you are charging
```
