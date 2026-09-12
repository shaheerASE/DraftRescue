import type { EditorKind } from '../capture/should-capture';

export type { EditorKind };

/**
 * The raw identity signals scraped off a live field.
 *
 * Phase 1 only collects and stores these. Phase 2 adds the normalisation and
 * the scoring that turn them into "is this the same field as yesterday?".
 * They are collected now because they are free at capture time and impossible
 * to recover later — a draft saved today with no signals attached can never be
 * matched to its field, however good the Phase 2 scorer turns out to be.
 */
export interface FieldSignals {
  /** https://www.upwork.com */
  origin: string;
  /** /proposals/12345 — the raw path. Phase 2 adds the :id-normalised form. */
  pathname: string;
  /** The frame's own URL when this is not the top frame. */
  frameUrl?: string;
  isTopFrame: boolean;

  tagName: string;
  editorKind: EditorKind;
  inputType?: string;

  fieldId?: string;
  fieldName?: string;
  ariaLabel?: string;
  placeholder?: string;
  labelText?: string;

  /** Structural fallback: body>div:nth-of-type(2)>form>textarea */
  domPath: string;
}

/** One saved version of one field's text. */
export interface Snapshot {
  /** Auto-assigned by IndexedDB. */
  id?: number;
  /** Groups versions of the same field together. */
  fieldKey: string;
  signals: FieldSignals;
  text: string;
  /** Sanitised HTML, for contenteditable fields that actually carry formatting. */
  html?: string;
  /** Epoch millis. */
  createdAt: number;
  /** Characters in `text`, denormalised so the popup can list without loading. */
  length: number;
  /** Roughly how much space this row costs, for the storage cap. */
  bytes: number;
  /** How many spans the redaction pass replaced. Zero for almost every row. */
  redactions: number;
}

/** What the content script sends to the service worker on every flush. */
export interface CapturePayload {
  fieldKey: string;
  signals: FieldSignals;
  text: string;
  html?: string;
  capturedAt: number;
  redactions: number;
}

export const MESSAGE = {
  capture: 'draft-rescue/capture',
  stats: 'draft-rescue/stats',
  recent: 'draft-rescue/recent',
  candidates: 'draft-rescue/candidates',
  query: 'draft-rescue/query',
  deleteOne: 'draft-rescue/delete-one',
  deleteSite: 'draft-rescue/delete-site',
  deleteAll: 'draft-rescue/delete-all',
} as const;

export type ExtensionMessage =
  | { kind: typeof MESSAGE.capture; payload: CapturePayload }
  | { kind: typeof MESSAGE.stats }
  | { kind: typeof MESSAGE.recent; limit?: number }
  | { kind: typeof MESSAGE.candidates; signals: FieldSignals; limit?: number }
  | { kind: typeof MESSAGE.query; search?: string; origin?: string; limit?: number }
  | { kind: typeof MESSAGE.deleteOne; id: number }
  | { kind: typeof MESSAGE.deleteSite; origin: string }
  | { kind: typeof MESSAGE.deleteAll };

export interface StorageStats {
  snapshots: number;
  fields: number;
  bytes: number;
}
