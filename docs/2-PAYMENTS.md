# Guidebook 2 — Payments and a subscription tier

**Read Guidebook 1 first.** You cannot legally take money before the business
side exists.

---

## Two facts that decide everything

**1. Google does not handle payments for you.** Chrome Web Store payments were
shut down in 2021. There is no "set a price" field. Every paid extension brings
its own payment processor and its own licence check. You are building this
yourself.

**2. Stripe does not operate in Pakistan.** This rules out most of the obvious
tooling, because a very large share of the developer payment ecosystem is Stripe
underneath. You already knew this — it is why ExtensionPay and BrowserBill were
rejected early. It has a further consequence you may not have priced in yet:

> **Lemon Squeezy was acquired by Stripe in 2024.** The plan you had been
> carrying — "use Lemon Squeezy, not the Stripe-backed options" — may no longer
> describe a non-Stripe option. **Verify their current payout support for
> Pakistan before you build anything against them.** This is the single most
> important thing to check in this entire guidebook, and it is a five-minute
> check.

---

# Part A — Decide what you are selling first

Do not start with the processor. Start with the product, because one of the
obvious paid features would destroy the thing that makes this product worth
buying.

## The feature you must think hard about: sync

"Sync my drafts across devices" is the most requested feature for any tool like
this, and the most natural paid tier. It is also the end of this:

> "There is no server. There is no account. There is no network code in the
> extension at all — not disabled, not configurable, absent."
> — `PRIVACY.md`

Sync means a server, an account, your drafts in transit, your drafts at rest on
someone else's disk, a breach surface, and a completely different privacy policy.
It turns "nobody can read this but you" into "trust us". The extension you have
built is *unusually* defensible precisely because it makes no such request.

If you ever build sync, build it as a **separate, clearly-labelled product** with
its own privacy policy and its own opt-in — never as a silent upgrade to this
one. And build it with end-to-end encryption or not at all.

## Paid features that keep the promise intact

Every one of these is local-only, so `check:offline` still passes and the privacy
policy does not change by a word:

| Feature | Why someone pays for it |
|---|---|
| **Unlimited retention** | Free tier keeps 7 days. Paid keeps everything. |
| **Search across every draft** | The popup search exists; make it full-text and fast over months of history |
| **Export** | Download everything as Markdown/JSON. Their data, their file. |
| **Pin and label drafts** | "Keep this one forever" — turns a safety net into a notebook |
| **Version timeline** | You already store versions. Show them, let people step back through a draft's history. |
| **Per-site rules** | Capture aggressively here, never there, longer retention on this domain |
| **Encrypted local backup** | One file, passphrase-protected, that survives a reinstall |

The strongest of these is **unlimited retention**, because it is the one the free
tier makes people feel. A user who loses something on day eight has just been
shown exactly what they are buying.

## What to charge

For a single-purpose utility bought by individuals:

- **$2–4 / month**, or
- **$18–30 / year** (price the year at roughly 8 months of the monthly), or
- **a one-time "lifetime" price around $30–50.**

For a tool with no server costs, a lifetime option is unusually sensible — you
have no ongoing cost per user, so you are not selling something you must keep
paying to deliver. It also sidesteps a lot of subscription machinery. Consider
offering both: monthly for people who want to try, lifetime for people who hate
subscriptions.

**Keep a genuinely useful free tier.** The extension's value is that it is
already running when disaster strikes. A crippled free tier means it is not
installed, which means it is not there when it matters, which means nobody ever
upgrades.

---

# Part B — The architecture problem (the important part)

## Why the obvious approach breaks the product

The normal way to check a licence is: the app calls your server, the server says
yes or no. If you do that here:

- `npm run check:offline` **fails** — it is designed to fail on exactly this.
- The listing line *"There is no network code in the extension at all"* becomes
  false, and you would have to remove it.
- `store/PERMISSIONS.md` answers "Remote code: No" and "transmits nothing" —
  both need rewriting, and the Chrome reviewer re-reads them.
