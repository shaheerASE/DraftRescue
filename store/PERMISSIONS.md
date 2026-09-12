# Permission justifications

Chrome's developer dashboard asks for a written justification per permission,
and refuses the submission without one. Paste each block below into the matching
field.

Keep these short and literal. A reviewer is checking that the stated reason
matches what the code does, not reading an essay.

---

## `storage`

> Draft Rescue stores the user's settings — whether capture is paused, how long
> to keep drafts, and the list of sites to never capture on — using
> chrome.storage.local. The content script reads these settings on every page to
> decide whether to capture at all, and chrome.storage is the only store a
> content script and the service worker can both reach. Saved drafts are not
> stored here; they are in the extension's own IndexedDB, which requires no
> permission.

---

## `alarms`

> Draft Rescue deletes drafts older than the user's chosen retention period. A
> Manifest V3 service worker is terminated after roughly 30 seconds of idle, so
> setInterval cannot run a periodic job. chrome.alarms is used to wake the
> service worker every six hours to run that deletion, and for nothing else.

---

## Host permission — content script on `<all_urls>`

> Draft Rescue's single purpose is recovering text the user typed into a web
> page and lost. Text is lost on any site — a job application, a support ticket,
> a forum reply, a bug report — and there is no way to know in advance which
> site a given user will lose work on, so the content script must run wherever
> they type.
>
> The content script attaches one listener for `input` events. It reads only the
> contents of editable fields and never any other part of the page. It does not
> read cookies, tokens, page content outside a field the user is typing in, or
> anything about the user's browsing.
>
> Fields that could hold sensitive data are refused before anything is stored:
> password fields, one-time-code fields, payment-card fields, any field inside a
> checkout form, any field whose name or label suggests a secret, and any frame
> belonging to a payment processor. The captured text is then checked again, and
> anything matching a Luhn-valid card number or a national ID pattern is
> replaced with `[redacted]`.
>
> Nothing captured is transmitted. The extension contains no network code and
> requests no network permission.

---

## Remote code

> **No.** The extension executes no remote code. All JavaScript is bundled in
> the package. No `eval`, no remotely hosted scripts, no remotely loaded fonts
> or stylesheets. The default Manifest V3 content security policy is not
> overridden.

---

## Data usage disclosures

In the dashboard's **Privacy practices** section, answer as follows.

| Question | Answer |
|---|---|
| Personally identifiable information | **No** |
| Health information | **No** |
| Financial and payment information | **No** |
| Authentication information | **No** |
| Personal communications | **No** *(see the note below)* |
| Location | **No** |
| Web history | **No** |
| User activity | **No** |
| Website content | **No** *(see the note below)* |

Then tick all three certifications:

- I do not sell or transfer user data to third parties, outside of the approved
  use cases
- I do not use or transfer user data for purposes that are unrelated to my
  item's single purpose
- I do not use or transfer user data to determine creditworthiness or for
  lending purposes

### The two answers worth thinking about

**"Personal communications" and "Website content"** are the two a reviewer might
expect a Yes on, since the extension does read text the user types — which can
be the beginning of a message.

They are answered **No** because the dashboard's question is about *collection*:
whether the data is transmitted to the developer or to any third party. Draft
Rescue transmits nothing. The text never leaves the user's machine, the
developer never receives it, and there is no server to receive it.

If a reviewer queries this, that is the answer to give — plainly, in one
sentence, with an offer to demonstrate: the extension requests no host
permissions and contains no network API, which is checkable from the uploaded
package.

> Do not overstate this and do not argue it at length. "It is not collected
> because it is never transmitted; here is how to verify that" is the whole
> case.
