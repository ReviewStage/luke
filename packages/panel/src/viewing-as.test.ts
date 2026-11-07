// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACCOUNT_STATUS } from "@repo/credentials/snapshot";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import type { AppPlatform } from "./app-platform.js";
import { fakeAppPlatform } from "./testing/app-platform.js";
import { handState, signedInAs } from "./testing/app-state.js";
import { withQueryClient } from "./testing/copy-feedback.js";
import { ViewingAs } from "./viewing-as.js";

/**
 * viewing-as.test.ts -- the Viewing as strip stands while a maintainer is
 * signed in as the member on a shell that can end it, naming the member, and
 * its Stop ends the sign-in for that member; an account no maintainer opened
 * is drawn nothing, and so is one on a shell that cannot end it, the Mac app.
 */

const MEMBER = { id: "member-ada", email: "ada@example.test", name: "Ada Lovelace" };

const roots: Root[] = [];

/** jsdom's stand-in for the browser's ResizeObserver, which it lacks; the strip is never resized. */
class StillResizeObserver {
  observe(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", StillResizeObserver);
});

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

/** The strip for the member, opened by a maintainer or not, on a shell that ends the sign-in or not. */
async function mount(
  impersonated: boolean,
  stopImpersonating: AppPlatform["stopImpersonating"],
): Promise<HTMLElement> {
  const { account } = signedInAs(MEMBER);
  assert.equal(account.status, ACCOUNT_STATUS.SIGNED_IN);
  handState({}, { account: impersonated ? { ...account, impersonated: true } : account });
  fakeAppPlatform(stopImpersonating === undefined ? {} : { stopImpersonating });
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(withQueryClient(createElement(ViewingAs))));
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
  return container;
}

/** The strip's Stop, where it stands. */
function stopButton(view: HTMLElement): HTMLButtonElement | undefined {
  return [...view.querySelectorAll("button")].find((button) => button.textContent === "Stop");
}

test("a maintainer signed in as the member reads whom they view as, and Stop ends it for that member", async () => {
  const stopped: string[] = [];
  const view = await mount(true, (memberId) => {
    stopped.push(memberId);
    return new Promise(() => undefined);
  });

  await vi.waitFor(() =>
    assert.match(view.textContent ?? "", /Viewing as Ada Lovelace \(ada@example\.test\)/u),
  );
  act(() => stopButton(view)?.click());
  // Note that the stop reaches its call a few steps after the press, as its mutation sends it.
  await vi.waitFor(() => assert.deepEqual(stopped, [MEMBER.id]));
});

test.each([
  { case: "an account no maintainer opened", impersonated: false, shellEnds: true },
  { case: "a shell that cannot end the sign-in", impersonated: true, shellEnds: false },
])("$case is drawn no strip", async ({ impersonated, shellEnds }) => {
  const view = await mount(impersonated, shellEnds ? () => Promise.resolve(undefined) : undefined);

  assert.equal(stopButton(view), undefined);
  assert.doesNotMatch(view.textContent ?? "", /Viewing as/u);
});
