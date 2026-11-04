// @vitest-environment jsdom

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { DEVICE_ARCH, DEVICE_PLATFORM, HOST_UPDATE } from "@repo/features/device-agent-wire";
import type { Host } from "@repo/features/host-wire";
import { ACT_KIND } from "@repo/host/acts";
import type { ThisMacHostRead } from "@repo/host/contract";
import { timeRuntime } from "@repo/ui";
import { Clock, Context, Effect } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { TestClock } from "effect/testing";
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test } from "vitest";
import { fakeActPort } from "../testing/app-bridge.js";
import { fakeAppPlatform } from "../testing/app-platform.js";
import { handBeats } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { chooseMenuItem } from "../testing/phone-head.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { useOpenHostConnect } from "./host-connect-dialog.js";
import { HostsSection } from "./hosts-section.js";

/**
 * hosts-section.test.ts -- Settings › Hosts: Add hosts shows the public
 * install command and names each host that joins while it stands, one
 * approved from its link in the same window among them, a host that joins
 * is listed, a host updating says so, and This Mac stands first. Synthetic
 * ids, codes, and addresses.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  installScrollIntoView();
  fakeAppPlatform({ assetBase: () => "https://app.test/" });
});

const roots: Root[] = [];
const registries: AtomRegistry.AtomRegistry[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  // Note that the sections let go of the shared presence on a registry as they unmount, so they unmount before it goes.
  for (const registry of registries.splice(0)) registry.dispose();
  document.body.replaceChildren();
});

const SCRIPT = "https://app.test/install.sh";

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

it.effect("the dialog names a host that joins while it stands within seconds", () =>
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
      [ACT_KIND.HOSTS_LIST]: () => Promise.resolve({ hosts: [...hosts], installScriptUrl: SCRIPT }),
    });
    handBeats({ [id]: 0 });
    drawHosts(yield* onTestClock);
    yield* Effect.promise(settle);
    yield* Effect.promise(() => press("Add hosts"));
    hosts.push({ ...joined, calledIn: false });
    yield* TestClock.adjust("5 seconds");
    yield* Effect.promise(settle);
    const approved = dialogText();

    assert.ok(approved.includes("hel-02"), approved);
    assert.ok(!approved.includes("Waiting for approval"));
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

  assert.ok(dialogText().includes("hel-02"), dialogText());
});

it.effect(
  "a server or a Mac that enrolls while Settings stays open is listed within a minute",
  () =>
    Effect.gen(function* () {
      const hosts: Host[] = [];
      fakeActPort({
        [ACT_KIND.HOSTS_LIST]: () =>
          Promise.resolve({ hosts: [...hosts], installScriptUrl: SCRIPT }),
      });
      handBeats({});
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
        document.body.textContent?.includes("Offline · Mac"),
        "a Mac its desktop enrolled is listed as a Mac",
      );
    }),
);

/** The button whose words are these, pressed. */
async function press(words: string): Promise<void> {
  const button = [...document.querySelectorAll("button")].find(
    (each) => each.textContent === words,
  );
  assert.ok(button !== undefined, `${words} is drawn`);
  await act(async () => button.click());
  await settle();
}

/** Hosts drawn in the desktop over the hosts given, This Mac read as given, and the beats given. */
async function machinesWithThisMac(
  hosts: readonly Host[],
  thisMac: ThisMacHostRead,
  beats: readonly { readonly deviceId: string; readonly ageMs: number }[] = [],
): Promise<void> {
  fakeActPort({
    [ACT_KIND.HOSTS_LIST]: () => Promise.resolve({ hosts: [...hosts], installScriptUrl: SCRIPT }),
    [ACT_KIND.THIS_MAC_HOST_READ]: () => Promise.resolve(thisMac),
  });
  handBeats(Object.fromEntries(beats.map((beat) => [beat.deviceId, beat.ageMs])));
  drawHosts();
  await settle();
}

/** A machine id as a host reports it. */
const MACHINE_ID = "a".repeat(64);

/** A server, and a Mac on the machine This Mac is, as the service lists them. */
const SERVER_AND_THIS_MAC: readonly Host[] = [
  { id: "3f6b0c2e-8d1a-4b5e-9c7d-2a4e6f8b0d14", name: "fra-03" },
  {
    id: "7a1c9e3b-2f4d-4c6a-8b0e-5d7f9a1c3e52",
    name: "Studio",
    platform: DEVICE_PLATFORM.DARWIN,
    machineId: MACHINE_ID,
  },
].map((host) => ({ seenAt: 0, version: "0.2.1", upgradeNeeded: false, ...host }));

test("This Mac stands first on the row of the machine it is, with no Remove", async () => {
  await machinesWithThisMac(
    SERVER_AND_THIS_MAC,
    { machineId: MACHINE_ID },
    SERVER_AND_THIS_MAC.map((host) => ({ deviceId: host.id, ageMs: 0 })),
  );
  const text = document.body.textContent ?? "";

  assert.ok(text.indexOf("This Mac") < text.indexOf("fra-03"), "This Mac stands first");
  assert.ok(text.includes("Online · Mac"), text);
  assert.equal(document.querySelector('button[aria-label="This Mac actions"]'), null);
});

test("a host's row says Updating… in place of Online while its update runs", async () => {
  const hosts: readonly Host[] = [
    { id: "3f6b0c2e-8d1a-4b5e-9c7d-2a4e6f8b0d14", name: "ams-01", update: HOST_UPDATE.WAITING },
    { id: "9b2d4f6a-1c3e-4a5b-8d7f-0e2a4c6b8d31", name: "ord-01", update: HOST_UPDATE.UPDATING },
  ].map((host) => ({ seenAt: 0, version: "0.2.1", upgradeNeeded: false, ...host }));
  await machinesWithThisMac(
    hosts,
    {},
    hosts.map((host) => ({ deviceId: host.id, ageMs: 0 })),
  );
  const text = document.body.textContent ?? "";

  assert.ok(text.includes("ams-01Online · Linux server"), text);
  assert.ok(text.includes("ord-01Updating… · Linux server"), text);
});

test("each host's ⋯ is named by its host, and its Remove asks about that host first", async () => {
  const hosts: readonly Host[] = [
    { id: "3f6b0c2e-8d1a-4b5e-9c7d-2a4e6f8b0d14", name: "fra-01" },
    { id: "9b2d4f6a-1c3e-4a5b-8d7f-0e2a4c6b8d31", name: "sfo-02" },
  ].map((host) => ({ seenAt: 0, version: "0.2.1", upgradeNeeded: false, ...host }));
  await machinesWithThisMac(hosts, {});
  const more =
    document.querySelector<HTMLButtonElement>('button[aria-label="sfo-02 actions"]') ??
    assert.fail("sfo-02's ⋯ is drawn");

  act(() => more.click());
  chooseMenuItem("Remove");

  const asked = document.querySelector('[role="alertdialog"]')?.textContent ?? "";
  assert.ok(asked.includes("Remove sfo-02?"), asked);
});

test("a Mac whose host the service does not list yet keeps a This Mac row that reads offline, with nothing to press", async () => {
  await machinesWithThisMac([], { deviceId: "2d4f6a8c-0e1b-4c3d-9e5f-7a9b1c3d5e60" });
  const row = document.body.textContent ?? "";

  assert.ok(row.includes("This MacOffline"), row);
  assert.equal(document.querySelectorAll("button").length, 1, "Add hosts alone is drawn");
});
