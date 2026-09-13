# What's next for Draft Rescue

The code is done. Everything left is a decision, a designer, or a form.

Three guidebooks, in the order they actually block each other:

| | Guidebook | Blocks what |
|---|---|---|
| 1 | [Getting it licensed](1-LICENSING.md) | Publishing at all |
| 2 | [Payments and subscriptions](2-PAYMENTS.md) | Earning from it |
| 3 | [Publishing on the Chrome Web Store](3-CHROME-WEB-STORE.md) | Anyone using it |

---

## The short answer: ship it free, first

The temptation after finishing a feature-complete product is to build the
business around it — pricing, licence keys, a payment integration — before
anyone has used it. That is the wrong order, for one specific reason:

**You do not yet know whether it works.**

Not the code. The code has 447 unit tests and five browser suites. But every
test so far has run against fixtures you wrote — pages built to match your
understanding of how editors behave. Gmail, Notion, Jira and LinkedIn did not
read your fixtures. The most valuable information available to this project
right now is fifty strangers using it on sites you have never opened, and none
of it requires a payment system.

Build the paid tier when you have people who would miss the product if it
vanished. Not before.

---

## The order

### Now — one week of work, mostly not coding

| | Task | Guide |
|---|---|---|
| 1 | Pay the $5 developer fee **first** — confirm the card works | [3 § Step 1](3-CHROME-WEB-STORE.md) |
| 2 | Choose GPL-3.0, add `LICENSE`, set `package.json` | [1 § Part A](1-LICENSING.md) |
| 3 | Host `PRIVACY.md` at a real URL | [3 § Step 4](3-CHROME-WEB-STORE.md) |
| 4 | Run `test/MANUAL-CHECKLIST.md` on **real sites** | — |
| 5 | Commission icons | [3 § blockers](3-CHROME-WEB-STORE.md) |
| 6 | Take five screenshots | [3 § Step 3](3-CHROME-WEB-STORE.md) |
| 7 | Submit — **unlisted** | [3 § Step 6](3-CHROME-WEB-STORE.md) |

Step 4 is the one to not skip. It is the only step that can still tell you
something you do not know.

### Next — the first month after it is live

- Switch from unlisted to public once you have used it yourself for a week.
- Read every review. For this product, a one-star review is a bug report with a
  site name attached.
- Fix what the real sites break. They will break something.
- Watch the uninstall rate. It is the only honest metric.

### Then — and only then

- Guidebook 1, Part D: NTN, business bank account, accountant.
- Guidebook 2: decide what the paid tier *is* before deciding how to charge.
- Verify a Merchant of Record pays out to Pakistan **before writing any code**.
- Build offline signed licences, so the privacy claim survives the paid tier.

---

## The two decisions still open

**1. The source licence.** GPL-3.0 recommended — it keeps the code auditable
(which your privacy policy depends on) while making a closed-source commercial
fork a licence violation. `store/SUBMISSION.md` §4 still says "not yet chosen".

**2. The right-click "Recover text here" path.** Specified in §8 of the original
build spec, never built. It needs the `contextMenus` permission, which is one
more line for a reviewer to ask about. The pill covers the common case. Decide
whether it ships in 0.1.0 or waits for evidence that people want it.

---

## One thing not to do

Do not add sync as the paid feature.

It is the most requested feature for any tool like this and the most natural
upgrade, and it would delete the sentence the whole product stands on: *there is
no network code in the extension at all.* If you ever build it, build it as a
separate, clearly-labelled product with its own privacy policy — never as a
silent upgrade to this one.

[Guidebook 2 § Part A](2-PAYMENTS.md) lists seven paid features that keep the
promise intact. The strongest is unlimited retention, because the free tier
makes people feel it: a user who loses something on day eight has just been
shown exactly what they are buying.
