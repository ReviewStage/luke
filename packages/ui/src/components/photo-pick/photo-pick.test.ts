// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { useFilePicker } from "../file-picker/file-picker.js";
import { PhotoPick } from "./photo-pick.js";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

function Probe({ photo, onRemove }: { photo: string | undefined; onRemove?: () => void }) {
  const picker = useFilePicker({ accept: "image/png", onFiles: () => undefined });
  return createElement(PhotoPick, {
    name: "Acme",
    unnamed: "Workspace",
    photo,
    picker,
    ...(onRemove === undefined ? {} : { onRemove }),
  });
}

function render(photo: string | undefined, onRemove?: () => void): void {
  if (root === undefined) {
    const container = document.body.appendChild(document.createElement("div"));
    root = createRoot(container);
  }
  act(() =>
    root?.render(createElement(Probe, { photo, ...(onRemove === undefined ? {} : { onRemove }) })),
  );
}

test("the tile picks a photo, and once one stands with a way to remove it, a press offers Replace and Remove", () => {
  render(undefined);
  const input = document.querySelector<HTMLInputElement>("input[type=file]");
  assert.ok(input);
  let opened = 0;
  input.addEventListener("click", () => {
    opened += 1;
  });
  const tile = () => document.querySelector<HTMLButtonElement>('button[aria-label$="photo"]');
  const before = tile()?.getAttribute("aria-label");
  act(() => tile()?.click());

  render("data:image/webp;base64,UklG", () => undefined);
  act(() => tile()?.click());

  assert.deepEqual(
    [before, opened, tile()?.getAttribute("aria-label")],
    ["Add photo", 1, "Change photo"],
  );
  assert.match(document.body.textContent ?? "", /Replace photo.*Remove photo/su);
});
