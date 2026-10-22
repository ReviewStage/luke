// @vitest-environment jsdom
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import "@luke/panel/testing/match-media";
import "@luke/panel/testing/resize-observer";
import { Effect, Layer } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import { afterEach, test, vi } from "vitest";
import { mountWebApp, type WebApp } from "../src/app/web-root";
import { fakeService, LISTED_TASK } from "./support/fake-service";

/**
 * The web app's first frame: the page's root as app.html serves it holds the
 * shell's frame, which stands while the host in the tab waits on the
 * session, and the panel signed in takes its place once the session answers;
 * a tab whose host cannot stand takes the frame down rather than leave it
 * looking as though the panel were still coming. The second mount stands
 * after the first, whose host never stood and so read no state, because the
 * panel's state read is the tab's once.
 */

const APP_HTML = readFileSync(join(import.meta.dirname, "..", "app.html"), "utf8");

let app: WebApp | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
  document.body.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
});

/** The page's root element as app.html serves it, frame and all, in the tab. */
function servedRoot(): HTMLElement {
  const served = new DOMParser().parseFromString(APP_HTML, "text/html").getElementById("root");
  assert.ok(served !== null, "app.html has a root element");
  const root = document.createElement("div");
  root.innerHTML = served.innerHTML;
  document.body.append(root);
  return root;
}

test("a tab whose host cannot stand takes the frame down and draws nothing", async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const root = servedRoot();
  const unreachable = Layer.effect(
    HttpClient.HttpClient,
    Effect.die(new Error("The tab's client could not be made.")),
  );

  app = await mountWebApp(root, { httpClient: unreachable });

  assert.equal(app, undefined, "the host does not stand");
  assert.equal(root.childElementCount, 0, "the frame is gone and nothing is drawn");
});

test("the shell's frame stands while the session is read, and the signed-in panel replaces it", async () => {
  const session = Promise.withResolvers<void>();
  const service = fakeService({ signedIn: true, sessionHeld: session.promise });
  const root = servedRoot();

  const mounting = mountWebApp(root, { httpClient: service.layer });

  // The tab is waiting on the service: its session read has gone out and not come back.
  await vi.waitFor(() =>
    assert.ok(
      service.seen().some((request) => request.path === "/api/auth/get-session"),
      "the session read has gone out",
    ),
  );
  assert.ok(
    root.querySelector(".boot-frame .desktop-shell .desktop-main") !== null,
    "the frame stands",
  );
  assert.doesNotMatch(root.textContent ?? "", new RegExp(LISTED_TASK.name, "u"));

  session.resolve();
  app = await mounting;

  assert.ok(app !== undefined, "the host stands");
  await vi.waitFor(() => {
    assert.match(root.textContent ?? "", new RegExp(LISTED_TASK.name, "u"));
    assert.equal(root.querySelector(".boot-frame"), null, "the frame is gone");
  }, 5_000);
});
