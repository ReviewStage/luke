// @vitest-environment jsdom

import assert from "node:assert/strict";
import { DEVICE_ARCH, DEVICE_PLATFORM } from "@luke/features/device-agent-wire";
import { HOST_PAIRING_CALL_FAILURE, type HostPairingView } from "@luke/features/host-pairing-view";
import { ACT_KIND } from "@luke/host/acts";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test } from "vitest";
import { fakeActPort } from "../testing/app-bridge.js";
import { fakeAppPlatform } from "../testing/app-platform.js";
import { HostConnectDialog } from "./host-connect-dialog.js";

/**
 * host-connect-dialog.test.ts -- a pairing's link asks whose box it is
 * before anything is pressed: Connect approves the code the link named and
 * closes onto the list, and a code that cannot be approved says what to do
 * next. Synthetic names, codes, and documentation addresses.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  fakeAppPlatform({ assetBase: () => "https://luke.test/" });
});

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

const CODE = "BCDFGHJK";

const BOX: HostPairingView = {
  name: "fra-03",
  platform: DEVICE_PLATFORM.LINUX,
  arch: DEVICE_ARCH.X64,
  ip: "203.0.113.7",
  expiresAt: 1_800_000_000_000,
};

/** Lets the dialog's read and a press's acts land. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 20; tick += 1) await new Promise((done) => setTimeout(done, 0));
  });
}

/** The dialog for the code, drawn and its read landed, and what it told its owner. */
async function opened(): Promise<string[]> {
  const told: string[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(HostConnectDialog, {
        code: CODE,
        onClose: () => told.push("closed"),
        onConnected: () => told.push("connected"),
      }),
    ),
  );
  await settle();
  return told;
}

test("Connect approves the code the link named, once the box it names is shown, and closes onto the list", async () => {
  const approved: unknown[] = [];
  fakeActPort({
    [ACT_KIND.HOSTS_PAIRING_READ]: () => Promise.resolve(BOX),
    [ACT_KIND.HOSTS_PAIRING_APPROVE]: (payload) => {
      approved.push(payload);
      return Promise.resolve({ deviceId: "3f6b0c2e-8d1a-4b5e-9c7d-2a4e6f8b0d14" });
    },
  });
  const told = await opened();

  const text = document.body.textContent ?? "";
  assert.ok(text.includes("Connect fra-03 (Linux server · 203.0.113.7) to your account?"), text);
  assert.ok(text.includes("BCDF-GHJK"), "the code is shown as the box shows it");
  assert.deepEqual(approved, [], "nothing is approved before Connect is pressed");

  const connect = [...document.querySelectorAll("button")].find(
    (each) => each.textContent === "Connect",
  );
  assert.ok(connect !== undefined, "Connect is drawn");
  await act(async () => connect.click());
  await settle();

  assert.deepEqual(approved, [{ code: CODE }]);
  assert.deepEqual(told, ["connected", "closed"]);
});

test("a code no pairing has, or one held after too many such codes, says so and to run the command again", async () => {
  for (const [refusal, says] of [
    [{ failure: HOST_PAIRING_CALL_FAILURE.NOT_FOUND }, "This code can't be used"],
    [{ failure: HOST_PAIRING_CALL_FAILURE.HELD }, "Too many codes tried"],
  ] as const) {
    fakeActPort({ [ACT_KIND.HOSTS_PAIRING_READ]: () => Promise.resolve(refusal) });
    await opened();

    const text = document.body.textContent ?? "";
    assert.ok(text.includes(says), text);
    assert.ok(text.includes("Run the command on the host again for a new code."), text);
    assert.ok(
      ![...document.querySelectorAll("button")].some((each) => each.textContent === "Connect"),
      "nothing offers to approve it",
    );
    for (const root of roots.splice(0)) act(() => root.unmount());
    document.body.replaceChildren();
  }
});
