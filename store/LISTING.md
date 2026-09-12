# Chrome Web Store listing copy

Paste-ready. Field limits are Chrome's.

> **A note on claims before you paste anything.** Everything below describes
> capability in general terms and names no specific website. That is deliberate:
> a store listing is a public claim, and a listing that promises "works in
> Gmail, Notion and LinkedIn" when those have not been tested end to end is both
> a policy risk and a promise to users you have not verified. There is a variant
> at the bottom to use **after** `test/MANUAL-CHECKLIST.md` has been run on real
> sites — not before.

---

## Name

*(45 characters shown in search; 75 allowed)*

```
Draft Rescue — recover text you lost
```

---

## Short description

*(132 characters max. This is the line people actually read.)*

```
Saves what you type, on your own device, so a crashed tab or a failed form never costs you an hour of writing again.
```

**115 characters.** Alternatives, if you want a different emphasis:

```
Never lose a long reply again. Draft Rescue quietly saves what you type — on your machine only, never uploaded.
```

```
Your browser doesn't save what you type. This does — locally, privately, and it gets it back for you in one click.
```

---

## Category

**Productivity** — not Developer Tools. The people who lose an hour of writing
are writing job applications and support tickets, not debugging.

---

## Single purpose

*(Chrome requires one sentence. Reviewers check the rest of the listing against
it, so keep it narrow.)*

```
Draft Rescue saves text the user types into web page fields to local storage on their own device, and lets them restore it if it is lost.
```

---

## Detailed description

```
You spend forty minutes writing something in your browser — a job application, a
long reply, a support ticket, a bug report. Then the tab crashes. Or you hit
back. Or your login expired and submitting throws you to a sign-in page.

It's gone. No undo, no draft, nothing.

Draft Rescue saves what you type as you type it, on your own computer, and gives
it back.


HOW IT WORKS

Type more than a few words into any text box and it's saved, quietly, about a
second after you stop typing. You'll never notice it happening.

When you come back to an empty box it recognises, a small button appears in the
corner offering your text back. One click and it's there. It never fills a box
in for you, and it never appears over something you're already writing.

Everything you've saved is in the extension's popup — grouped by site, with a
search box. Copy anything, delete anything, or delete all of it.


IT WORKS IN REAL EDITORS

Most text you write online isn't in a simple text box any more. Comment boxes,
post composers and document editors are built with rich text editors, and
putting text back into one isn't the same as filling in a form field — do it
wrong and the text appears for a second and then silently disappears.

Draft Rescue puts text back through the browser's own editing pipeline, so the
editor accepts it the same way it accepts typing. Undo still works afterwards.


IT NEVER SAVES YOUR SECRETS

Refused before anything is stored:

• Password fields — including after you click "show password"
• One-time codes and two-factor codes
• Card numbers, expiry dates, security codes
• Anything inside a checkout or payment form
• Fields named like a PIN, a national ID, a recovery phrase or an API key
• Any site you add to the block list
• Private windows, unless you turn it on deliberately

And separately, the text itself is checked: anything shaped like a payment card
number — verified with the same checksum banks use — is replaced with
[redacted] before it's saved. That catches a card number pasted into an ordinary
comment box, which no amount of checking field names would.


NOTHING LEAVES YOUR COMPUTER

There's no server. No account. No sign-in. No analytics, no crash reporting, no
telemetry, no ads.

This isn't a promise about what we choose to do with your data. There is no
network code in the extension at all. It requests no permission to reach any
website's server, and it doesn't even load its own fonts from anywhere — every
pixel it draws comes from files inside it.

You can check this yourself. The source is open, and running one command against
the built extension will tell you whether any way to transmit data exists in it.


YOU'RE IN CONTROL

• Pause saving entirely, without uninstalling
• Keep drafts for 1 day, 7 days, 30 days, or forever
• Block any site you don't want it running on
• See exactly how much is stored
• Delete one draft, one site, or everything — immediately and permanently


Free. No account. No upgrade prompts.
```

---

## Screenshot captions

*(Chrome shows up to five, 1280×800 or 640×400. Captions are optional and most
listings waste them. Use them to answer the question the image raises.)*

1. **The moment it matters** — the restore button on an empty text box.
   *"Your text is one click away, right where you lost it."*
2. **The popup** — history grouped by site.
   *"Everything you've written, searchable, on your machine only."*
3. **A redacted card number** — proof the safety net is real.
   *"Card numbers are replaced before anything is saved."*
4. **Settings** — retention, block list, storage meter.
   *"Keep what you want, for as long as you want."*
5. **The permissions** — a screenshot of the extension's Chrome details page.
   *"No host permissions. No network access. Nothing to send."*

Screenshot 5 is unusual and worth doing. The single biggest objection to an
extension that reads what you type is "why should I trust this", and a picture
of the permission list answers it faster than any sentence.

---

## After the manual checklist passes

Once `test/MANUAL-CHECKLIST.md` has been run on real sites and they work, this
paragraph can replace the "IT WORKS IN REAL EDITORS" section — naming sites is a
much stronger claim, and by then it will be a true one:

```
IT WORKS WHERE YOU ACTUALLY WRITE

Tested in the editors people lose real work in — including Gmail, LinkedIn,
Reddit, Notion, Jira, X, Upwork and WordPress. Comment boxes, post composers and
document editors, not just simple form fields.
```

**Only paste this once every site in that list has actually been checked.** Drop
any site that did not pass rather than softening the sentence. A named site that
does not work is a one-star review with a specific, quotable complaint.