- A reviewer who sees an extension with `<all_urls>` **and** a network call is
  looking at a much more suspicious product than the one you have now.

You would be trading your single best competitive advantage for a licence check.
Don't.

## Design A — offline signed licences (recommended)

The idea in one sentence: **your server signs a small statement, the extension
checks the signature locally, and the two never speak.**

```
  YOUR SERVER                          THE USER                    THE EXTENSION
  ───────────                          ────────                    ─────────────
  payment webhook fires
        │
        ├─ builds claims:
        │    { plan, exp, sub }
        │
        ├─ signs with PRIVATE key  ──►  gets key by email  ──►  pastes into Settings
        │                                                              │
        │                                                    verifies with PUBLIC key
        │                                                    baked into the bundle
        │                                                              │
        │                                                    ◄── no network call, ever
```

The extension ships the **public** key only. A public key can verify a
signature but cannot create one, so a user who reads your entire source — which
you want them to do — still cannot mint themselves a licence.

### What a licence key looks like

Two base64url chunks joined by a dot, like a miniature JWT:

```
eyJwbGFuIjoicHJvIiwiZXhwIjoxNzk5OTk5OTk5MDAwLCJzdWIiOiJhOWYzIn0.MEUCIQ...
└──────────────── claims ────────────────┘ └───── signature ─────┘
```

The claims are deliberately tiny and carry **no personal data** — a plan name, an
expiry timestamp, and an opaque subscriber id. Not an email address. If a key
leaks, it reveals nothing about who bought it.

### Signing it (your server — runs once per payment)

```js
// ONE TIME, on your machine: generate the pair and keep the private key secret.
const { publicKey, privateKey } = await crypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' },
  true,
  ['sign', 'verify'],
);

// In the payment webhook:
async function issueLicence(privateKey, plan, expiresAt, subscriberId) {
  const claims = { plan, exp: expiresAt, sub: subscriberId };
  const body = b64url(new TextEncoder().encode(JSON.stringify(claims)));

  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    new TextEncoder().encode(body),
  );

  return `${body}.${b64url(new Uint8Array(signature))}`;
}
```

### Verifying it (inside the extension — no network)

```ts
/**
 * The public half of the signing key, baked in at build time.
 *
 * Safe to publish: it can check a signature and cannot produce one. Reading this
 * file does not let anyone mint a licence.
 */
const PUBLIC_KEY_B64 = '<the raw P-256 public key, base64url>';

export interface Licence {
  plan: string;
  /** Milliseconds since the epoch. */
  exp: number;
  sub: string;
}

export async function verifyLicence(token: string): Promise<Licence | null> {
  const [body, signature] = token.trim().split('.');
  if (!body || !signature) return null;

  const key = await crypto.subtle.importKey(
    'raw',
    fromB64url(PUBLIC_KEY_B64),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );

  const ok = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    fromB64url(signature),
    new TextEncoder().encode(body),
  );
  if (!ok) return null;

  const claims = JSON.parse(new TextDecoder().decode(fromB64url(body))) as Licence;
  if (typeof claims.exp !== 'number' || claims.exp < Date.now()) return null;

  return claims;
}
```

`crypto.subtle` is not a network API, so **`npm run check:offline` still
passes untouched** and every claim in `PRIVACY.md` stays literally true. That is
the whole point of this design.

> **Why ECDSA P-256 and not Ed25519?** Ed25519 is the nicer algorithm and the
> code is shorter, but WebCrypto support for it arrived in Chrome much later.
> P-256 has been available in every Chrome you will ever meet. Use Ed25519 only
> if you are happy to require a recent Chrome.

### Where it runs

Verify in the **service worker**, not the content script:

- the service worker has `crypto.subtle` and is the only writer to storage
  already — the entitlement belongs next to the data it gates;
- the content script has a 20 KB budget you are only using 41% of, and no reason
  to spend any of it on billing;
- a content script runs inside someone else's page, and licence state has no
  business being there.

