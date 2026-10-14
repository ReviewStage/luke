import { CODING_AGENT_STATUS } from "@sidecar/hosted/coding-agent-wire";
import type { TiptapEditorHTMLElement } from "@tiptap/core";
import { act } from "react";
import { mountComposer } from "../renderer/plan-editor/composer-editor";
import { mountPlanEditor } from "../renderer/plan-editor/plan-editor";

/**
 * composer.ts -- an agent's message box under jsdom: the editor bundle there as the panel finds it, and words typed into the box's editor.
 *
 * `installEditorBundle` sets the editor bundle on `window` as its script
 * would (`../renderer/plan-editor/index.ts`), so a box drawn after it mounts
 * its editor at once rather than waiting on a script jsdom never runs; a
 * test of the box before the bundle lands calls it as the script would
 * have run. jsdom lays nothing out and gives a range no rectangles, which the
 * editor asks for as it keeps the caret in view, so `installEditorLayout`
 * answers an empty one, as a page with no layout would. And jsdom has no
 * `beforeinput`, so typing by keyboard events writes nothing into an
 * editor; `typeInComposer` types as the editor's own input does, a
 * transaction inserting the words at the caret, so the bound, the chips,
 * and the draft all see what a keystroke would hand them.
 */

const ignore = () => undefined;

/** What a box takes beside its control and its skills, each answering nothing, for a test of the box alone. */
export const QUIET_COMPOSER = {
  status: CODING_AGENT_STATUS.COMPLETED,
  model: undefined,
  models: undefined,
  readModels: ignore,
  usage: undefined,
  servers: { disabled: [], onSwitch: ignore, onOpenSettings: ignore },
  published: undefined,
  doors: { openGitHub: ignore, copy: ignore },
  onStop: () => Promise.resolve(),
  followsUp: true,
} as const;

/** The editor bundle on `window`, as its script sets it once it has run. */
export function installEditorBundle(): void {
  window.lukePlanEditor = { mount: mountPlanEditor, mountComposer };
}

/** Gives a range the empty rectangles a page with no layout would, which jsdom leaves out. */
export function installEditorLayout(): void {
  Range.prototype.getClientRects = () => document.createElement("span").getClientRects();
  Range.prototype.getBoundingClientRect = () => new DOMRect();
}

/** The box's editor inside the container: the element the words are typed into. */
export function composerEditor(container: ParentNode): TiptapEditorHTMLElement {
  const element = container.querySelector<TiptapEditorHTMLElement>(".composer-editor");
  if (element === null) throw new Error("the box's editor is mounted");
  return element;
}

/** The words typed into the box's editor at its caret, as its own input inserts them, a line break for each newline. */
export function typeInComposer(container: ParentNode, text: string): void {
  const element = composerEditor(container);
  const editor = element.editor;
  if (editor === undefined) throw new Error("the box's editor is running");
  act(() => {
    editor.view.focus();
    text.split("\n").forEach((line, index) => {
      if (index > 0) pressInComposer(container, "Enter", { shiftKey: true });
      if (line !== "") editor.view.dispatch(editor.state.tr.insertText(line).scrollIntoView());
    });
  });
}

/** A key pressed in the box's editor. */
export function pressInComposer(
  container: ParentNode,
  key: string,
  init: KeyboardEventInit = {},
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  act(() => {
    composerEditor(container).dispatchEvent(event);
  });
  return event;
}
