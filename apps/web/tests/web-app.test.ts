// @vitest-environment jsdom
import assert from "node:assert/strict";
import "@repo/panel/testing/match-media";
import "@repo/panel/testing/resize-observer";
import { LINK_PLATFORM } from "@repo/features/link-open";
import { afterEach, test, vi } from "vitest";
import { mountWebApp, type WebApp } from "../src/app/web-root";
import { type FakeService, fakeService, LISTED_TASK } from "./support/fake-service";

let app: WebApp | undefined;

function sessionReads(service: FakeService): number {
  return service.seen().filter((request) => request.path === "/api/auth/get-session").length;
}

afterEach(async () => {
  await app?.close();
  localStorage.clear();
});

test("signed out, the panel draws its sign-in; a return after another tab signed in opens the account's tasks", async () => {
  const service = fakeService({ signedIn: false });
  const root = document.createElement("div");
  document.body.append(root);

  app = await mountWebApp(root, {
    httpClient: service.layer,
    linkPlatform: LINK_PLATFORM.MAC,
  });

  assert.ok(app !== undefined, "the host stands");
  await vi.waitFor(() =>
    assert.ok(root.querySelector("section.ui-auth-card") !== null, "the panel draws its sign-in"),
  );
  const toMac = [...root.querySelectorAll("a")].find(
    (link) => link.textContent === "Open in the Mac app",
  );
  assert.match(toMac?.getAttribute("href") ?? "", /^vespin:/u);

  await vi.waitFor(() => assert.ok(sessionReads(service) >= 2, "the launch's reads have begun"));

  service.setSession(true);
  await vi.waitFor(() => {
    window.dispatchEvent(new Event("focus"));
    assert.ok(root.querySelector("section.ui-auth-card") === null, "the sign-in is gone");
    assert.match(root.textContent ?? "", new RegExp(LISTED_TASK.name, "u"));
  }, 5_000);
});
