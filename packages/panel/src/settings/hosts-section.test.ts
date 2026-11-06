// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACCOUNT_STATUS } from "@repo/credentials/snapshot";
import { AGENT_CALL_FAILURE } from "@repo/features/agent-view";
import { DEVICE_PLATFORM, HOST_UPDATE } from "@repo/features/device-agent-wire";
import type { HostLine } from "@repo/features/host-live";
import { LIVE_READ } from "@repo/features/live-wire";
import { ACT_KIND } from "@repo/host/acts";
import type { AppStateDelivery, AppStateSnapshot, AppThisMacHost } from "@repo/host/app-state";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test, vi } from "vitest";
import {
  type FakeActPort,
  fakeActPort,
  fakeAppBridge,
  fakeAppBridgeCalls,
} from "../testing/app-bridge.js";
import { fakeAppPlatform } from "../testing/app-platform.js";
import { handBeats } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { HostsSection } from "./hosts-section.js";

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
  for (const registry of registries.splice(0)) registry.dispose();
  document.body.replaceChildren();
});

const SCRIPT = "https://app.test/install.sh";

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 20; tick += 1) await new Promise((done) => setTimeout(done, 0));
  });
  await vi.waitFor(() => assert.equal(pageText().includes("Reading your hosts"), false));
}

function drawHosts(procedures: Partial<FakeActPort> = {}): void {
  fakeActPort(procedures);
  const registry = AtomRegistry.make();
  registries.push(registry);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(onRegistry(registry, createElement(HostsSection, { signedIn: true }))));
}

function holdHosts(hostsOf: () => readonly HostLine[]): (signedInAs?: string) => void {
  const handed = fakeAppBridgeCalls().requestAppState;
  const listening = fakeAppBridgeCalls().onAppState;
  const listeners = new Set<(delivery: AppStateDelivery) => void>();
  let account: AppStateSnapshot["account"] | undefined;
  let accountId: string | undefined;
  let version = 0;
  const laid = () =>
    accountId === undefined
      ? {}
      : {
          [LIVE_READ.HOSTS]: {
            [accountId]: { rows: { hosts: hostsOf(), installScriptUrl: SCRIPT } },
          },
        };
  fakeAppBridge({
    ...fakeAppBridgeCalls(),
    requestAppState: async () => {
      const snapshot = await (handed ?? assert.fail("a document is handed"))();
      version = Math.max(version, snapshot.version);
      account = snapshot.account;
      if (account.status === ACCOUNT_STATUS.SIGNED_IN) accountId = account.id;
      return { ...snapshot, ...laid() };
    },
    onAppState: (listener: (delivery: AppStateDelivery) => void) => {
      listeners.add(listener);
      const before = listening?.((delivery) => {
        version = Math.max(version, delivery.version);
        listener(delivery);
      });
      return () => {
        listeners.delete(listener);
        before?.();
      };
    },
  });
  return (signedInAs) => {
    version += 1;
    if (signedInAs === undefined) {
      for (const listener of [...listeners]) listener({ version, entries: laid() });
      return;
    }
    const standing = account ?? assert.fail("a document is handed");
    if (standing.status !== ACCOUNT_STATUS.SIGNED_IN) assert.fail("the window is signed in");
    const next = { ...standing, id: signedInAs };
    account = next;
    accountId = signedInAs;
    const entries = { ...laid(), account: next };
    for (const listener of [...listeners]) listener({ version, entries });
  };
}

function pageText(): string {
  return document.body.textContent ?? "";
}

test("Add a host shows the public install command, with no secret in it, and names no host the account had", async () => {
  handBeats({});
  holdHosts(() => [{ id: "3f6b0c2e-8d1a-4b5e-9c7d-2a4e6f8b0d14", name: "fra-03" }]);
  drawHosts();
  await settle();

  assert.ok(pageText().includes(`curl -fsSL ${SCRIPT} | sh`), "the command is the public one");
  assert.ok(!/lkh_|--token|sudo/u.test(pageText()), "the command carries no secret");
  assert.ok(!pageText().includes("is connected."), "a host the account had already is not named");
});

test("a host that joins while the page stands is said to be connected, and reads Setting up… until its first beat", async () => {
  const hosts: HostLine[] = [];
  handBeats({});
  const lay = holdHosts(() => [...hosts]);
  drawHosts();
  await settle();
  await vi.waitFor(() => assert.ok(pageText().includes(`curl -fsSL ${SCRIPT} | sh`)));

  hosts.push({ id: "9b2d4f6a-1c3e-4a5b-8d7f-0e2a4c6b8d31", name: "hel-02" });
  act(lay);
  await settle();

  await vi.waitFor(() => assert.ok(pageText().includes("hel-02 is connected."), pageText()));
  assert.ok(pageText().includes("hel-02Setting up… · Linux server"), pageText());
});

