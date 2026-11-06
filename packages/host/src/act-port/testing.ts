import type { WireBoundaryInput } from "@repo/wire";
import { createORPCClient, ORPCError } from "@orpc/client";
import { RPCLink } from "@orpc/client/message-port";
import type { Router } from "@orpc/server";
import { Context, Effect } from "effect";
import { ACT_ERROR, type ActPortClient, type PortActKind } from "../contract/index.js";
import type { ActPortContext, ActSender } from "./base.js";
import { actPortHandlerOf, type PlatformActProcedures } from "./index.js";

export type SettledAct<Answer> = { readonly answer: Answer } | { readonly refused: string };

export interface TestActPort<Sender> {
  as(actor: ActSender<Sender>, options?: { readonly trusted?: boolean }): ActPortClient;
  call(
    actor: ActSender<Sender>,
    kind: PortActKind,
    payload?: WireBoundaryInput,
    options?: { readonly trusted?: boolean },
  ): Promise<SettledAct<WireBoundaryInput>>;
  perform(
    act: { readonly kind: PortActKind; readonly payload?: WireBoundaryInput },
    actor: ActSender<Sender>,
    options?: { readonly trusted?: boolean },
  ): Effect.Effect<SettledAct<WireBoundaryInput>>;
  close(): void;
}

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
