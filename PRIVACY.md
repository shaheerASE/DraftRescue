# Privacy Policy — Draft Rescue

**Last updated: 12 September 2026**

## The short version

Draft Rescue does not collect anything, because it cannot.

There is no server. There is no account. There is no network code in the
extension at all — not disabled, not configurable, absent. Everything it saves
stays in your browser on your own computer, and the only person who can read it
is you.

## What it saves

When you type more than 15 characters into a text box on a web page, Draft
Rescue saves a copy so you can get it back if it disappears.

Each saved draft records:

- the text you typed
- the address of the page you typed it on
- the name or label of the box you typed it in
- the date and time
- for rich text boxes, a cleaned-up copy of the formatting

## What it never saves

These are refused before anything is stored:

- **Passwords.** Any password field — and if you click "show password" to turn
  it into a normal text box, it is still refused, because the extension
  remembers what that box was.
- **One-time codes** and two-factor codes.
- **Card details.** Card number, expiry and security code fields, including the
  hosted card fields used by Stripe, PayPal, Adyen and similar.
- **Anything in a checkout or payment form**, whatever the individual boxes are
  called.
- **Any field whose name or label suggests it holds something sensitive** — a
  PIN, a CNIC, a national ID, a recovery phrase, an API key.
- **Any site you add to the blocklist** in settings.
- **Private (incognito) windows**, unless you deliberately enable it twice: once
  in Chrome's own settings, and again in the extension's.

On top of that, the text itself is checked before it is saved. Anything shaped
like a payment card number — verified with the same checksum banks use — or like
a Pakistani CNIC is replaced with `[redacted]`. This happens no matter which box
it was typed into, so a card number pasted into an ordinary comment is caught
too.

## Where it is stored

In your browser's own storage (IndexedDB), inside the extension's private area
on your computer.

It is not synced. It is not backed up. It does not follow you to another
computer or another browser profile. If you use Chrome on two machines, each has
its own separate copy.

## How long it is kept

Seven days by default. You can change this to one day, thirty days, or forever
in the extension's settings.

Old drafts are deleted automatically. Total storage is capped at 50 MB; past
that, the oldest drafts are removed first.

## What is shared

Nothing.

No analytics. No crash reporting. No telemetry. No advertising identifiers. No
third-party services of any kind. No fonts or stylesheets loaded from anywhere —
everything the extension displays comes from files inside it.

Nothing is sold, because there is nothing to sell and no mechanism to send it.

## You can verify this yourself

You do not have to take our word for any of the above.

- The extension requests no host permissions and no network permissions.
- The source code is open. Clone it and run `npm run check:offline`, which
  inspects the **built** extension — the files that actually run — and fails if
  it finds any way to transmit data, any remote address, or any remotely loaded
  resource.
- Chrome will also tell you. Open DevTools on any page, go to the Network tab,
  and type. Nothing from Draft Rescue appears, because there is nothing to
  appear.

## Deleting your data

- **One draft**: hover it in the extension's popup and click delete.
- **One site**: click "forget site" next to that site's name.
- **Everything**: click "delete everything" at the bottom of the popup, or in
  settings.
- **Everything, permanently**: uninstalling the extension removes all of it.
  Chrome deletes an extension's storage when it is removed.

Deletion is immediate and cannot be undone. There is no copy anywhere else to
delete.

## Children

Draft Rescue is not directed at children and collects no information from
anyone, of any age.

## Changes to this policy

If this policy ever changes, the change will appear in the extension's public
repository with its full history, so you can see exactly what changed and when.

Any future version that sends data anywhere would be a different product, and
would be described as one, plainly, before it did so.

## Contact

Email **shaheerrehan18@gmail.com**, or open an issue in the project's
repository at <https://github.com/shaheerASE/DraftRescue>.

The email reaches M. Shaheer Rehan, who wrote the extension and holds its
copyright. Use it for anything about your data or this policy; an issue is
public, so email is the better channel if what you are asking about is not.

---

<sub>This file is the source of truth. If a copy of this policy hosted elsewhere
ever disagrees with it, this one is correct.</sub>