test("a sign-in to another account names none of its hosts as just connected", async () => {
  handBeats({});
  const lay = holdHosts(() => [{ id: "3f6b0c2e-8d1a-4b5e-9c7d-2a4e6f8b0d14", name: "fra-03" }]);
  drawHosts();
  await settle();

  act(() => lay("user-elsewhere"));
  await settle();

  assert.ok(
    !pageText().includes("is connected."),
    "the next account's hosts are not named as joined",
  );
});

function removeOf(name: string): void {
  const row =
    [...document.querySelectorAll<HTMLElement>(".ui-settings-row")].find(
      (each) => each.textContent?.includes(name) ?? false,
    ) ?? assert.fail(`${name}'s row is drawn`);
  const ellipsis =
    row.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]') ??
    assert.fail(`${name}'s ⋯ is drawn`);
  act(() => ellipsis.click());
  const item =
    [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (each) => each.textContent === "Remove",
    ) ?? assert.fail(`${name}'s Remove is drawn`);
  act(() => item.click());
}

async function press(words: string): Promise<void> {
  const button = [...document.querySelectorAll("button")].find(
    (each) => each.textContent === words,
  );
  assert.ok(button !== undefined, `${words} is drawn`);
  await act(async () => button.click());
  await settle();
}

async function machinesWithThisMac(
  hosts: readonly HostLine[],
  thisMac: AppThisMacHost,
  beats: readonly { readonly deviceId: string; readonly ageMs: number }[] = [],
  procedures: Partial<FakeActPort> = {},
): Promise<void> {
  handBeats(Object.fromEntries(beats.map((beat) => [beat.deviceId, beat.ageMs])));
  holdHosts(() => hosts);
  const handed = fakeAppBridgeCalls().requestAppState;
  fakeAppBridge({
    ...fakeAppBridgeCalls(),
    requestAppState: async () => {
      const snapshot = await (handed ?? assert.fail("the beats hand a document"))();
      const { account } = snapshot;
      return account.status === ACCOUNT_STATUS.SIGNED_IN && account.id !== undefined
        ? { ...snapshot, [LIVE_READ.THIS_MAC_HOST]: { [account.id]: { rows: thisMac } } }
        : snapshot;
    },
  });
  drawHosts(procedures);
  await settle();
}

const MACHINE_ID = "a".repeat(64);

const SERVER_AND_THIS_MAC: readonly HostLine[] = [
  { id: "3f6b0c2e-8d1a-4b5e-9c7d-2a4e6f8b0d14", name: "fra-03" },
  {
    id: "7a1c9e3b-2f4d-4c6a-8b0e-5d7f9a1c3e52",
    name: "Studio",
    platform: DEVICE_PLATFORM.DARWIN,
    machineId: MACHINE_ID,
  },
];

function thisMacSwitch(): HTMLElement {
  const found = document.querySelector<HTMLElement>('[aria-label="Run agents on this Mac"]');
  assert.ok(found !== null, "This Mac's switch is drawn");
  return found;
}

test("This Mac stands first on the row of the machine it is, its switch on, with no Remove", async () => {
  await machinesWithThisMac(
    SERVER_AND_THIS_MAC,
    { machineId: MACHINE_ID, enrolled: true },
    SERVER_AND_THIS_MAC.map((host) => ({ deviceId: host.id, ageMs: 0 })),
  );
  const text = document.body.textContent ?? "";

  assert.ok(text.indexOf("This Mac") < text.indexOf("fra-03"), "This Mac stands first");
  assert.ok(text.includes("Online · Mac"), text);
  assert.equal(thisMacSwitch().getAttribute("aria-checked"), "true");
  const thisMacRow = [...document.querySelectorAll(".ui-settings-row")].find(
    (row) => row.textContent?.includes("This Mac") ?? false,
  );
  assert.equal(
    (thisMacRow?.querySelector('button[aria-haspopup="menu"]') ?? null) === null,
    true,
    "This Mac's row offers no Remove",
  );
});

test("a host's row says Updating… while its update runs, though the restart has left its beat past fresh", async () => {
  const hosts: readonly HostLine[] = [
    { id: "3f6b0c2e-8d1a-4b5e-9c7d-2a4e6f8b0d14", name: "ams-01", update: HOST_UPDATE.WAITING },
    { id: "9b2d4f6a-1c3e-4a5b-8d7f-0e2a4c6b8d31", name: "ord-01", update: HOST_UPDATE.UPDATING },
  ];
  await machinesWithThisMac(hosts, {}, [
    { deviceId: "3f6b0c2e-8d1a-4b5e-9c7d-2a4e6f8b0d14", ageMs: 0 },
    { deviceId: "9b2d4f6a-1c3e-4a5b-8d7f-0e2a4c6b8d31", ageMs: 90_000 },
  ]);
  const text = document.body.textContent ?? "";

  assert.ok(text.includes("ams-01Online · Linux server"), text);
  assert.ok(text.includes("ord-01Updating… · Linux server"), text);
});

