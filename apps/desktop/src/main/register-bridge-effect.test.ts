import assert from "node:assert/strict";
import test from "node:test";
import { Effect } from "effect";
import type { IpcMainInvokeEvent } from "electron";
import { BRIDGE } from "#shared/bridge";
import { registerBridgeEffects } from "./register-bridge-effect";

test("registerBridgeEffects keeps trusted-sender admission before Effect work", async () => {
  let effectRan = false;
  const invokes = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>();
  registerBridgeEffects(
    BRIDGE,
    {
      setExpanded: () =>
        Effect.sync(() => {
          effectRan = true;
          return "expanded" as const;
        }),
    },
    {
      ipcMain: {
        handle: (channel, listener) => {
          invokes.set(channel, listener);
        },
        on: () => ({}) as Electron.IpcMain,
      },
      trustedSender: () => false,
    },
    (program) => Effect.runPromise(program),
  );
  // SAFETY: registerBridgeEffects reads only the sender field supplied by this focused fixture.
  const event = { sender: {} } as IpcMainInvokeEvent;
  await assert.rejects(
    () => invokes.get(BRIDGE.setExpanded.channel)?.(event, true) as Promise<unknown>,
    /Invalid bridge request/,
  );
  assert.equal(effectRan, false);
});
