// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, test } from "vitest";
import { useWindowTitle } from "./window-title.js";

/**
 * window-title.test.ts -- the window is called by what it shows: the open
 * task and its workspace, the workspace alone at home, and Luke while
 * nothing is signed in.
 */

afterEach(() => {
  document.title = "";
});

/** The document's title once a window showing `input` has drawn. */
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

test("the window's title names the open plan and its workspace, the workspace alone at home, and Luke signed out", () => {
  const acme = { name: "Acme" };

  assert.equal(
    titleFor({ signedIn: true, subject: "Teammate invitations", workspace: acme }),
    "Teammate invitations — Acme",
  );
  assert.equal(titleFor({ signedIn: true, subject: undefined, workspace: acme }), "Acme");
  assert.equal(titleFor({ signedIn: false, subject: undefined, workspace: undefined }), "Luke");
});
