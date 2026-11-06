// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, test } from "vitest";
import { useWindowTitle } from "./window-title.js";

afterEach(() => {
  document.title = "";
});

function titleFor(input: Parameters<typeof useWindowTitle>[0]): string {
  function Window() {
    useWindowTitle(input);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(createElement(Window)));
  const title = document.title;
  act(() => root.unmount());
  return title;
}

test("the window's title names the open plan and its workspace, the workspace alone at home, and Vespin signed out", () => {
  const acme = { name: "Acme" };

  assert.equal(
    titleFor({ signedIn: true, subject: "Teammate invitations", workspace: acme }),
    "Teammate invitations — Acme",
  );
  assert.equal(titleFor({ signedIn: true, subject: undefined, workspace: acme }), "Acme");
  assert.equal(titleFor({ signedIn: false, subject: undefined, workspace: undefined }), "Vespin");
});
