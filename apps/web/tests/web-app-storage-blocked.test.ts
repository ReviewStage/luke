// @vitest-environment jsdom
import assert from "node:assert/strict";
import "@luke/panel/testing/match-media";
import "@luke/panel/testing/resize-observer";
import { afterEach, test, vi } from "vitest";
import { mountWebApp, type WebApp } from "../src/app/web-root";
import { fakeService } from "./support/fake-service";

/**
 * The web app's root in a browser that blocks the site's storage, where
 * reading `localStorage` or `sessionStorage` throws a `SecurityError`: the
 * host keeps its files in memory, a connect keeps nothing in the tab, and the
 * panel still draws its sign-in, rather than a blank tab.
 * One mount per file, because the panel's state read is the tab's once.
 */

let app: WebApp | undefined;

afterEach(async () => {
  await app?.close();
  vi.restoreAllMocks();
});

test("with the site's storage blocked, the tab still draws the sign-in", async () => {
  const blocked = () => {
    throw new DOMException("The operation is insecure.", "SecurityError");
  };
  vi.spyOn(window, "localStorage", "get").mockImplementation(blocked);
  vi.spyOn(window, "sessionStorage", "get").mockImplementation(blocked);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const service = fakeService({ signedIn: false });
  const root = document.createElement("div");
  document.body.append(root);

  app = await mountWebApp(root, { httpClient: service.layer });

  assert.ok(app !== undefined, "the host stands");
  await vi.waitFor(() =>
    assert.ok(root.querySelector("section.sign-in-gate") !== null, "the panel draws its sign-in"),
  );
});