Store the token in `chrome.storage.local`, re-verify it when the service worker
wakes, and cache the result in memory for that wake only — remember module-level
variables die with the worker.

### The honest limitations

| Limitation | Why it is acceptable here |
|---|---|
| **A key can be shared.** One person buys, posts it on a forum. | True of every offline licence ever made. At $3/month the engineering to stop it costs more than the loss. Ship a friendly product, not DRM. |
| **You cannot revoke a key.** No network call means no kill switch. | Cap the damage with expiry instead: issue keys valid for the billing period plus a grace window, and re-issue on renewal. |
| **The user can set their clock back.** | Yes. Someone determined enough to change their system clock every month to avoid $3 was never going to pay. |

If piracy ever becomes a real problem — which, for a utility at this price, it
almost certainly will not — that is the moment to add a network check, not
before.

## Design B — network only in the settings page (the fallback)

If you decide you need real activation and revocation, contain it:

- the **settings page** may call your licence server, once, when the user pastes
  a key or clicks "refresh licence";
- the **content script** and the **service worker's capture path** stay offline;
- narrow `scripts/check-offline.mjs` to assert exactly that — content script and
  background contain no network API, and the options page contacts exactly one
  declared host;
- rewrite the relevant lines of `PRIVACY.md` precisely: *"the settings page
  contacts our licence server when you activate a subscription; your drafts never
  do, and the part of the extension that reads what you type has no network
  access at all."*

That is still a strong, honest claim. It is just weaker than the one you have
now, and it costs you a `host_permissions` entry that a reviewer will ask about.

## Design C — a licence check in the content script

Never. It would mean a network call from inside every page the user visits, on
an extension that already reads what they type. It is the single fastest way to
turn a careful privacy product into a rejected one.

---

# Part C — Choosing a processor from Pakistan

## First: what a Merchant of Record is, and why you need one

When you sell software to a person in Germany, German VAT is owed. In the UK, UK
VAT. In several US states, sales tax. In Australia, GST. Roughly fifty
jurisdictions have rules, thresholds and filing schedules, and "I am a solo
developer in Pakistan" is not an exemption in any of them.

A **Merchant of Record (MoR)** becomes the legal seller. They take the money,
they owe the tax, they file the returns, they handle chargebacks and refunds and
invoices, and they pay you a share. You are then selling to *them*, once, which
is a single clean export transaction — exactly what your accountant wants to
see for the IT-export treatment in Guidebook 1.

**A plain payment gateway does not do this.** It moves money and leaves every tax
obligation with you. For a solo developer selling worldwide, an MoR is not a
convenience, it is the only realistic option.

The cost is roughly **5% + $0.50** per transaction, versus ~3% for a bare
gateway. The 2% is the cheapest tax department you will ever hire.

## The candidates

> **Everything in this table must be verified today.** Country support, payout
> rails and ownership all change, and I would rather you check than trust a
> document. Treat this as a list of what to search for, not as an answer.

| Provider | MoR? | What to verify for Pakistan |
|---|---|---|
| **Paddle** | Yes | Payout countries and payout rail (bank transfer / Payoneer). Historically the strongest non-Stripe MoR. **Check first.** |
| **Lemon Squeezy** | Yes | **Now Stripe-owned.** Whether payouts still work for Pakistan post-migration. |
| **FastSpring** | Yes | Supported seller countries; minimum payout thresholds; whether they accept solo developers |
| **Gumroad** | Yes | Payout methods available to Pakistan |
| **Polar.sh / Creem** | Yes | Newer, developer-focused. Younger companies — check how long they have been paying out, and to where. |
| **Payoneer** | No | Not a processor — a way to *receive*. Widely used in Pakistan. Some MoRs pay out into it. |

## The questions to ask before writing any code

Send these, in this order, to the support desk of your top candidate. Get the
answers in writing.

1. Can a seller **resident in Pakistan** open an account and receive payouts?
2. What is the **payout method** — bank wire to a Pakistani bank, Payoneer, or
   something else? What is the minimum payout and the fee?
