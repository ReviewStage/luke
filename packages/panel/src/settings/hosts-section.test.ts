// @vitest-environment jsdom

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "@effect/vitest";
import { DEVICE_PLATFORM } from "@luke/features/device-agent-wire";
import type { Host } from "@luke/features/host-wire";
import { ACT_KIND } from "@luke/host/acts";
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
import { copyingInto, fakeAppPlatform } from "../testing/app-platform.js";
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
  fakeAppPlatform({ assetBase: () => "https://luke.test/", ...copyingInto(copied) });
});

/** What the window's clipboard took, in order. */
const copied: string[] = [];

const roots: Root[] = [];

afterEach(() => {
  copied.length = 0;
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
    (each) => each.textContent === "Add Linux servers",
  );
  assert.ok(add !== undefined, "Add Linux servers is drawn");
  await act(async () => add.click());
  await settle();

  const token = document.body.textContent?.match(/--token (lkh_[A-Za-z0-9_-]{43})/u)?.[1];
  assert.ok(token !== undefined, "the dialog's command carries the token");
  assert.deepEqual(sent, [{ tokenHash: createHash("sha256").update(token).digest("hex") }]);
  assert.ok(!JSON.stringify(sent).includes(token), "nothing sent carries the token");

  const copy = document.querySelector<HTMLButtonElement>('button[aria-label="Copy setup prompt"]');
  assert.ok(copy !== null, "the dialog offers the setup prompt");
  await act(async () => copy.click());
  assert.equal(copied.length, 1);
  assert.ok(copied[0]?.includes(`--token ${token}`), "the prompt carries the install command");
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
