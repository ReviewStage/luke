// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";

/**
 * A sign-in that could not start says so in an alert, mounted as the
 * failure lands, on the desktop's hosted sign-in page and on the admin's
 * sign-in card alike, so a reader hears it without leaving the button they
 * pressed. The auth service is the one boundary: its answer is a refusal.
 */

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const roots: Root[] = [];

beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockImplementation(() =>
    Promise.resolve(
      new Response(JSON.stringify({ message: "refused" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
    ),
  );
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

/** Lets the refused request, and the redraw it causes, land. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
  });
}

/** The alert standing in the document, by its words; none where there is none. */
function alertWords(): string | undefined {
  return document.querySelector('[role="alert"]')?.textContent ?? undefined;
}

test("the admin's sign-in card says a refused sign-in in an alert that was not there before the press", async () => {
  const { SignInCard } = await import("../src/admin/chrome/cards");
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(SignInCard)));
  assert.equal(alertWords(), undefined);

  const google = [...container.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Google"),
  );
  assert.ok(google, "the card offers Google");
  act(() => google.click());
  await settle();
  assert.equal(alertWords(), "Sign-in could not start. Try again.");
});

test("the hosted sign-in page says a refused sign-in in an alert as the failure lands", async () => {
  window.history.replaceState(null, "", "/sign-in.html?state=google.signed-state");
  const page = document.createElement("div");
  page.id = "root";
  document.body.append(page);
  await act(async () => {
    await import("../src/sign-in");
  });
  await settle();
  assert.equal(alertWords(), "Sign-in could not start. Try again.");
});
