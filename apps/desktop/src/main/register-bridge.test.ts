/* oxlint-disable anti-slop/no-unknown-returns -- Fake Electron listeners deliberately retain the IPC boundary shape. */
import assert from "node:assert/strict";
import test from "node:test";
import type { IpcMainEvent, IpcMainInvokeEvent } from "electron";
import { BRIDGE } from "#shared/bridge";
import { registerBridge } from "./register-bridge";

function fixtureHost(trusted: boolean) {
  const invokes = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>();
  const sends = new Map<string, (event: IpcMainEvent, ...args: unknown[]) => unknown>();
  return {
    invokes,
    sends,
    host: {
      ipcMain: {
        handle: (
          channel: string,
          listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown,
        ) => {
          invokes.set(channel, listener);
        },
        on: (channel: string, listener: (event: IpcMainEvent, ...args: unknown[]) => unknown) => {
          sends.set(channel, listener);
          // SAFETY: this inert fixture implements only the IpcMain return identity the listener API requires.
          return {} as Electron.IpcMain;
        },
      },
      trustedSender: () => trusted,
    },
  };
}

test("trust and argument guards refuse every transport before its handler", async () => {
  let calls = 0;
  const trusted = fixtureHost(true);
  registerBridge(
    BRIDGE,
    {
      setExpanded: () => {
        calls += 1;
        return "expanded";
      },
      setPointerInterception: () => {
        calls += 1;
      },
    },
    trusted.host,
  );
  // SAFETY: registerBridge reads only the sender field supplied by this focused fixture.
  const event = { sender: {} } as IpcMainInvokeEvent & IpcMainEvent;
  await assert.rejects(
    // SAFETY: Electron invoke listeners always return promises; the fixture retains the erased host signature only.
    () => trusted.invokes.get(BRIDGE.setExpanded.channel)?.(event, "yes") as Promise<unknown>,
    /Invalid bridge request/,
  );
  trusted.sends.get(BRIDGE.setPointerInterception.channel)?.(event, "yes");
  assert.equal(calls, 0);

  const untrusted = fixtureHost(false);
  registerBridge(
    BRIDGE,
    {
      setExpanded: () => {
        calls += 1;
        return "expanded";
      },
    },
    untrusted.host,
  );
  await assert.rejects(
    // SAFETY: Electron invoke listeners always return promises; the fixture retains the erased host signature only.
    () => untrusted.invokes.get(BRIDGE.setExpanded.channel)?.(event, true) as Promise<unknown>,
    /Invalid bridge request/,
  );
  assert.equal(calls, 0);
});

test("a validated request reaches its domain handler", async () => {
  const fixture = fixtureHost(true);
  registerBridge(
    BRIDGE,
    { setExpanded: (_context, expanded) => (expanded ? "expanded" : "compact") },
    fixture.host,
  );
  // SAFETY: registerBridge reads only the sender field supplied by this focused fixture.
  const event = { sender: {} } as IpcMainInvokeEvent;
  assert.equal(await fixture.invokes.get(BRIDGE.setExpanded.channel)?.(event, true), "expanded");
});

test("an omitted optional argument cannot steal the bridge context", async () => {
  const fixture = fixtureHost(true);
  const sender = {};
  registerBridge(
    BRIDGE,
    {
      setExpanded: (context, expanded, focus) => {
        assert.equal(context.sender, sender);
        assert.equal(focus, undefined);
        return expanded ? "expanded" : "compact";
      },
    },
    fixture.host,
  );
  // SAFETY: registerBridge reads only the sender field supplied by this focused fixture.
  const event = { sender } as IpcMainInvokeEvent;
  assert.equal(await fixture.invokes.get(BRIDGE.setExpanded.channel)?.(event, true), "expanded");
});
