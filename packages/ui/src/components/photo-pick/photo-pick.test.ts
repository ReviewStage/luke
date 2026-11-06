// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { useFilePicker } from "../file-picker/file-picker.js";
import { PhotoPick } from "./photo-pick.js";

/**
 * photo-pick.test.ts -- Add photo opens the picker it is handed, and once a photo stands the
 * button says Replace photo beside it.
 */

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

function Probe({ photo }: { photo: string | undefined }) {
  const picker = useFilePicker({ accept: "image/png", onFiles: () => undefined });
  return createElement(PhotoPick, { name: "Acme", unnamed: "Workspace", photo, picker });
}

function render(photo: string | undefined): void {
  if (root === undefined) {
    const container = document.body.appendChild(document.createElement("div"));
    root = createRoot(container);
  }
  act(() => root?.render(createElement(Probe, { photo })));
}

test("Add photo opens the picker, and a photo standing turns it into Replace photo", () => {
  render(undefined);
  const input = document.querySelector<HTMLInputElement>("input[type=file]");
  assert.ok(input);
  let opened = 0;
  input.addEventListener("click", () => {
    opened += 1;
  });
  const button = () => document.querySelector("button");
  const before = button()?.textContent;
  act(() => button()?.click());

  render("data:image/webp;base64,UklG");

  assert.deepEqual([before, opened, button()?.textContent], ["Add photo", 1, "Replace photo"]);
});