test("each host draws its Remove on its own row, which asks about that host first", async () => {
  const hosts: readonly HostLine[] = [
    { id: "3f6b0c2e-8d1a-4b5e-9c7d-2a4e6f8b0d14", name: "fra-01" },
    { id: "9b2d4f6a-1c3e-4a5b-8d7f-0e2a4c6b8d31", name: "sfo-02" },
  ];
  await machinesWithThisMac(hosts, {});

  removeOf("sfo-02");

  const asked = document.querySelector('[role="alertdialog"]')?.textContent ?? "";
  assert.ok(asked.includes("Remove sfo-02?"), asked);
});

test("a refused Remove is said in the dialog that asked it, though the list drew its host gone while it was asked", async () => {
  const kept: HostLine = { id: "3f6b0c2e-8d1a-4b5e-9c7d-2a4e6f8b0d14", name: "fra-01" };
  const removed: HostLine = { id: "9b2d4f6a-1c3e-4a5b-8d7f-0e2a4c6b8d31", name: "sfo-02" };
  let hosts: readonly HostLine[] = [kept, removed];
  handBeats({});
  const lay = holdHosts(() => hosts);
  drawHosts({
    [ACT_KIND.HOSTS_REMOVE]: async () => {
      hosts = [kept];
      lay();
      await new Promise((done) => setTimeout(done, 0));
      hosts = [kept, removed];
      lay();
      return { failure: AGENT_CALL_FAILURE.NOT_PERMITTED };
    },
  });
  await settle();
  removeOf("sfo-02");

  await press("Remove host");

  const said = document.querySelector('[role="alertdialog"]')?.textContent ?? "";
  assert.ok(said.includes("Could not reach the service. Try again."), said);
});

test("a host the service still lists for this Mac while it is off stands as any host does, with its Remove", async () => {
  await machinesWithThisMac(SERVER_AND_THIS_MAC, { machineId: MACHINE_ID });

  assert.equal(thisMacSwitch().getAttribute("aria-checked"), "false");
  removeOf("Studio");
  const asked = document.querySelector('[role="alertdialog"]')?.textContent ?? "";
  assert.ok(asked.includes("Remove Studio?"), asked);
});

test("a Mac turned on whose host the service does not list yet reads offline on This Mac's row", async () => {
  await machinesWithThisMac([], {
    deviceId: "2d4f6a8c-0e1b-4c3d-9e5f-7a9b1c3d5e60",
    enrolled: true,
  });
  const row = document.body.textContent ?? "";

  assert.ok(row.includes("This MacOffline"), row);
});

test("This Mac's switch turns it on at once, and off only once the question is answered", async () => {
  const sent: unknown[] = [];
  const answered = async (input: unknown) => {
    sent.push(input);
    return { done: true as const };
  };
  await machinesWithThisMac([], { machineId: MACHINE_ID }, [], {
    [ACT_KIND.HOSTS_THIS_MAC_SET]: answered,
  });
  assert.equal(thisMacSwitch().getAttribute("aria-checked"), "false");

  await act(async () => thisMacSwitch().click());
  await settle();
  assert.deepEqual(sent, [{ on: true }]);

  document.body.replaceChildren();
  await machinesWithThisMac([], { machineId: MACHINE_ID, enrolled: true }, [], {
    [ACT_KIND.HOSTS_THIS_MAC_SET]: answered,
  });
  await vi.waitFor(() => assert.equal(thisMacSwitch().getAttribute("aria-checked"), "true"));
  await act(async () => thisMacSwitch().click());
  await settle();
  assert.deepEqual(sent, [{ on: true }], "nothing is turned off before it is asked");
  const asked = document.querySelector('[role="alertdialog"]')?.textContent ?? "";
  assert.ok(asked.includes("Turn off agents on this Mac?"), asked);

  await press("Turn off");
  assert.deepEqual(sent, [{ on: true }, { on: false, deleteFolders: true }]);
});

test("turning This Mac off offers to keep its agents' folders, and keeps them where that is unchecked", async () => {
  const sent: unknown[] = [];
  await machinesWithThisMac([], { machineId: MACHINE_ID, enrolled: true, agentFolders: 3 }, [], {
    [ACT_KIND.HOSTS_THIS_MAC_SET]: async (input: unknown) => {
      sent.push(input);
      return { done: true as const };
    },
  });
  await act(async () => thisMacSwitch().click());
  await settle();

  const box = document.querySelector<HTMLElement>(
    '[role="alertdialog"] [aria-label^="Delete its agents\' 3 folders"], [role="alertdialog"] [role="checkbox"]',
  );
  assert.ok(box !== null, "the question offers to delete the folders");
  assert.equal(box.getAttribute("aria-checked"), "true", "deleting them is what it offers first");
  await act(async () => box.click());
  await press("Turn off");

  assert.deepEqual(sent, [{ on: false, deleteFolders: false }]);
});
