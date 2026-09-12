# How to test Draft Rescue

You are checking one thing: **type something, delete it, get it back.**

That's the whole product. Everything else is detail.

You do not need DevTools or the console for any of this.

---

## Before you start

```bash
npm run build:dev
```

Go to `chrome://extensions` and load `.output/chrome-mv3-dev`.

Make sure **Draft Rescue appears only once** on that page. If you see it twice,
click Remove on one of them. Two copies save into two separate places and will
confuse you.

---

## The test

Do these 8 steps on each website in the list below. Same steps every time.

**1.** Open the website and find its main writing box.
(The comment box, the message box, the post box — whatever people actually
write in.)

**2.** Type a sentence. Make it long — at least 40 characters. For example:

> This is my test sentence for Draft Rescue and it is nice and long.

**3.** Count slowly to three. (Draft Rescue saves about one second after you
stop typing.)

**4.** Select everything and delete it. The box is now empty.

**5.** Click somewhere else on the page. Anywhere. Just leave the box.

**6.** Click back inside the empty box.

**7.** A small dark button should appear in the bottom-right corner of the box:

> ↺ Restore draft (just now)

**8.** Click it. **Your sentence should come back.**

---

### One more thing after step 8

This is the important part, and it takes ten seconds.

After your text comes back:

- Wait about ten seconds
- Then type one more letter at the end

**Is your text still there?**

Some websites throw our text away a moment after we put it back. It looks like
it worked, and then it quietly disappears. That is the bug I most need you to
find, and waiting ten seconds is the only way to see it.

---

## Where to test

Do the 8 steps on each of these. Write down what happened.

| Website | Where to type | Worked? |
|---|---|---|
| Reddit | A comment box under any post | |
| Gmail | Compose → the message body | |
| LinkedIn | "Start a post" | |
| X (Twitter) | The tweet box | |
| Notion | Any page, just start typing | |
| Jira | An issue → Description | |
| Upwork | A job → Apply → cover letter | |
| WordPress | New post → the body | |

For each one write one of:

- **Yes** — text came back and stayed
- **Came back then vanished** — this is the important bug
- **No button appeared** — it never offered to restore
- **Nothing was saved** — tell me and I will check why

If a site is awkward to reach (no Upwork account, no Jira), skip it and say so.
Do not create accounts just to test.

---

## The safety test

This one matters more than all the rest. Please do it.

**1.** Go to a website where you log in. Your bank, Gmail, anything.

**2.** Click into the **password** box and type something fake, like
`testing123456789`. **Do not press enter or log in.**

**3.** Click the Draft Rescue icon in your Chrome toolbar.

**4.** Look through the list.

**Your password must NOT be there.** Not shortened, not hidden — not there at
all.

Do the same on a shopping checkout page if you can reach one: type into the card
number box, then check the popup. It must not be there either.

> If you ever find something sensitive in that list, stop and tell me
> immediately. That is not a small bug.

### The opposite test

Now the reverse, to prove the safety net works:

**1.** Go to any ordinary comment box — Reddit is fine.

**2.** Type this exactly:

> Please charge my card 4242 4242 4242 4242 thanks

**3.** Wait three seconds, then open the Draft Rescue popup.

The sentence **should** be saved — but the card number should be replaced with
`[redacted]`. It should read:

> Please charge my card [redacted] thanks

---

## The practice page

If you want to try everything in one place first:

```bash
npm run fixtures
```

It prints a web address. Open it. The page has boxes of every kind, each
labelled with a **green** or **red** line down its left side:

- **Green** = type here, it should get saved
- **Red** = type here, it must NOT get saved

Type into all of them, then open the Draft Rescue popup and compare.

---

## If something doesn't work

Tell me what happened in plain words. "The button didn't show up on LinkedIn" is
a perfectly good bug report.

If you want to give me more to work with, here is how — but it is optional:

1. Press **F12** on the page that isn't working
2. Click the **Console** tab
3. Near the top left there is a dropdown that says `top`. Change it to
   **Draft Rescue**
4. Click into the box that isn't working
5. Type this and press Enter:

```js
__draftRescue.probe()
```

Screenshot whatever it prints. It usually says exactly why a box was skipped.

---

## Recording what you found

Copy this, fill it in, send it to me:

```
Date:

Reddit:
Gmail:
LinkedIn:
X:
Notion:
Jira:
Upwork:
WordPress:

Password test (nothing sensitive saved):  PASS / FAIL
Card number test (shows [redacted]):      PASS / FAIL
```

---

<details>
<summary>Why these eight sites (technical — you can skip this)</summary>

Each one uses a different rich-text engine, which is why the list is not
arbitrary. Restoring text into an editor is not the same as setting a value; how
each engine accepts text differs, and a test page that imitates one is not the
real thing.

| Site | Engine | Why it is on the list |
|---|---|---|
| Reddit | Lexical | Already verified once — the regression canary |
| Gmail | plain contenteditable | Compatibility |
| LinkedIn | Quill | |
| X | Draft.js | Most likely to fail; historically hostile to programmatic input |
| Notion | one contenteditable per block | Tests key stability and history noise |
| Jira | ProseMirror | Direct test of the execCommand decision |
| Upwork | plain textarea | The easy case, and the motivating one |
| WordPress | Gutenberg + TinyMCE in an iframe | Two different paths in one site |

If restore fails, the useful detail is *which way* it failed: text appearing and
then vanishing has a different cause from text never appearing at all.

</details>
