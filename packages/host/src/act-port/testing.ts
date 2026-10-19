import assert from "node:assert/strict";
import { createORPCClient, ORPCError } from "@orpc/client";
import { RPCLink } from "@orpc/client/message-port";
import { Context } from "effect";
import type { ActSender } from "../act-router/router.js";
import { ACT_ERROR, type ActPortClient } from "../contract/index.js";
import { type ActPortDependencies, createActPortHandler } from "./index.js";

/**
 * testing.ts -- a window's act port as a test opens one: the real handler over a real `MessageChannel`, called through oRPC's own client.
 */

// The platform's handle on the window that asked, which no procedure reads.
const SENDER = Symbol("window");

export const PANEL: ActSender = { sender: SENDER, panel: true, voice: false, call: false };
export const VOICE: ActSender = { ...PANEL, panel: false, voice: true };
export const CALL: ActSender = { ...PANEL, panel: false, call: true };

/** A host no call reaches: any ask of it fails the test where it is made. */
function unreachedHost<Host extends object>(): Host {
  // SAFETY: every member read throws, so no caller ever holds a member this type promises.
  return new Proxy(
    {},
    {
      get: (_target, name) => {
        throw new Error(`A test reached ${String(name)}, of a domain it does not test.`);
      },
    },
  ) as Host;
}

/**
 * Every domain's dependencies, none of them reachable: a test spreads its
 * own domain's over it, and an ask of any other domain's host throws.
 */
export const UNREACHED_DEPENDENCIES: ActPortDependencies = {
  accountAsks: { host: unreachedHost() },
  automations: { host: unreachedHost() },
  factory: { host: unreachedHost() },
  integrations: { host: unreachedHost() },
  issues: { host: unreachedHost() },
  workspaces: {
    host: unreachedHost(),
    openExternal: () => {
      throw new Error("A test reached openExternal, of a domain it does not test.");
    },
  },
};

const opened: MessagePort[] = [];

/**
 * A window's act port, opened as the bridge opens one, over the dependencies
 * given, the window standing as `actor`, trusted or not. Close every port a
 * test opened with {@link closeWindowPorts}.
 */
export function openWindowPort(
  dependencies: ActPortDependencies,
  actor: ActSender,
  trusted = true,
): ActPortClient {
  const handler = createActPortHandler(dependencies);
  const { port1, port2 } = new MessageChannel();
  opened.push(port1, port2);
  handler.upgrade(port1, {
    context: () => ({ actor, trusted, "effect/context": Context.empty() }),
  });
  port1.start();
  const client: ActPortClient = createORPCClient(new RPCLink({ port: port2 }));
  port2.start();
  return client;
}

/** Closes every port a test opened. */
export function closeWindowPorts(): void {
  for (const port of opened.splice(0)) port.close();
}

/** One call on the port, settled to its answer or the sentence of its refusal. */
export async function settled<Answer>(
  call: () => Promise<Answer>,
): Promise<{ answer: Answer } | { refused: string }> {
  try {
    return { answer: await call() };
  } catch (error) {
    assert.ok(error instanceof ORPCError);
    assert.equal(error.code, ACT_ERROR.REFUSED);
    return { refused: error.message };
  }
}
