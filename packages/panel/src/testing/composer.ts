import { AGENT_STATUS } from "@repo/features/agent-wire";
import type { TiptapEditorHTMLElement } from "@tiptap/core";
import type { Effect } from "effect";
import { act } from "react";
import { SIDE_BUNDLES } from "../bundle-loader.js";
import { bundleLanded } from "./side-bundles.js";

const ignore = () => undefined;

export const QUIET_COMPOSER = {
  status: AGENT_STATUS.COMPLETED,
  model: undefined,
  models: undefined,
  modelsFailed: false,
  readModels: ignore,
  usage: undefined,
  servers: { disabled: [], onSwitch: ignore, onOpenSettings: ignore },
  published: undefined,
  doors: { openGitHub: ignore, copy: ignore },
  onStop: () => Promise.resolve(false),
  followsUp: true,
} as const;

export const editorBundleLanded: Effect.Effect<unknown, Error> = bundleLanded(
  SIDE_BUNDLES.descriptionEditor,
);

export function installEditorLayout(): void {
  Range.prototype.getClientRects = () => document.createElement("span").getClientRects();
  Range.prototype.getBoundingClientRect = () => new DOMRect();
}

export function composerEditor(container: ParentNode): TiptapEditorHTMLElement {
  const element = container.querySelector<TiptapEditorHTMLElement>(".composer-editor");
  if (element === null) throw new Error("the box's editor is mounted");
  return element;
}

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

export function pasteInComposer(container: ParentNode, text: string): void {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: {
      files: [],
      types: ["text/plain"],
      getData: (type: string) => (type === "text/plain" ? text : ""),
    },
  });
  act(() => {
    composerEditor(container).dispatchEvent(event);
  });
}

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
