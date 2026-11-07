// @vitest-environment jsdom
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import "@repo/panel/testing/match-media";
import "@repo/panel/testing/resize-observer";
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
 * looking as though the panel were still coming, and says so with Reload
 * rather than stand blank. A frame drawing its mark as moving dots
 * (`public/boot-mark.js`) is lifted over the panel and sent away instead, so
 * its dots can leave as the panel appears. The second mount stands
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

test("a tab whose host cannot stand takes the frame down and says so with Reload", async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const root = servedRoot();
  const unreachable = Layer.effect(
    HttpClient.HttpClient,
    Effect.die(new Error("The tab's client could not be made.")),
  );

  app = await mountWebApp(root, { httpClient: unreachable });

  assert.equal(app, undefined, "the host does not stand");
  assert.equal(root.querySelector(".boot-frame"), null, "the frame is gone");
  await vi.waitFor(() => {
    assert.equal(
      root.querySelector('[role="alert"]')?.textContent,
      "Something went wrongThis page could not be shown.Reload",
    );
  });
  assert.deepEqual(
    [...root.querySelectorAll("button")].map((button) => button.textContent),
    ["Reload"],
  );
});

test("the shell's frame stands while the session is read, and leaves over the signed-in panel", async () => {
  const session = Promise.withResolvers<void>();
  const service = fakeService({ signedIn: true, sessionHeld: session.promise });
  const root = servedRoot();
  // The frame as the boot script leaves it once its dots are drawing.
  const frame = root.querySelector<HTMLElement>(".boot-frame");
  assert.ok(frame !== null, "app.html serves the frame");
  frame.dataset.bootMark = "live";
  let sentAway = false;
  frame.addEventListener("boot-frame-leave", () => {
    sentAway = true;
  });

  const mounting = mountWebApp(root, { httpClient: service.layer });

  // The tab is waiting on the service: its session read has gone out and not come back.
  await vi.waitFor(() =>
    assert.ok(
      service.seen().some((request) => request.path === "/api/auth/get-session"),
      "the session read has gone out",
    ),
  );
  assert.ok(root.querySelector(".boot-frame .ui-product-mark") !== null, "the frame stands");
  assert.doesNotMatch(root.textContent ?? "", new RegExp(LISTED_TASK.name, "u"));

  session.resolve();
  app = await mounting;

  assert.ok(app !== undefined, "the host stands");
  await vi.waitFor(() => {
    assert.match(root.textContent ?? "", new RegExp(LISTED_TASK.name, "u"));
    assert.equal(root.querySelector(".boot-frame"), null, "the frame is out of the root");
  }, 5_000);
  assert.equal(frame.parentElement, document.body, "the frame stands over the panel");
  assert.ok(sentAway, "the frame is sent away");
});
