import {
  BROWSER_LIVE_PORT_MESSAGE,
  type BrowserLivePortOutbound,
  type BrowserLivePortTicket,
  browserLivePortInboundSchema,
} from "@repo/features/browser-live-acts";
import { unparsedWire, type WireBoundaryInput } from "@repo/wire";
import { readEither } from "@repo/wire/effect";
import { Effect, Result } from "effect";
import { BROWSER_LIVE_ACT_KIND } from "../contract/index.js";
import type { HostOperator } from "../host-operator.js";
import { type ActSender, actPortFor } from "./base.js";
import type { PlatformActProcedures } from "./index.js";

type BrowserLiveActKind = (typeof BROWSER_LIVE_ACT_KIND)[keyof typeof BROWSER_LIVE_ACT_KIND];

export interface MainBrowserLivePort {
  post(message: BrowserLivePortOutbound): void;
  onMessage(listener: (message: WireBoundaryInput) => void): void;
  close(): void;
}

interface BrowserLivePortSeam<Sender> {
  open(sender: Sender, ticket: BrowserLivePortTicket): MainBrowserLivePort;
  whenGone(sender: Sender, then: () => void): void;
}

export interface BrowserLiveActsDependencies<Sender> {
  host: Pick<
    HostOperator,
    | "browserLiveConnect"
    | "browserLiveSend"
    | "browserLiveDisconnect"
    | "onBrowserLiveMessage"
    | "onBrowserLiveClosed"
  >;
  ports: BrowserLivePortSeam<Sender>;
  createId: () => string;
  run: <A>(effect: Effect.Effect<A>) => Promise<A>;
}

interface Attached {
  readonly connectionId: string;
  readonly port: MainBrowserLivePort;
}

const readInbound = readEither(browserLivePortInboundSchema);

export function browserLiveProcedures<Sender>(
  dependencies: BrowserLiveActsDependencies<Sender>,
): Pick<PlatformActProcedures<Sender>, BrowserLiveActKind> {
  const browserLivePort = actPortFor<Sender>();
  const { host, ports, createId, run } = dependencies;
  const panels = new Map<Sender, Map<string, Attached>>();
  const byConnection = new Map<string, MainBrowserLivePort>();

  host.onBrowserLiveMessage(({ connectionId, text }) => {
    byConnection.get(connectionId)?.post({ type: BROWSER_LIVE_PORT_MESSAGE.MESSAGE, text });
  });
  host.onBrowserLiveClosed(({ connectionId, code }) => {
    const port = byConnection.get(connectionId);
    if (port === undefined) return;
    byConnection.delete(connectionId);
    port.post({ type: BROWSER_LIVE_PORT_MESSAGE.CLOSED, code });
    port.close();
  });

  const release = (attached: Attached) =>
    Effect.suspend(() => {
      attached.port.close();
      byConnection.delete(attached.connectionId);
      return host.browserLiveDisconnect({ connectionId: attached.connectionId });
    });

  const heard = (connectionId: string, message: WireBoundaryInput): Effect.Effect<void> => {
    const read = readInbound(unparsedWire(message));
    if (Result.isFailure(read)) return Effect.void;
    return host.browserLiveSend({ connectionId, text: read.success.text });
  };

  const attachedOf = (sender: Sender) => {
    const held = panels.get(sender);
    if (held !== undefined) return held;
    const fresh = new Map<string, Attached>();
    panels.set(sender, fresh);
    ports.whenGone(sender, () => {
      panels.delete(sender);
      void run(Effect.forEach([...fresh.values()], release, { discard: true }));
    });
    return fresh;
  };

  const panelOf = (actor: ActSender<Sender>): Sender | undefined =>
    actor.panel ? actor.sender : undefined;

  return {
    [BROWSER_LIVE_ACT_KIND.BROWSER_LIVE_ATTACH]: browserLivePort[
      BROWSER_LIVE_ACT_KIND.BROWSER_LIVE_ATTACH
    ].effect(function* ({ input, context, errors }) {
      const sender = panelOf(context.actor);
      if (sender === undefined) return yield* Effect.fail(errors.REFUSED());
      const held = attachedOf(sender);
      const earlier = held.get(input.viewId);
      if (earlier !== undefined) {
        held.delete(input.viewId);
        yield* release(earlier);
      }
      const connectionId = createId();
      const port = ports.open(sender, { viewId: input.viewId });
      const attached = { connectionId, port };
      held.set(input.viewId, attached);
      byConnection.set(connectionId, port);
      port.onMessage((message) => void run(heard(connectionId, message)));
      const taken = yield* host.browserLiveConnect({
        connectionId,
        agentId: input.agentId,
        tabId: input.tabId,
      });
      if (taken) return;
      if (held.get(input.viewId) === attached) held.delete(input.viewId);
      yield* release(attached);
      return yield* Effect.fail(errors.REFUSED());
    }),
    [BROWSER_LIVE_ACT_KIND.BROWSER_LIVE_DETACH]: browserLivePort[
      BROWSER_LIVE_ACT_KIND.BROWSER_LIVE_DETACH
    ].effect(function* ({ input, context, errors }) {
      if (!context.actor.panel) return yield* Effect.fail(errors.REFUSED());
      const held = panels.get(context.actor.sender);
      const attached = held?.get(input.viewId);
      if (held === undefined || attached === undefined) return;
      held.delete(input.viewId);
      yield* release(attached);
    }),
  };
}
