import assert from "node:assert/strict";
import test from "node:test";
import type { IpcMainInvokeEvent } from "electron";
import { createActionHandler } from "../src/action-handler";

test("action handlers centralize trust, validation, and failure mapping", async () => {
  const handlers = new Map<
    string,
    (event: IpcMainInvokeEvent, ...args: [string]) => Promise<{ ok: boolean }>
  >();
  const register = createActionHandler({
    trustedSender: (event) => event.sender.id === 1,
    handle: (channel, handler) => handlers.set(channel, handler),
  });
  register<[string], { ok: boolean }>("act", {
    validate: ([value]) => {
      if (Object.prototype.toString.call(value) !== "[object String]") return undefined;
      // SAFETY: Object.prototype.toString confirmed a string before validation tuple.
      return [value as string];
    },
    act: async (value) => ({ ok: value === "yes" }),
    failure: () => ({ ok: false }),
  });
  const handler = handlers.get("act");
  // SAFETY: Fixture invoke event carries only sender.id for trust validation.
  const trustedEvent = { sender: { id: 1 } } as IpcMainInvokeEvent;
  assert.deepEqual(await handler?.(trustedEvent, "yes"), {
    ok: true,
  });
  assert.deepEqual(await handler?.(trustedEvent, 1), { ok: false });
  // SAFETY: Fixture invoke event carries only sender.id for trust validation.
  const untrustedEvent = { sender: { id: 2 } } as IpcMainInvokeEvent;
  await assert.rejects(() => handler?.(untrustedEvent, "yes"), /Untrusted renderer/);
});