3. Are you the **Merchant of Record**? Do you remit VAT/GST/sales tax on my
   behalf, in every country?
4. Do you support **subscriptions with webhooks** I can sign a licence key from?
5. What documentation do you need from me — NTN, bank details, ID, business
   registration?
6. Are there **restrictions on browser extensions** as a product category?

A provider that cannot answer #1 and #2 clearly is not a candidate, however good
their documentation looks.

## The US LLC route — honest version

Many Pakistani developers form a **US LLC** (via Stripe Atlas, Firstbase, doola,
or a plain registered agent in Wyoming or Delaware) specifically to access Stripe
and the ecosystem built on it. It is a legitimate, well-trodden path. It is also
not free and not effortless:

**Costs, roughly:** $300–500 to form, $50–150/year registered agent, $50–300/year
state franchise or annual report fees, plus an accountant.

**The obligation people miss:** a foreign-owned single-member US LLC must file
**IRS Form 5472 with a pro-forma Form 1120** every year, even with zero income.
The penalty for missing it starts at **$25,000**. This is not a scare story, it
is the standard penalty. If you take this route, budget for a US accountant from
day one — not from year two when the letter arrives.

**Also:** you still have to get the money from the US LLC to yourself in
Pakistan, and declare it there. The LLC does not make the Pakistani side go away;
it adds a second set of books.

**My view:** try hard to find an MoR that pays out to Pakistan directly. Only
form a US entity if revenue is real and the direct route genuinely does not
exist. Forming a company to sell a $3/month extension you have not launched yet
is the wrong order.

---

# Part D — Building it, in order

Only start this once you have users. See "What's next" at the end.

### 1. Server (about 100 lines)

A single endpoint on Cloudflare Workers, Vercel, or Deno Deploy:

- receives the **webhook** from your MoR when a subscription starts, renews or
  cancels;
- **verifies the webhook signature** — never trust an unsigned webhook, it is a
  public URL;
- builds claims `{ plan, exp, sub }` where `exp` is period end plus a grace
  window;
- signs them with the private key;
- **emails the key** to the buyer.

The private key lives in the platform's secret store. If it ever leaks, every
licence ever issued is forgeable and you must rotate the key and re-issue
everything — so treat it accordingly, and keep an offline copy somewhere safe,
because losing it is just as bad.

### 2. Extension: the settings page

Add to `entrypoints/options/Options.tsx`:

- a field to paste a licence key;
- verify it locally, show the plan and the expiry date in plain words
  ("Pro — active until 14 March 2027");
- a "remove licence" button, because people switch machines;
- when there is no key, a short honest line about what the paid tier adds and a
  link to buy. **One line. No banner, no modal, no upsell in the pill.** The
  product's whole character is that it does not interrupt.

### 3. Extension: gating

Gate in the **service worker**, at the point of decision:

- `purgeExpired` reads the retention setting — a free user's maximum is 7 days,
  a paid user's is unlimited;
- the popup's search, export and pin actions check the entitlement before acting.

### 4. When a subscription lapses — the rule that matters most

**Never delete the user's drafts because they stopped paying.**

Stop capturing *new* drafts beyond the free limit if you must. Keep every draft
they already have, readable and exportable, forever. Deleting someone's writing
because a card expired is the kind of thing that produces a one-star review with
a screenshot, and they would be right.

A humane lapse looks like: full access → 7-day grace → free-tier limits apply to
new captures → old drafts stay readable and exportable indefinitely.

### 5. Things that will bite you

- **Test the whole path with the provider's sandbox**, including a *failed*
  renewal and a cancellation, before going live.
- **Refunds**: state a 14-day window and honour it without argument. It is
  cheaper than the review.
- **Chargebacks**: the MoR absorbs the process, but repeated chargebacks can get
  an account reviewed. Refund quickly instead.
- **Your own tax**: MoR payouts are export income. Keep every payout statement
  for your accountant.
- **Never put the private key in the repository.** Add a check for it if you have
  to. A leaked signing key is unrecoverable.
