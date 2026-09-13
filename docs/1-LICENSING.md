# Guidebook 1 — Getting Draft Rescue licensed

**Who this is for:** you, before the extension is public. Nothing here needs a
lawyer to *understand*, though one item at the end is worth paying one for.

---

## "Licensing" means three different things. You need all three.

People use the one word for three unrelated problems, and mixing them up is why
this feels confusing.

| # | The question it answers | Costs | Blocking launch? |
|---|---|---|---|
| **1. Source licence** | Who may copy, change or resell *your code* | Free | **Yes** |
| **2. User terms** | What a *user* agrees to when they install it | Free (or a lawyer) | Only if you charge |
| **3. Business registration** | How you legally *earn* from it, in Pakistan | Small, ongoing | Only if you charge |

Do them in that order. Number 1 is the only one blocking a free launch.

---

# Part A — The source licence

## Why this one is not optional for you

Your entire marketing position is in `PRIVACY.md`:

> "You do not have to take our word for any of the above... The source code is
> open. Clone it and run `npm run check:offline`."

That sentence only works if people are **legally allowed** to clone it. Source
code published with no licence at all is, by default, *all rights reserved* —
copyright applies automatically the moment you write it. Nobody may legally copy
it, even to check your privacy claim. Your strongest sentence would be an empty
one.

So: a repository that is public but unlicensed is worse than useless here. It is
a contradiction with your own privacy policy.

## The thing most people get wrong

You cannot hide a Chrome extension's code. Anyone can install it, open the
extension folder, and read every line. Minification is not encryption — it is
inconvenience. Reviewers at Google read it. Competitors can read it.

So the licence is **not** a technical protection. It is a legal statement about
what someone is allowed to *do* with code they can already see. Choose it on
that basis and the decision gets much simpler.

## The three real options

### MIT

> Anyone may do anything, including selling a closed-source copy, as long as
> they keep your copyright notice.

- **Good:** zero friction, universally understood, maximum goodwill, easiest to
  get contributors.
- **Bad:** someone can fork it, rename it, add a paywall, and sell it — legally,
  without paying you, without publishing their changes.
- **Right choice if:** Draft Rescue stays free forever and you want it used as
  widely as possible.

### GPL-3.0

> Anyone may use, change and even sell it — but if they distribute it, their
> version must also be open, under GPL.

- **Good:** the code stays auditable (your privacy claim holds), and a
  competitor cannot take it closed-source. They can still sell it, but they must
  publish their improvements, which removes most of the incentive.
- **Bad:** some companies refuse to touch GPL code. Irrelevant for a consumer
  browser extension.
- **Right choice if:** you intend to charge for a paid tier. **This is my
  recommendation.**

### Source-available (PolyForm Noncommercial, Business Source License, or your own terms)

> The source is published so it can be read and audited, but commercial use is
> forbidden.

- **Good:** keeps the audit claim, blocks commercial forks completely.
- **Bad:** you may **not** call it "open source" — that term has a specific
  definition and using it wrongly draws real criticism. Fewer people will engage
  with it.
- **Right choice if:** you are certain this becomes a business and you are
  willing to defend the boundary.

## Recommendation: GPL-3.0

Given the paid tier you are planning, GPL-3.0 gives you both things you need at
once: the code is public and auditable (so `PRIVACY.md` is true), and a
closed-source commercial fork is a licence violation rather than a Tuesday.

The realistic risk of a fork is low anyway — the hard part of this product is
not the code, it is the two hundred small behaviours that make `contenteditable`
work, and those are only visible to someone who has already done the work.

> **Note on AGPL:** the AGPL exists to close the "runs as a web service, never
> distributed" loophole. Draft Rescue has no server. AGPL buys you nothing here.
> Don't use it.

## How to actually apply it

```bash
# 1. Get the exact text — never paraphrase or retype a licence
curl -o LICENSE https://www.gnu.org/licenses/gpl-3.0.txt

# 2. Declare it where tooling looks
#    package.json:  "license": "GPL-3.0-or-later"

# 3. Put the copyright notice and the standard GPL blurb in README.md
```

The FSF also suggests a short notice at the top of every source file. That is
worth doing for a library other people will copy files out of; for a single
application it adds boilerplate to every file and the root notice is enough.

Then add to the top of `README.md`:

```markdown
## Licence

GPL-3.0-or-later. See [LICENSE](LICENSE).

The source is public so the privacy claim in [PRIVACY.md](PRIVACY.md) can be
checked rather than trusted. You may read it, run it, change it and redistribute
it; a redistributed version must also be GPL.
```

And fix the one place that currently contradicts it —
`store/SUBMISSION.md` §4 still says *"Not yet chosen."*

> **Done.** `LICENSE` holds the verbatim GPL-3.0 text, `package.json` declares
> `"license": "GPL-3.0-or-later"`, and `README.md` carries the copyright notice.
> There is no registration step and no fee — copyright exists from the moment you
> wrote the code, and the licence file is what grants everyone else permission.
>
> **One thing is still yours:** the copyright line currently names the git
> identity `shaheerDev`. Replace it with your legal name, or with the registered
> business name if you form one in Part D. A handle is workable but weaker if it
> ever has to be enforced.

