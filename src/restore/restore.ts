import type { EditorKind } from '../shared/types';

/**
 * Putting text back into a field.
 *
 * Reading a field is easy. Writing to one is not, because a modern web app does
 * not treat the DOM as the source of truth — it keeps its own copy of the value
 * and reconciles the DOM against it. Write to the DOM in a way the app does not
 * notice, and one of two things happens:
 *
 *   the app never learns about the text, so submitting the form sends the old
 *   value and the user watches their draft disappear at the worst moment; or
 *
 *   the app re-renders from its own model a moment later and wipes what we
 *   wrote, with no error anywhere.
 *
 * Both look like success for a second or two. That is what makes this the part
 * worth being careful about.
 */

export type RestoreMethod =
  | 'native-setter'
  | 'exec-command'
  | 'text-content';

export interface RestoreResult {
  ok: boolean;
  method: RestoreMethod | null;
  /** Set when ok is false, or when we fell back to something unreliable. */
  note?: string;
}

/**
 * The `value` setter from the element's PROTOTYPE, not from the element.
 *
 * THIS IS THE PART THE OBVIOUS IMPLEMENTATION GETS WRONG.
 *
 * The obvious code is `el.value = text` followed by dispatching an `input`
 * event. On a plain HTML page that works. On a React-controlled input it
 * silently does nothing, and here is why:
 *
 * React installs its own getter/setter pair directly ON THE ELEMENT INSTANCE,
 * shadowing the prototype's. That pair keeps a private record of the last value
 * React knows about. When an `input` event arrives, React compares the field's
 * current value against that record, and if they are equal it concludes nothing
 * changed and never calls onChange.
 *
 * So `el.value = text` goes through React's instance setter, which dutifully
 * updates the private record to match. By the time our event arrives, the
 * record and the field agree — React sees no change, drops the event, and the
 * component's state still holds the old text. The box looks right. The app
 * disagrees. The form submits the old value.
 *
 * Taking the setter off the prototype bypasses the instance property entirely.
 * The field's value changes, React's private record is left stale, and the
 * event that follows shows a genuine difference — which is exactly what React
 * is looking for.
 *
 * Walking up the prototype chain rather than naming HTMLInputElement directly
 * keeps this working inside an iframe, where the element belongs to a different
 * realm and would fail an `instanceof` check against our own globals.
 */
function prototypeValueSetter(el: Element): ((value: string) => void) | null {
  let proto: object | null = Object.getPrototypeOf(el) as object | null;

  while (proto) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    if (descriptor?.set) return descriptor.set as (value: string) => void;
    proto = Object.getPrototypeOf(proto) as object | null;
  }

  return null;
}

/** An InputEvent where supported, falling back to a plain Event. */
function inputEvent(text: string): Event {
  try {
    return new InputEvent('input', {
      bubbles: true,
      composed: true,
      inputType: 'insertReplacementText',
      data: text,
    });
  } catch {
    return new Event('input', { bubbles: true, composed: true });
  }
}

function restoreValueField(el: HTMLInputElement | HTMLTextAreaElement, text: string): RestoreResult {
  const setter = prototypeValueSetter(el);
  if (!setter) {
    return { ok: false, method: null, note: 'no value setter on the prototype chain' };
  }

  try {
    el.focus();
  } catch {
    // Focusing can throw on a detached or disabled element; the write below is
    // what matters, so carry on.
  }

  setter.call(el, text);

  // Put the caret at the end, where someone continuing to type expects it.
  try {
    el.setSelectionRange(text.length, text.length);
  } catch {
    // Not supported on every input type (email and number among them). Harmless.
  }

  el.dispatchEvent(inputEvent(text));
  // Some non-React sites only listen for `change`. Dispatching both costs
  // nothing: React maps onChange onto the input event, so it does not double up.
  el.dispatchEvent(new Event('change', { bubbles: true }));

  return { ok: el.value === text, method: 'native-setter' };
}

/**
 * Restore into a rich editor.
 *
 * `document.execCommand` is deprecated, and it is still the right call here.
 *
 * Draft.js, Lexical, ProseMirror, Quill and Slate all keep an internal document
 * model and reconcile the DOM against it. Writing to `innerHTML` or
 * `textContent` changes the DOM without telling the model, so the text appears
 * and then vanishes on the editor's next render — which might be the next
 * keystroke, or when the user clicks away. It looks like it worked right up
 * until it matters.
 *
 * `execCommand('insertText')` goes through the browser's own editing pipeline.
 * That fires the same `beforeinput` and `input` events a real keystroke fires,
 * which is precisely what those editors listen for, so the change enters their
 * model through the front door. It is also undoable with Ctrl+Z, because it
 * joins the browser's native undo stack.
 *
 * The deprecation is real but inert: there is no replacement API, every engine
 * still implements it, and the alternative is text that silently disappears.
 * Revisit if the EditContext API ever ships broadly.
 */
function restoreRichText(el: HTMLElement, text: string): RestoreResult {
  const doc = el.ownerDocument;

  try {
    el.focus();
  } catch {
    return { ok: false, method: null, note: 'could not focus the editor' };
  }

  // Select what is there so insertText replaces it rather than appending. On an
  // empty field this just places the caret.
  const selection = doc.getSelection?.();
  if (selection) {
    const range = doc.createRange();
    range.selectNodeContents(el);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  const exec = (doc as Document & { execCommand?: (c: string, ui: boolean, v: string) => boolean })
    .execCommand;

  if (typeof exec === 'function') {
    let inserted = false;
    try {
      inserted = exec.call(doc, 'insertText', false, text);
    } catch {
      inserted = false;
    }
    if (inserted) return { ok: true, method: 'exec-command' };
  }

  // Last resort. This WILL be reverted by a model-driven editor on its next
  // render; it is here so a plain contenteditable on a simple site still works
  // rather than failing outright. The caller is told which path ran so it can
  // say so.
  el.textContent = text;
  el.dispatchEvent(inputEvent(text));

  return {
    ok: el.textContent === text,
    method: 'text-content',
    note: 'execCommand unavailable; a rich editor may discard this on its next render',
  };
}

/** Put `text` into `el`, by whichever route that kind of field actually respects. */
export function restoreInto(el: Element, kind: EditorKind, text: string): RestoreResult {
  if (kind === 'input' || kind === 'textarea') {
    return restoreValueField(el as HTMLInputElement | HTMLTextAreaElement, text);
  }
  return restoreRichText(el as HTMLElement, text);
}
