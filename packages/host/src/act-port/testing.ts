/**
 * testing.ts -- a window's act port as a test calls it: procedures served by the real handler over a fresh channel, as the window standing as one sender.
 *
 * A test hands in the procedures it calls, and calls
 * them through the client of the channel's other end, so what it observes is
 * what a window would: an answer, or a refusal in its sentence.
 */

import type { WireBoundaryInput } from "@luke/wire";
import { createORPCClient, ORPCError } from "@orpc/client";
import { RPCLink } from "@orpc/client/message-port";
import type { Router } from "@orpc/server";
import { Context, Effect } from "effect";
import type { ActSender } from "../act-router/router.js";
import { ACT_ERROR, type ActPortClient, type PortActKind } from "../contract/index.js";
import type { ActPortContext } from "./base.js";
import { actPortHandlerOf, type PlatformActProcedures } from "./index.js";

/** What a call on the port came to: its answer, or the sentence it was refused with. */
export type SettledAct<Answer> = { readonly answer: Answer } | { readonly refused: string };

/** A test's act port: a client for each window it calls as, and the channels it opened, closed. */
export interface TestActPort<Sender> {
  /** The client of a window standing as `actor`, trusted unless said otherwise. */
  as(actor: ActSender<Sender>, options?: { readonly trusted?: boolean }): ActPortClient;
  /**
   * One kind called as `actor` would, its payload sent as the window sent
   * it, settled to its answer or its refusal's sentence; each window keeps
   * one channel across its calls, as a page keeps its port.
   */
  call(
    actor: ActSender<Sender>,
    kind: PortActKind,
    payload?: WireBoundaryInput,
    options?: { readonly trusted?: boolean },
  ): Promise<SettledAct<WireBoundaryInput>>;
  /** As `call`, for an Effect test: one act, `{ kind, payload }`, as the window `actor` sends it. */
  perform(
    act: { readonly kind: PortActKind; readonly payload?: WireBoundaryInput },
    actor: ActSender<Sender>,
    options?: { readonly trusted?: boolean },
  ): Effect.Effect<SettledAct<WireBoundaryInput>>;
  /** Closes every channel opened, which a test does once it is done. */
  close(): void;
}

/**
 * The act port's handler serving `procedures`, the ones a test calls, as
 * `createActPortHandler` serves them: a platform's own, or one host domain's
 * (`issueProcedures(dependencies)`), so a domain's test builds only its own
 * procedures over only its own dependencies.
 */
export function testActPort<Sender>(
  procedures: Partial<PlatformActProcedures<Sender>> | Router<ActPortContext<Sender>>,
): TestActPort<Sender> {
  const handler = actPortHandlerOf<Sender>(procedures);
  const opened: MessagePort[] = [];
  const windows = new Map<ActSender<Sender>, Map<boolean, ActPortClient>>();
  const port: TestActPort<Sender> = {
    as(actor, options = {}) {
      const { port1, port2 } = new MessageChannel();
      opened.push(port1, port2);
      handler.upgrade(port1, {
        context: () => ({
          actor,
          trusted: options.trusted ?? true,
          "effect/context": Context.empty(),
        }),
      });
      port1.start();
      const client: ActPortClient = createORPCClient(new RPCLink({ port: port2 }));
      port2.start();
      return client;
    },
    call(actor, kind, payload, options = {}) {
      const trusted = options.trusted ?? true;
      const held = windows.get(actor) ?? new Map<boolean, ActPortClient>();
      windows.set(actor, held);
      const client = held.get(trusted) ?? port.as(actor, { trusted });
      held.set(trusted, client);
      // SAFETY: a window's payload crosses as a structured-clone value, which the kind's own schema reads again.
      const procedure = client[kind] as (sent: WireBoundaryInput) => Promise<WireBoundaryInput>;
      return settledAct(procedure(payload));
    },
    perform(act, actor, options) {
      return Effect.promise(() => port.call(actor, act.kind, act.payload, options));
    },
    close() {
      windows.clear();
      for (const end of opened.splice(0)) end.close();
    },
  };
  return port;
}

/** One call on the port, settled to its answer or the sentence of its refusal. */
export async function settledAct<Answer>(call: Promise<Answer>): Promise<SettledAct<Answer>> {
  try {
    return { answer: await call };
  } catch (error) {
    if (error instanceof ORPCError && error.code === ACT_ERROR.REFUSED) {
      return { refused: error.message };
    }
    throw error;
  }
}
