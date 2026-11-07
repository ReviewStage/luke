// @vitest-environment jsdom

import assert from "node:assert/strict";
import { AGENT_MACHINE, type AgentSummary } from "@repo/features/agent-wire";
import { RUN_ON_MAC_OFF, type RunOnMacStanding } from "@repo/features/workspace-tools-wire";
import { ACT_KIND } from "@repo/host/acts";
import { HOST_CAPABILITY, MAC_COMMAND_MODE } from "@repo/settings";
import { ACTION_RESULT_STATUS } from "@repo/wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test, vi } from "vitest";
import { appBridge } from "../app-bridge.js";
import { fakeActPort } from "../testing/app-bridge.js";
import {
  handBeats,
  handHostReads,
  handSettings,
  handState,
  stateWith,
} from "../testing/app-state.js";
import { withQueryClient, writeAppState } from "../testing/copy-feedback.js";
import { restOn } from "../testing/hint-rest.js";
import { AgentPlace } from "./agent-place.js";

/**
 * agent-place.test.ts -- the chip an agent's box wears says where it runs: a device named with its standing as the window's shared presence read says it, not as the agent's own read once did, or the cloud, whose card names the Mac its `run_on_mac` runs on and how it stands.
 * Synthetic ids and names.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

const roots: Root[] = [];

/** Lets go of every box drawn so far. */
function clear(): void {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
}

afterEach(clear);

const DEVICE = "3f6b0c2e-8d1a-4b5e-9c7d-2a4e6f8b0d15";

const AGENT_ID = "7a1c4e9b-2f3d-4b6a-8c5e-1d0f9a8b7c6e";

/** The reader's own account. */
const READER = "user-reader";

/** A minute and a half since the agent's own read saw a beat: past the window the label judges by. */
const READ_SEEN_AT = Date.now() - 90_000;

/** Lets the label's presence read and its redraw land. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 20; tick += 1) await new Promise((done) => setTimeout(done, 0));
  });
}

/** An agent's box drawn with `agent` while the beats stand as `ages` says, each device's age, or failed where none is given, and what the box then says; on a Mac whose Settings let no agent run commands where `never`. */
async function placeOf(
  agent: Pick<AgentSummary, "mac" | "machine">,
  ages: Readonly<Record<string, number>> | undefined,
  runOnMac?: RunOnMacStanding,
  never = false,
): Promise<string> {
  clear();
  fakeActPort({});
  // Note that the bridge is laid afresh, so a case's settings never reach the next.
  handState({});
  if (never) {
    const { run } = stateWith({}, {});
    handSettings(
      { macCommands: MAC_COMMAND_MODE.NEVER },
      { run: { ...run, capabilities: [HOST_CAPABILITY.MAC_COMMANDS] } },
    );
  }
  handBeats(ages);
  if (runOnMac !== undefined)
    handHostReads({ workspaceTools: { [AGENT_ID]: { rows: { runOnMac } } } });
  // Note that the label is read once, so the document is in the client from its first frame, as the root's `ensureQueryData` leaves it.
  writeAppState(await appBridge().requestAppState());
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      withQueryClient(
        createElement(AgentPlace, { agent: { id: AGENT_ID, ...agent }, readerId: READER }),
      ),
    ),
  );
  await settle();
  return document.body.textContent ?? "";
}

/** The chip of an agent on a device whose own read, a minute and a half ago, saw a beat, drawn while the beats stand as `ages` says. */
function labelWhile(ages: Readonly<Record<string, number>> | undefined): Promise<string> {
  return placeOf(
    {
      machine: AGENT_MACHINE.DEVICE,
      mac: { name: "Charles's MacBook Air", seenAt: READ_SEEN_AT, deviceId: DEVICE },
    },
    ages,
  );
}

test("a device the presence read finds beating reads online though the agent's own read is old", async () => {
  const label = await labelWhile({ [DEVICE]: 5_000 });
  assert.equal(label, "Runs on: Charles's MacBook Air");
});

test("a device the presence read finds silent reads offline", async () => {
  const label = await labelWhile({ [DEVICE]: 90_000 });
  assert.equal(label, "Runs on: Charles's MacBook Air · Offline");
});

