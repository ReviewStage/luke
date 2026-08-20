import assert from "node:assert/strict";
import test from "node:test";
import type { UnparsedWireValue } from "@sidecar/wire";
import type { IpcMainInvokeEvent } from "electron";
import type { AppSettings, SettingsUpdateResult } from "#shared/contracts";
import { createSettingsHandler, SettingsRefusal } from "./settings-handler";

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
const SETTINGS = { showInDock: false } as AppSettings;

function event(sender: { id: number } = { id: 1 }): IpcMainInvokeEvent {
  // SAFETY: Fixture invoke event carries only sender.id for trust validation.
  return { sender } as IpcMainInvokeEvent;
}

test("an untrusted sender is refused before validate or save run", async () => {
  const calls: string[] = [];
  const handlers = new Map<
    string,
    (event: IpcMainInvokeEvent, ...args: UnparsedWireValue[]) => Promise<SettingsUpdateResult>
  >();
  const register = createSettingsHandler({
    trustedSender: () => false,
    snapshot: async () => SETTINGS,
    broadcast: () => {
      calls.push("broadcast");
    },
    handle: (channel, listener) => {
      handlers.set(channel, listener);
    },
  });
  register("app:set-x", {
    validate: () => {
      calls.push("validate");
      return true;
    },
    save: async () => {
      calls.push("save");
      return { settings: SETTINGS };
    },
    refusal: "Could not save.",
  });
  const refused = handlers.get("app:set-x");
  assert.ok(refused);
  await assert.rejects(() => refused(event()), /Untrusted renderer/);
  assert.deepEqual(calls, []);
});

test("a SettingsRefusal leaves without a write, a side effect, or a broadcast", async () => {
  const calls: string[] = [];
  const handlers = new Map<
    string,
    (event: IpcMainInvokeEvent, ...args: UnparsedWireValue[]) => Promise<SettingsUpdateResult>
  >();
  const register = createSettingsHandler({
    trustedSender: () => true,
    snapshot: async () => SETTINGS,
    broadcast: () => {
      calls.push("broadcast");
    },
    handle: (channel, listener) => {
      handlers.set(channel, listener);
    },
  });
  register("app:set-x", {
    validate: () =>
      new SettingsRefusal({
        settings: SETTINGS,
        reason: "That chord is reserved for the talk key.",
      }),
    save: async () => {
      calls.push("save");
      return { settings: SETTINGS };
    },
    apply: () => {
      calls.push("apply");
    },
    refusal: "Could not save.",
  });
  const result = await handlers.get("app:set-x")?.(event());
  assert.equal(result?.reason, "That chord is reserved for the talk key.");
  assert.deepEqual(calls, []);
});

test("a successful write applies and broadcasts, skipping the asking window", async () => {
  const broadcasts: object[] = [];
  const handlers = new Map<
    string,
    (event: IpcMainInvokeEvent, ...args: UnparsedWireValue[]) => Promise<SettingsUpdateResult>
  >();
  const register = createSettingsHandler({
    trustedSender: () => true,
    snapshot: async () => SETTINGS,
    broadcast: (settings, except) => {
      broadcasts.push({ settings, except });
    },
    handle: (channel, listener) => {
      handlers.set(channel, listener);
    },
  });
  const sender = { id: 7 };
  register("app:set-x", {
    validate: (value: UnparsedWireValue) => value === true,
    save: async (value) => {
      assert.equal(value, true);
      return { settings: SETTINGS };
    },
    apply: async (result, value) => {
      assert.equal(value, true);
      assert.equal(result.settings, SETTINGS);
    },
    refusal: "Could not save.",
  });
  const invokeEvent = event(sender);
  const result = await handlers.get("app:set-x")?.(invokeEvent, true);
  assert.deepEqual(result, { settings: SETTINGS });
  assert.deepEqual(broadcasts, [{ settings: SETTINGS, except: sender }]);
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("a filesystem failure is reported as the refusal, not a thrown error", async () => {
  const handlers = new Map<
    string,
    (event: IpcMainInvokeEvent, ...args: UnparsedWireValue[]) => Promise<SettingsUpdateResult>
  >();
  const register = createSettingsHandler({
    trustedSender: () => true,
    snapshot: async () => SETTINGS,
    broadcast: () => {
      throw new Error("must not broadcast a failed write");
    },
    handle: (channel, listener) => {
      handlers.set(channel, listener);
    },
  });
  register("app:set-x", {
    validate: () => true,
    save: async () => {
      throw new Error("EACCES");
    },
    refusal: "Could not save that setting on this system.",
  });
  const result = await handlers.get("app:set-x")?.(event());
  assert.deepEqual(result, {
    settings: SETTINGS,
    reason: "Could not save that setting on this system.",
  });
});
