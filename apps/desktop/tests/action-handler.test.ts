import assert from "node:assert/strict";
import test from "node:test";
import { Effect } from "effect";
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
    act: (value) => Effect.succeed({ ok: value === "yes" }),
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

test("action handlers map effect failures through failure", async () => {
  const handlers = new Map<
    string,
    (event: IpcMainInvokeEvent, ...args: [string]) => Promise<{ ok: boolean; message?: string }>
  >();
  const register = createActionHandler({
    trustedSender: () => true,
    handle: (channel, handler) => handlers.set(channel, handler),
  });
  register<[string], { ok: boolean; message?: string }>("act", {
    validate: ([value]) => {
      if (Object.prototype.toString.call(value) !== "[object String]") return undefined;
      // SAFETY: Object.prototype.toString confirmed a string before validation tuple.
      return [value as string];
    },
    act: (value) =>
      value === "fail" ? Effect.fail(new Error("boom")) : Effect.succeed({ ok: true }),
    failure: (error) => ({ ok: false, message: error.message }),
  });
  const handler = handlers.get("act");
  // SAFETY: Fixture invoke event carries only sender.id for trust validation.
  const event = { sender: { id: 1 } } as IpcMainInvokeEvent;
  assert.deepEqual(await handler?.(event, "fail"), {
    ok: false,
    message: "boom",
  });
});

test("action handlers support async acts and business rejections as success", async () => {
  const handlers = new Map<
    string,
    (event: IpcMainInvokeEvent, ...args: [string]) => Promise<{ status: string }>
  >();
  const register = createActionHandler({
    trustedSender: () => true,
    handle: (channel, handler) => handlers.set(channel, handler),
  });
  register<[string], { status: string }>("open", {
    validate: ([value]) => {
      if (Object.prototype.toString.call(value) !== "[object String]") return undefined;
      // SAFETY: Object.prototype.toString confirmed a string before validation tuple.
      return [value as string];
    },
    act: (url) =>
      Effect.gen(function* () {
        if (url === "missing") return { status: "unsupported" };
        yield* Effect.tryPromise(async () => {
          await Promise.resolve();
        });
        return { status: "opened" };
      }),
    failure: () => ({ status: "rejected" }),
  });
  const handler = handlers.get("open");
  // SAFETY: Fixture invoke event carries only sender.id for trust validation.
  const event = { sender: { id: 1 } } as IpcMainInvokeEvent;
  assert.deepEqual(await handler?.(event, "https://example.com"), { status: "opened" });
  assert.deepEqual(await handler?.(event, "missing"), { status: "unsupported" });
});
