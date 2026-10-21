// @vitest-environment jsdom
import assert from "node:assert/strict";
import "@luke/panel/testing/match-media";
import "@luke/panel/testing/resize-observer";
import { afterEach, test, vi } from "vitest";
import { mountWebApp, type WebApp } from "../src/app/web-root";
import { fakeService, LISTED_TASK } from "./support/fake-service";

/**
 * The web app's root over a standing cookie session: the shared host in the
 * tab signs in from the session the service names, reads the account's tasks
 * from the service, and the panel rests on the Inbox beside them. One mount per
 * file, because the panel's state read is the tab's once.
 */

let app: WebApp | undefined;

afterEach(async () => {
  await app?.close();
  localStorage.clear();
});

test("with a session, the panel rests on the Inbox beside the tasks the service lists", async () => {
  const service = fakeService({ signedIn: true });
  const root = document.createElement("div");
  document.body.append(root);

  app = await mountWebApp(root, { httpClient: service.layer });

  assert.ok(app !== undefined, "the host stands");
  await vi.waitFor(() => {
    assert.ok(
      root.querySelector('main [aria-label="Inbox"]') !== null,
      "the panel rests on the Inbox",
    );
    assert.match(root.textContent ?? "", new RegExp(LISTED_TASK.name, "u"));
  });
  assert.equal(root.querySelector("section.sign-in-gate"), null, "no sign-in is drawn");
});
