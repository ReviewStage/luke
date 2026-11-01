// @vitest-environment jsdom

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  DEVICE_ARCH,
  DEVICE_PLATFORM,
  DEVICE_SETUP,
  HOST_UPDATE,
} from "@luke/features/device-agent-wire";
import type { Host } from "@luke/features/host-wire";
import { ACT_KIND } from "@luke/host/acts";
import { THIS_MAC_HOST_STANDING, type ThisMacHostStanding } from "@luke/host/contract";
import { timeRuntime } from "@luke/ui";
import { Clock, Context, Effect } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { TestClock } from "effect/testing";
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test } from "vitest";
import { fakeActPort } from "../testing/app-bridge.js";
import { fakeAppPlatform } from "../testing/app-platform.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { chooseMenuItem } from "../testing/phone-head.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { useOpenHostConnect } from "./host-connect-dialog.js";
import { HostsSection } from "./hosts-section.js";

/**
 * hosts-section.test.ts -- Settings › Hosts: Add hosts shows the public
 * install command and follows each host that joins while it stands, one
 * approved from its link in the same window among them, a host that joins
 * is listed, and This Mac stands first. Synthetic ids, codes, and
 * addresses.
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
const registries: AtomRegistry.AtomRegistry[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  // Note that the sections let go of the shared presence on a registry as they unmount, so they unmount before it goes.
  for (const registry of registries.splice(0)) registry.dispose();
  document.body.replaceChildren();
});

const SCRIPT = "https://luke.test/install.sh";

/** Lets the window's document, the list's read, and a press's acts land. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 20; tick += 1) await new Promise((done) => setTimeout(done, 0));
  });
}

/**
 * Hosts drawn signed in, on a registry of the test's own, so the window's
 * shared presence is read afresh rather than standing as an earlier test
 * left it.
 */
function drawHosts(registry: AtomRegistry.AtomRegistry = AtomRegistry.make()): void {
  registries.push(registry);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(onRegistry(registry, createElement(HostsSection, { signedIn: true }))));
}

/** A registry whose clock is the test's, so the reads that wait on the minute or the second wait on `TestClock`. */
const onTestClock = Effect.gen(function* () {
  const clock = yield* Clock.Clock;
  return AtomRegistry.make({
    initialValues: [[timeRuntime, AsyncResult.success(Context.make(Clock.Clock, clock))]],
  });
});

/** The open dialog's words, apart from the list behind it, which names a host's setup too. */
function dialogText(): string {
  return document.querySelector('[role="dialog"]')?.textContent ?? "";
}

test("Add hosts shows the public install command, with no secret in it, waits for a host it has not seen, and Close puts it away with the list read again", async () => {
  const hosts: Host[] = [
    {
      id: "3f6b0c2e-8d1a-4b5e-9c7d-2a4e6f8b0d14",
      name: "fra-03",
      seenAt: 0,
      version: "0.1.0",
      upgradeNeeded: false,
    },
  ];
  fakeActPort({
    [ACT_KIND.HOSTS_LIST]: () => Promise.resolve({ hosts: [...hosts], installScriptUrl: SCRIPT }),
    [ACT_KIND.HOSTS_PRESENCE]: () => Promise.resolve({ devices: [] }),
  });
  drawHosts();
  await settle();

  await press("Add hosts");

  assert.ok(dialogText().includes(`curl -fsSL ${SCRIPT} | sh`), "the command is the public one");
  assert.ok(!/lkh_|--token|sudo/u.test(dialogText()), "the command carries no secret");
  assert.ok(dialogText().includes("Waiting for approval"));
  assert.ok(!dialogText().includes("fra-03"), "a host the account had already is not named");
  // Note that the host is approved after the dialog's last read, and the minute has not turned.
  hosts.push({
    id: "9b2d4f6a-1c3e-4a5b-8d7f-0e2a4c6b8d31",
    name: "hel-02",
    seenAt: 0,
    version: "0.1.0",
    upgradeNeeded: false,
  });
  await press("Close");
  assert.equal(document.querySelector('[role="dialog"]'), null, "Close puts the dialog away");
  assert.ok(document.body.textContent?.includes("hel-02"), "the host approved meanwhile is listed");
});

