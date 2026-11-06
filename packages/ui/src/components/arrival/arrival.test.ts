// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test } from "vitest";
import { Arrival } from "../../index.js";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const LABEL = "Reading your tasks…";
const CONTENT = "Relay retries on 502";

const roots: Root[] = [];

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

function mount(reading: boolean): { container: HTMLElement; read: (now: boolean) => void } {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  const draw = (now: boolean) =>
    act(() =>
      root.render(createElement(Arrival, { reading: now, label: LABEL, children: CONTENT })),
    );
  draw(reading);
  return { container, read: draw };
}

test("a region reading says what it reads as a status in place of its content, which stands once the read lands", () => {
  const { container, read } = mount(true);

  expect(container.querySelector('[role="status"]')?.textContent).toBe(LABEL);
  expect(container.textContent).not.toContain(CONTENT);

  read(false);

  expect(container.querySelector('[role="status"]')).toBeNull();
  expect(container.textContent).toBe(CONTENT);
});
