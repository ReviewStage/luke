import assert from "node:assert/strict";
import test from "node:test";
import type { IpcMainInvokeEvent } from "electron";
import { createActionHandler } from "../src/action-handler";

test("action handlers centralize trust, validation, and failure mapping", async () => {
  const handlers = new Map<
    string,
    (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>
  >();
  const register = createActionHandler({
    trustedSender: (event) => event.sender.id === 1,
    handle: (channel, handler) => handlers.set(channel, handler),
  });
  register<[string], { ok: boolean }>("act", {
    validate: ([value]) => (typeof value === "string" ? [value] : undefined),
    act: async (value) => ({ ok: value === "yes" }),
    failure: () => ({ ok: false }),
  });
  const handler = handlers.get("act");
  assert.deepEqual(await handler?.({ sender: { id: 1 } } as IpcMainInvokeEvent, "yes"), {
    ok: true,
  });
  assert.deepEqual(await handler?.({ sender: { id: 1 } } as IpcMainInvokeEvent, 1), { ok: false });
  await assert.rejects(
    () => handler?.({ sender: { id: 2 } } as IpcMainInvokeEvent, "yes"),
    /Untrusted renderer/,
  );
});