it.effect(
  "the dialog names a host that joins while it stands within seconds, and moves on by itself from connecting through getting ready to why its setup failed",
  () =>
    Effect.gen(function* () {
      const id = "9b2d4f6a-1c3e-4a5b-8d7f-0e2a4c6b8d31";
      const joined: Host = {
        id,
        name: "hel-02",
        seenAt: Date.now(),
        version: "0.1.0",
        upgradeNeeded: false,
      };
      const hosts: Host[] = [];
      fakeActPort({
        [ACT_KIND.HOSTS_LIST]: () =>
          Promise.resolve({ hosts: [...hosts], installScriptUrl: SCRIPT }),
        [ACT_KIND.HOSTS_PRESENCE]: () => Promise.resolve({ devices: [{ deviceId: id, ageMs: 0 }] }),
      });
      drawHosts(yield* onTestClock);
      yield* Effect.promise(settle);
      yield* Effect.promise(() => press("Add hosts"));
      /** Lists the host as given, and lets the dialog's next read land. */
      const listed = (host: Host) =>
        Effect.gen(function* () {
          hosts.splice(0, hosts.length, host);
          yield* TestClock.adjust("5 seconds");
          yield* Effect.promise(settle);
          return dialogText();
        });

      const approved = yield* listed({ ...joined, calledIn: false });
      const preparing = yield* listed({ ...joined, calledIn: true, setup: DEVICE_SETUP.PREPARING });
      const failed = yield* listed({
        ...joined,
        calledIn: true,
        setup: DEVICE_SETUP.FAILED,
        setupFailure: "Claude Code could not be installed",
      });

      assert.ok(approved.includes("hel-02") && approved.includes("Connecting…"), approved);
      assert.ok(!approved.includes("Waiting for approval"));
      assert.ok(preparing.includes("Getting ready…"), preparing);
      assert.ok(failed.includes("Couldn't set up: Claude Code could not be installed"), failed);
    }),
);

/** What a pairing's link does as it lands in the window: opens its dialog for the code. */
function OpenLink({ code }: { code: string }): null {
  const open = useOpenHostConnect();
  useEffect(() => open(code), [open, code]);
  return null;
}

test("a code approved from its link in the same window lets Add hosts, open beneath it, name the host and move on", async () => {
  const hosts: Host[] = [];
  fakeActPort({
    [ACT_KIND.HOSTS_LIST]: () => Promise.resolve({ hosts: [...hosts], installScriptUrl: SCRIPT }),
    [ACT_KIND.HOSTS_PRESENCE]: () => Promise.resolve({ devices: [] }),
    [ACT_KIND.HOSTS_PAIRING_READ]: () =>
      Promise.resolve({
        name: "hel-02",
        platform: DEVICE_PLATFORM.LINUX,
        arch: DEVICE_ARCH.X64,
        ip: "203.0.113.7",
        expiresAt: 1_800_000_000_000,
      }),
    [ACT_KIND.HOSTS_PAIRING_APPROVE]: () => {
      const id = "9b2d4f6a-1c3e-4a5b-8d7f-0e2a4c6b8d31";
      hosts.push({
        id,
        name: "hel-02",
        seenAt: 0,
        version: "0.1.0",
        upgradeNeeded: false,
        calledIn: false,
      });
      return Promise.resolve({ deviceId: id });
    },
  });
  const registry = AtomRegistry.make();
  drawHosts(registry);
  await settle();
  await press("Add hosts");

  const link = document.createElement("div");
  document.body.append(link);
  const root = createRoot(link);
  roots.push(root);
  act(() => root.render(onRegistry(registry, createElement(OpenLink, { code: "BCDFGHJK" }))));
  await settle();
  await press("Connect");

  assert.ok(dialogText().includes("hel-02") && dialogText().includes("Connecting…"), dialogText());
});

it.effect(
  "a server or a Mac that enrolls while Settings stays open is listed within a minute",
  () =>
    Effect.gen(function* () {
      const hosts: Host[] = [];
      fakeActPort({
        [ACT_KIND.HOSTS_LIST]: () =>
          Promise.resolve({ hosts: [...hosts], installScriptUrl: SCRIPT }),
        [ACT_KIND.HOSTS_PRESENCE]: () => Promise.resolve({ devices: [] }),
      });
      drawHosts(yield* onTestClock);
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
        document.body.textContent?.includes("Offline · Mac · 0.1.0"),
        "a Mac its desktop enrolled is listed as a Mac",
      );
    }),
);

