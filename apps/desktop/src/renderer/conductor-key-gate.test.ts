import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";
import { ConductorKeyGate, type ConductorKeyGateControl } from "./conductor-key-gate";

function render(control: Partial<ConductorKeyGateControl>): string {
  return renderToStaticMarkup(
    createElement(ConductorKeyGate, {
      control: {
        connecting: false,
        onConnect: () => undefined,
        onSkip: () => undefined,
        ...control,
      },
      onQuit: () => undefined,
    }),
  );
}

test("the gate offers exactly connect, skip, and quit", () => {
  const markup = render({});
  assert.equal((markup.match(/<button/g) ?? []).length, 3);
  assert.equal((markup.match(/disabled=""/g) ?? []).length, 0);
});

test("an entry under way holds connect and skip, never the quit", () => {
  const markup = render({ connecting: true });
  assert.equal((markup.match(/disabled=""/g) ?? []).length, 2);
});
