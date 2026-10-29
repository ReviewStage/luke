// @vitest-environment jsdom

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "@effect/vitest";
import { DEVICE_PLATFORM } from "@luke/features/device-agent-wire";
import type { Host } from "@luke/features/host-wire";
import { ACT_KIND } from "@luke/host/acts";
import { THIS_MAC_HOST_STANDING, type ThisMacHostStanding } from "@luke/host/contract";
import { EXPERIMENT } from "@luke/settings";
import { experimentsOn } from "@luke/settings/testing";
import { timeRuntime } from "@luke/ui";
import { Clock, Context, Effect } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { TestClock } from "effect/testing";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test } from "vitest";
import { fakeActPort } from "../testing/app-bridge.js";
import { fakeAppPlatform } from "../testing/app-platform.js";
import { handState } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { HostsSection } from "./hosts-section.js";

/**
 * hosts-section.test.ts -- Add hosts mints the install token in the window
 * and sends the service its SHA-256 alone: the token stands in the command
 * the dialog shows, and nothing the window sent carries it. Synthetic ids
 * and addresses.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  installScrollIntoView();
  fakeAppPlatform({ assetBase: () => "https://luke.test/" });
});

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

const SCRIPT = "https://luke.test/install.sh";

/** Lets the window's document, the list's read, and a press's acts land. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 20; tick += 1) await new Promise((done) => setTimeout(done, 0));
  });
}

test("Add hosts shows the token in its command and sends the service only the token's SHA-256", async () => {
  handState(experimentsOn(EXPERIMENT.LOCAL_AGENTS));
  const sent: unknown[] = [];
  fakeActPort({
    [ACT_KIND.HOSTS_LIST]: () => Promise.resolve({ hosts: [], installScriptUrl: SCRIPT }),
    [ACT_KIND.HOSTS_KEEP_INSTALL_TOKEN]: (payload) => {
      sent.push(payload);
      return Promise.resolve({
        id: "3f6b0c2e-8d1a-4b5e-9c7d-2a4e6f8b0d13",
        expiresAt: 1_000,
        installScriptUrl: SCRIPT,
      });
    },
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(HostsSection, { signedIn: true })));
  await settle();

  const add = [...document.querySelectorAll("button")].find(
    (each) => each.textContent === "Add hosts",
  );
  assert.ok(add !== undefined, "Add hosts is drawn");
  await act(async () => add.click());
  await settle();

  const token = document.body.textContent?.match(/--token (lkh_[A-Za-z0-9_-]{43})/u)?.[1];
  assert.ok(token !== undefined, "the dialog's command carries the token");
  assert.deepEqual(sent, [{ tokenHash: createHash("sha256").update(token).digest("hex") }]);
  assert.ok(!JSON.stringify(sent).includes(token), "nothing sent carries the token");
});

it.effect(
  "a server or a Mac that enrolls while Settings stays open is listed within a minute",
  () =>
    Effect.gen(function* () {
      handState(experimentsOn(EXPERIMENT.LOCAL_AGENTS));
      const hosts: Host[] = [];
      fakeActPort({
        [ACT_KIND.HOSTS_LIST]: () =>
          Promise.resolve({ hosts: [...hosts], installScriptUrl: SCRIPT }),
        [ACT_KIND.HOSTS_PRESENCE]: () => Promise.resolve({ devices: [] }),
      });
      const registry = AtomRegistry.make({
        initialValues: [
          [timeRuntime, AsyncResult.success(Context.make(Clock.Clock, yield* Clock.Clock))],
        ],
      });
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);
      roots.push(root);
      act(() => root.render(onRegistry(registry, createElement(HostsSection, { signedIn: true }))));
      yield* Effect.promise(settle);
      assert.ok(!document.body.textContent?.includes("fra-03"), "no server has joined yet");

      hosts.push({
        id: "3f6b0c2e-8d1a-4b5e-9c7d-2a4e6f8b0d14",
        name: "fra-03",
        seenAt: Date.now(),
        version: "0.1.0",
        upgradeNeeded: false,
      });
      hosts.push({
        id: "7a1c9e3b-2f4d-4c6a-8b0e-5d7f9a1c3e52",
        name: "Studio",
        platform: DEVICE_PLATFORM.DARWIN,
        seenAt: Date.now(),
        version: "0.1.0",
        upgradeNeeded: false,
      });
      yield* TestClock.adjust("1 minute");
      yield* Effect.promise(settle);
      assert.ok(document.body.textContent?.includes("fra-03"), "the server that joined is listed");
      assert.ok(
        document.body.textContent?.includes("Mac · Offline"),
        "a Mac its desktop enrolled is listed as a Mac",
      );
      // Note that the section lets go of the shared presence on the registry as it unmounts, so it unmounts before the registry goes.
      act(() => root.unmount());
      roots.splice(roots.indexOf(root), 1);
      registry.dispose();
    }),
);

/** Hosts drawn in the desktop over the hosts given, with This Mac standing as given; how often Retry or Turn on again was asked. */
async function machinesWithThisMac(
  hosts: readonly Host[],
  standing: ThisMacHostStanding,
): Promise<{ turnOns: () => number }> {
  handState(experimentsOn(EXPERIMENT.LOCAL_AGENTS));
  let turnOns = 0;
  fakeActPort({
    [ACT_KIND.HOSTS_LIST]: () => Promise.resolve({ hosts: [...hosts], installScriptUrl: SCRIPT }),
    [ACT_KIND.HOSTS_PRESENCE]: () => Promise.resolve({ devices: [] }),
    [ACT_KIND.THIS_MAC_HOST_READ]: () => Promise.resolve(standing),
    [ACT_KIND.THIS_MAC_HOST_TURN_ON]: () => {
      turnOns += 1;
      return Promise.resolve(standing);
    },
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(HostsSection, { signedIn: true })));
  await settle();
  return { turnOns: () => turnOns };
}

/** The button whose words are these, pressed. */
async function press(words: string): Promise<void> {
  const button = [...document.querySelectorAll("button")].find(
    (each) => each.textContent === words,
  );
  assert.ok(button !== undefined, `${words} is drawn`);
  await act(async () => button.click());
  await settle();
}

test("this Mac stands first on its own machine's row, with why its setup failed and Retry", async () => {
  const mac = "7a1c9e3b-2f4d-4c6a-8b0e-5d7f9a1c3e52";
  const { turnOns } = await machinesWithThisMac(
    [
      {
        id: "3f6b0c2e-8d1a-4b5e-9c7d-2a4e6f8b0d14",
        name: "fra-03",
        seenAt: 0,
        version: "0.1.0",
        upgradeNeeded: false,
      },
      {
        id: mac,
        name: "Studio",
        platform: DEVICE_PLATFORM.DARWIN,
        seenAt: 0,
        version: "0.1.0",
        upgradeNeeded: false,
      },
    ],
    {
      standing: THIS_MAC_HOST_STANDING.SETUP_FAILED,
      reason: "the image pull timed out",
      deviceId: mac,
    },
  );
  const text = document.body.textContent ?? "";

  assert.ok(text.indexOf("Studio (this Mac)") < text.indexOf("fra-03"), "this Mac stands first");
  assert.ok(text.includes("the image pull timed out"));
  await press("Retry");
  assert.equal(turnOns(), 1);
});

test("a Mac the service no longer lists keeps a This Mac row with Turn on again", async () => {
  const { turnOns } = await machinesWithThisMac([], { standing: THIS_MAC_HOST_STANDING.REMOVED });

  assert.ok(document.body.textContent?.includes("Removed from Luke."));
  await press("Turn on again");
  assert.equal(turnOns(), 1);
});
