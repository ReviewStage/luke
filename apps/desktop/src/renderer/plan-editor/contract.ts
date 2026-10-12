/**
 * contract.ts -- what the plan document and the plan editor's bundle say to each other: the text, the one mount call, and nothing that pulls TipTap into the panel.
 *
 * TipTap is too large for the bundle every window parses, so the editor of a
 * plan's text ships as a bundle of its own (`plan-editor.js`,
 * built from `./index.ts`) that the document loads the first time a section
 * is hovered or selected (`../bundle-loader.ts`), as the whiteboard and a
 * File tab's tree are. That bundle sets one global, `window.lukePlanEditor`,
 * and this file is the whole of what the two share. Nothing here imports a
 * value, so the panel carries none of the editor's libraries.
 */

/** Where the caret goes as the editor opens: where a click landed, or the end of a section; the start of the text without either. */
export type PlanEditorPlacement =
  | { readonly x: number; readonly y: number }
  | { readonly section: number };

/** What the document hands the editor as it mounts it in place of the text's drawn sections. */
export interface PlanEditorProps {
  /** The text as the document holds it, which the editor opens on. */
  readonly markdown: string;
  readonly placement: PlanEditorPlacement | undefined;
  /** Whether the editor takes the keyboard as it mounts, as a plan opened by a click or a key does and a page drawing it does not. */
  readonly focus: boolean;
  readonly label: string;
  /** The read view's own classes, so the editor's words stand where the drawn words stood. */
  readonly className: string;
  /** The text as it would be saved now, after each change. */
  readonly onDraft: (markdown: string) => void;
  /** Esc or ⌘↩, with the section the caret stood in, counted as `planSections` counts them. */
  readonly onFinish: (section: number) => void;
  /** ↑ from the first line of the text, which goes to the title above it. */
  readonly onLeaveUp: () => void;
}

/** An editor as mounted. */
export interface PlanEditorHandle {
  /**
   * A save's merged answer taken in: Luke's part of `merged`, against what was
   * `sent`, laid in place of the blocks it changed. Answers the text the next
   * save is a change from, and the text the editor holds now.
   */
  readonly take: (sent: string, merged: string) => { readonly base: string; readonly text: string };
  readonly destroy: () => void;
}

/** What the plan editor's bundle sets on `window` once it has loaded. */
export interface PlanEditorModule {
  readonly mount: (host: HTMLElement, props: PlanEditorProps) => PlanEditorHandle;
}

declare global {
  interface Window {
    lukePlanEditor?: PlanEditorModule;
  }
}

/** The file the plan editor's bundle is, beside `index.html`. */
export const PLAN_EDITOR_ASSET = { SCRIPT: "plan-editor.js" } as const;