test("a presence read that fails says the status cannot be checked, never offline", async () => {
  await labelWhile(undefined);
  // Note that the read's failure reaches the presence query a moment after the document does.
  await vi.waitFor(() =>
    assert.equal(document.body.textContent, "Runs on: Charles's MacBook Air · Can't check status"),
  );
});

test("a device the account does not own, which the read does not name, shows its name alone", async () => {
  const label = await labelWhile({});
  assert.equal(label, "Runs on: Charles's MacBook Air");
});

test("an agent in the cloud says Cloud, whatever the beats say", async () => {
  assert.equal(await placeOf({}, undefined), "Runs on: Cloud");
});

/** The `run_on_mac` row the cloud chip's card ends with, once rested on: whose its person chip names and what its dot says. */
async function runOnMacRowOf(
  runOnMac: RunOnMacStanding,
  never = false,
): Promise<readonly (string | null)[]> {
  await placeOf({}, undefined, runOnMac, never);
  restOn(document.querySelector(".ui-chip") ?? assert.fail("the chip stands"));
  await settle();
  const row =
    [...document.querySelectorAll(".ui-hover-card-row")].find(
      (each) => each.querySelector("[data-actor-ref]") !== null,
    ) ?? assert.fail("the card names a Mac");
  return [
    row.querySelector("[data-actor-ref] .ui-inline-ref-label")?.textContent ?? null,
    row.querySelector('.ui-status-glyph[role="img"]')?.getAttribute("aria-label") ?? null,
  ];
}

test("a cloud agent's chip says to a reader, and its card shows, the reader's own Mac its run_on_mac runs on, online", async () => {
  const runOnMac = { on: true, owner: { userId: READER, name: "Ada Lovelace" } } as const;
  assert.equal(
    await placeOf({}, undefined, runOnMac),
    "Runs on: Cloud, run_on_mac on your Mac, Online",
  );
  assert.deepEqual(await runOnMacRowOf(runOnMac), ["You", "Online"]);
});

test("a cloud agent's card names a teammate's Mac, offline where none of theirs listens", async () => {
  assert.deepEqual(
    await runOnMacRowOf({
      on: false,
      reason: RUN_ON_MAC_OFF.MAC_AWAY,
      owner: { userId: "user-charles", name: "Charles Pan" },
    }),
    ["Charles Pan", "Offline"],
  );
});

/** This Mac's command setting as the card offers it; none where the card offers none. */
function macSetting(): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    '[role="radiogroup"][aria-label="Let agents run commands on this Mac"]',
  );
}

test("a Mac set to let no agent run commands is off in Settings on the reader's own Mac alone, whose card changes it there, a teammate's offline", async () => {
  const away = { on: false, reason: RUN_ON_MAC_OFF.MAC_AWAY } as const;
  assert.deepEqual(
    await runOnMacRowOf({ ...away, owner: { userId: READER, name: "Ada Lovelace" } }, true),
    ["You", "Off in Settings"],
  );
  const setting = macSetting() ?? assert.fail("the card offers this Mac's setting");
  assert.equal(setting.querySelector('[aria-checked="true"]')?.textContent, "Never");
  const written: unknown[] = [];
  const settings = (await appBridge().requestAppState()).settings ?? assert.fail("settings held");
  fakeActPort({
    [ACT_KIND.SETTING_UPDATE]: (payload) => {
      written.push(payload);
      return Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED, settings });
    },
  });
  act(() =>
    (
      [...setting.querySelectorAll<HTMLButtonElement>("button")].find(
        (choice) => choice.textContent === "Ask every time",
      ) ?? assert.fail("the setting offers Ask every time")
    ).click(),
  );
  await settle();
  assert.deepEqual(written, [{ field: "macCommands", value: MAC_COMMAND_MODE.ASK }]);

  assert.deepEqual(
    await runOnMacRowOf({ ...away, owner: { userId: "user-charles", name: "Charles Pan" } }, true),
    ["Charles Pan", "Offline"],
  );
  assert.equal(macSetting(), null, "a teammate's Mac is no setting of this Mac's");
  assert.deepEqual(
    await runOnMacRowOf({ ...away, owner: { userId: READER, name: "Ada Lovelace" } }),
    ["You", "Offline"],
    "a Mac whose Settings let agents run commands is only offline",
  );
});