---

# Part B — The user terms

## Do you need them?

- **Free extension only:** no. Google's own terms cover the install. A terms
  document is polite, not required.
- **The moment you take money:** yes. Without written terms, a dispute is
  decided by whatever the user assumed, and a refund fight has no rules.

## What it has to contain

Seven things. Anything else is padding.

1. **What the software does** — one honest paragraph. Overpromising here is what
   creates liability.
2. **What it does not do** — explicitly: it is not a backup service, it does not
   guarantee recovery, it stores data only on the user's own device and that
   device can fail.
3. **No warranty** — the software is provided "as is". This is standard and
   every licence above already says it, but repeat it in plain words.
4. **Limitation of liability** — cap it at what they paid you. If someone loses
   a contract because a draft was not saved, you cannot be on the hook for the
   contract.
5. **Subscription terms** — billing period, renewal, cancellation, and what
   happens to their data when they stop paying. (Answer: *nothing happens to
   their data.* See Guidebook 2.)
6. **Refunds** — state a window. 14 days, no questions, is standard and cheaper
   than arguing.
7. **Governing law** — Pakistan, and name a city. Without this, you can be
   dragged into a foreign court.

## Where it lives

Same place as the privacy policy. If you publish `PRIVACY.md` via GitHub Pages,
publish `TERMS.md` alongside it, from the same repository, so they can never
drift apart.

> If you use a Merchant of Record (Paddle, and friends — see Guidebook 2),
> **their** terms govern the actual sale and they handle consumer-protection
> rules in each country. Yours then only need to cover the software itself,
> which makes them much shorter.

---

# Part C — The name

"Draft Rescue" is descriptive, which makes it easy to understand and *hard to
protect*. Trademark law gives weak protection to names that plainly describe
what the product does.

## Do this now — it is free and takes an hour

1. Search the **Chrome Web Store** for "draft rescue", "draft saver", "text
   recovery". You are checking for a name collision that would get your listing
   rejected or confused.
2. Search **USPTO TESS** (`tmsearch.uspto.gov`) for "draft rescue" in class 9
   (software). You are checking nobody has registered it in your biggest market.
3. Search **IPO-Pakistan** for the same.
4. Buy the domain — `draftrescue.com` or whatever is free. Under $15/year, and
   you need a URL for the privacy policy anyway.

## Do this later — not now

Registering a trademark costs real money (USPTO is roughly $250–350 per class,
plus a lawyer if you want it to survive) and takes 8–12 months. Do it when the
product has users and revenue worth defending. Not before.

Using a name publicly gives you some rights in most jurisdictions just by using
it. Launching is itself the first defensive move.

---

# Part D — Business registration in Pakistan

> **Verify everything in this section with a local accountant before acting.**
> Pakistani tax rules for IT exports change with almost every federal budget,
> and specific rates quoted anywhere online — including here — go stale fast.
> What follows is the *shape* of the problem, so you know what to ask about.

## Why you cannot skip this once money moves

Foreign income arriving in a personal account with no declared source is a
problem with your bank and with FBR, not with your customers. It is much easier
to set up correctly first than to explain it afterwards.

## The two structures

**Sole proprietorship** — cheapest and fastest.

- Get an **NTN** (National Tax Number) from FBR — online, free.
- Open a **business bank account** in your trading name.
- You and the business are the same legal person: your personal assets are not
  separated from business liabilities.
- Right for: starting out, revenue under a few thousand dollars a month.

**SMC-Private Limited (single-member company)** — registered with **SECP**.

- Costs money to register and requires annual filings and an auditor.
- Your liability is limited to the company.
- Right for: when revenue is meaningful, or when a partner or investor appears.

**Start as a sole proprietor.** Converting later is routine.

## PSEB registration

The **Pakistan Software Export Board** maintains a register of IT exporters.
Registration is cheap and is the gateway to the reduced-tax treatment for IT and
IT-enabled services exports, plus access to certain banking facilities.

Ask your accountant specifically about:
- the current concessionary tax rate on IT export proceeds, and its conditions
- whether it requires proceeds to arrive through banking channels within a set
  period
- whether your chosen payment processor's payout route qualifies

That last question is the one that connects this guidebook to the next one, and
it is the one people discover too late.

## Receiving the money

The **State Bank of Pakistan** has specific facilities for freelancers and IT
exporters — including foreign-currency accounts that let you retain a portion of
export earnings in dollars. Your bank's trade/export desk will know the current
scheme names. Ask for them by name rather than at a retail counter.

---

## The order to do things in

```
NOW (blocking a free launch)
  1. Choose GPL-3.0, add LICENSE, set package.json "license"
  2. Update store/SUBMISSION.md §4
  3. Name searches + buy the domain
  4. Host PRIVACY.md at a real URL

BEFORE YOU TAKE ANY MONEY
  5. NTN + business bank account
  6. Write TERMS.md, publish alongside PRIVACY.md
  7. Accountant conversation: PSEB, export tax treatment, payout route
  8. Then, and only then, Guidebook 2
```

**Nothing in Part D blocks publishing a free extension.** If the paid tier is a
"maybe later", do steps 1–4 this week and stop.
