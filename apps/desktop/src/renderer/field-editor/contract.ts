/**
 * contract.ts -- what the plan document and the field editor's bundle say to each other: the field's words, the one mount call, and nothing that pulls TipTap into the panel.
 *
 * TipTap is too large for the bundle every window parses, so a plan field's
 * editor ships as a bundle of its own (`field-editor.js`, built from
 * `./index.ts`) that the document loads the first time a field is hovered or
 * opened (`../bundle-loader.ts`), as the whiteboard and a File tab's tree are.
 * That bundle sets one global, `window.lukeFieldEditor`, and this file is the
 * whole of what the two share: the field's words in the shapes
 * `planning/plan-field-editor-model.ts` holds them, and the mount call. Nothing
 * here imports a value, so the panel carries none of the editor's libraries.
 */

/** The kinds of field, by what the editor reads and writes. */
export const FIELD_KIND = {
  /** A text field's Markdown. */
  TEXT: "text",
  /** The open questions: Markdown items, one a line. */
  QUESTIONS: "questions",
  /** The assumptions: plain items, one a line, since the document draws them as plain text. */
  ASSUMPTIONS: "assumptions",
  /** One rule: its statement and its examples. */
  RULE: "rule",
} as const;

/** A rule's parts as the field editor's model holds them. */
export interface RuleParts {
  readonly statement: string;
  readonly examples: readonly { given: string; when: string; then: string }[];
}

/** A field's words: a text field's Markdown or a list one item a line, or a rule's parts. */
export type FieldValue =
  | {
      readonly kind: Exclude<(typeof FIELD_KIND)[keyof typeof FIELD_KIND], typeof FIELD_KIND.RULE>;
      readonly text: string;
    }
  | { readonly kind: typeof FIELD_KIND.RULE; readonly rule: RuleParts };

/** What the document hands the editor as it mounts it in place of a field's drawn words. */
export interface FieldEditorProps {
  readonly value: FieldValue;
  /** Where the click that opened it landed, which places the caret; the end without one. */
  readonly at: { readonly x: number; readonly y: number } | undefined;
  readonly label: string;
  /** The read view's own classes, so the editor's words stand where the drawn words stood. */
  readonly className: string;
  /** The most characters the field may hold, where the service bounds it; none where it bounds its parts. */
  readonly limit: number | undefined;
  /** The field's words after each change. */
  readonly onDraft: (value: FieldValue) => void;
  /** Esc or ⌘↩. */
  readonly onFinish: () => void;
}

/** An editor as mounted. */
export interface FieldEditorHandle {
  readonly destroy: () => void;
}

/** What the field editor's bundle sets on `window` once it has loaded. */
export interface FieldEditorModule {
  readonly mount: (host: HTMLElement, props: FieldEditorProps) => FieldEditorHandle;
}

declare global {
  interface Window {
    lukeFieldEditor?: FieldEditorModule;
  }
}

/** The file the field editor's bundle is, beside `index.html`. */
export const FIELD_EDITOR_ASSET = { SCRIPT: "field-editor.js" } as const;
