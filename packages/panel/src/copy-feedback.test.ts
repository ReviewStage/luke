// @vitest-environment jsdom

import assert from "node:assert/strict";
import { Duration } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import { useCopyToast } from "./copy-feedback.js";
import { copyingInto, fakeAppPlatform } from "./testing/app-platform.js";
import { onRegistry } from "./testing/copy-feedback.js";
import { TOAST_HOLD, ToastHost } from "./toast.js";

let root: Root | undefined;
let registry: AtomRegistry.AtomRegistry | undefined;
let copy: ((words: string, label: string) => void) | undefined;

afterEach(() => {
  vi.useRealTimers();
  act(() => root?.unmount());
  root = undefined;
  registry?.dispose();
  document.body.innerHTML = "";
});

function Copier(): null {
  copy = useCopyToast();
  return null;
}

function mount(): void {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  registry = AtomRegistry.make();
  const held = registry;
  act(() =>
    root?.render(
      onRegistry(
        held,
        createElement(Fragment, null, createElement(Copier), createElement(ToastHost)),
      ),
    ),
  );
}

function standing(): string[] {
  return [...document.querySelectorAll(".ui-toast:not([data-leaving]) .ui-toast-words")].map(
    (words) => words.textContent ?? "",
  );
}

function pass(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

async function copyFromMenu(words: string, label: string): Promise<void> {
  await act(async () => copy?.(words, label));
}

test("a menu's copy the clipboard took stands for a confirmation's hold, then leaves", async () => {
  fakeAppPlatform(copyingInto([]));
  mount();
  const hold = Duration.toMillis(TOAST_HOLD.DONE);

  await copyFromMenu("https://vespin.dev/acme/plan/1", "Link copied");
  pass(hold - 1);
  const justBefore = standing();
  pass(1);

  assert.deepEqual(justBefore, ["Link copied"]);
  assert.deepEqual(standing(), []);
});

test("a menu's copy the clipboard refused stands for a failure's hold, longer than one it took", async () => {
  fakeAppPlatform({ copyText: () => Promise.reject(new Error("clipboard refused")) });
  mount();
  const hold = Duration.toMillis(TOAST_HOLD.FAILED);

  await copyFromMenu("https://vespin.dev/acme/plan/1", "Link copied");
  pass(hold - 1);
  const justBefore = standing();
  pass(1);

  assert.deepEqual(justBefore, ["Could not copy to the clipboard. Try again."]);
  assert.deepEqual(standing(), []);
});