/** Hosts drawn in the desktop over the hosts given, with This Mac standing as given and the beats given; how often Retry or Turn on again was asked. */
async function machinesWithThisMac(
  hosts: readonly Host[],
  standing: ThisMacHostStanding,
  beats: readonly { readonly deviceId: string; readonly ageMs: number }[] = [],
): Promise<{ turnOns: () => number }> {
  let turnOns = 0;
  fakeActPort({
    [ACT_KIND.HOSTS_LIST]: () => Promise.resolve({ hosts: [...hosts], installScriptUrl: SCRIPT }),
    [ACT_KIND.HOSTS_PRESENCE]: () => Promise.resolve({ devices: [...beats] }),
    [ACT_KIND.THIS_MAC_HOST_READ]: () => Promise.resolve(standing),
    [ACT_KIND.THIS_MAC_HOST_TURN_ON]: () => {
      turnOns += 1;
      return Promise.resolve(standing);
    },
  });
  drawHosts();
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

test("another Mac's row says why its setup failed, and nothing of This Mac", async () => {
  const mini = "5c2e8a1f-3b7d-4e9a-8c6f-1d3b5e7a9c20";
  await machinesWithThisMac(
    [
      {
        id: mini,
        name: "mini",
        platform: DEVICE_PLATFORM.DARWIN,
        seenAt: 0,
        version: "0.0.9",
        upgradeNeeded: true,
        setup: DEVICE_SETUP.FAILED,
        setupFailure: "Claude Code could not be installed",
      },
    ],
    { standing: THIS_MAC_HOST_STANDING.OFF },
    [{ deviceId: mini, ageMs: 0 }],
  );
  const text = document.body.textContent ?? "";

  assert.ok(text.includes("Couldn't set up: Claude Code could not be installed"));
  assert.ok(!/this Mac/iu.test(text), "nothing on its row speaks of this Mac");
});

test("a host's row says its version and where its update stands, and This Mac's leaves its update to its app", async () => {
  const mac = "7a1c9e3b-2f4d-4c6a-8b0e-5d7f9a1c3e52";
  const updating: readonly Host[] = [
    { id: "3f6b0c2e-8d1a-4b5e-9c7d-2a4e6f8b0d14", name: "ams-01", update: HOST_UPDATE.WAITING },
    { id: "9b2d4f6a-1c3e-4a5b-8d7f-0e2a4c6b8d31", name: "ord-01", update: HOST_UPDATE.UPDATING },
    {
      id: "5c2e8a1f-3b7d-4e9a-8c6f-1d3b5e7a9c20",
      name: "nrt-01",
      update: HOST_UPDATE.FAILED,
      updateFailure: "the download did not match its checksum",
    },
    {
      id: mac,
      name: "Studio",
      platform: DEVICE_PLATFORM.DARWIN,
      update: HOST_UPDATE.FAILED,
      updateFailure: "this Mac's disk is full",
    },
  ].map((host) => ({ seenAt: 0, version: "0.2.1", upgradeNeeded: false, ...host }));
  await machinesWithThisMac(
    updating,
    { standing: THIS_MAC_HOST_STANDING.RUNNING, deviceId: mac },
    updating.map((host) => ({ deviceId: host.id, ageMs: 0 })),
  );
  const text = document.body.textContent ?? "";

  assert.ok(text.includes("Online · Linux server · 0.2.1"), text);
  assert.ok(text.includes("Update ready, waiting for agents to finish"));
  assert.ok(text.includes("Updating…"));
  assert.ok(text.includes("Couldn't update: the download did not match its checksum"));
  assert.ok(!text.includes("this Mac's disk is full"), "This Mac's row draws no update line");
});

test("each host's ⋯ is named by its host, and its Remove asks about that host first", async () => {
  const hosts: readonly Host[] = [
    { id: "3f6b0c2e-8d1a-4b5e-9c7d-2a4e6f8b0d14", name: "fra-01" },
    { id: "9b2d4f6a-1c3e-4a5b-8d7f-0e2a4c6b8d31", name: "sfo-02" },
  ].map((host) => ({ seenAt: 0, version: "0.2.1", upgradeNeeded: false, ...host }));
  await machinesWithThisMac(hosts, { standing: THIS_MAC_HOST_STANDING.OFF });
  const more =
    document.querySelector<HTMLButtonElement>('button[aria-label="sfo-02 actions"]') ??
    assert.fail("sfo-02's ⋯ is drawn");

  act(() => more.click());
  chooseMenuItem("Remove");

  const asked = document.querySelector('[role="alertdialog"]')?.textContent ?? "";
  assert.ok(asked.includes("Remove sfo-02?"), asked);
});

test.each([
  {
    case: "removed",
    standing: THIS_MAC_HOST_STANDING.REMOVED,
    says: "Removed from Luke.",
    offers: "Turn on again",
  },
  {
    case: "never turned on",
    standing: THIS_MAC_HOST_STANDING.NOT_TURNED_ON,
    says: "Run agents here",
    offers: "Turn on",
  },
])(
  "a Mac the service does not list, $case, keeps a This Mac row with $offers",
  async ({ standing, says, offers }) => {
    const { turnOns } = await machinesWithThisMac([], { standing });

    assert.ok(document.body.textContent?.includes(says));
    await press(offers);
    assert.equal(turnOns(), 1);
  },
);
