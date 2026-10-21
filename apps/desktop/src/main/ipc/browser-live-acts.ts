/**
 * browser-live-acts.ts -- a cloud Browser tab's live view as main carries it: each view a panel attaches gets a port of its own, its socket opened by the host, from a panel alone and only while the experiment is on.
 *
 * An attach mints a connection for the asking panel and that one view, opens
 * a channel, and posts the channel's other end to that panel alone under
 * the ticket the panel minted; what the service sends arrives as the host's
 * events for that connection and is posted on main's end, and what the panel
 * sends arrives on it and goes to the host named by the same connection.
 * Nothing the page shows is read here beyond its connection's id, kept,
 * logged, or written to app state: each frame passes from the host's event
 * to the one port and is let go (root `AGENTS.md`'s cloud browser line). A
 * panel that attaches a view it already holds has the older port closed
 * first, and a panel whose page is gone has every port it held closed and
 * every connection let go. A cloud Browser tab is drawn in a panel and
 * behind Settings › Experimental, so an attach from any other window, or
 * from a panel while the account has the experiment off, is refused.
 */

import {
  BROWSER_LIVE_PORT_MESSAGE,
  type BrowserLivePortOutbound,
  type BrowserLivePortTicket,
  browserLivePortInboundSchema,
} from "@luke/features/browser-live-acts";
import type { ActSender } from "@luke/host/act-port";
import { actPortFor, type PlatformActProcedures } from "@luke/host/act-port";
import { BROWSER_LIVE_ACT_KIND } from "@luke/host/contract";
import type { HostOperator } from "@luke/host/host-operator";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Effect, Result } from "effect";
import type { WebContents } from "electron";

type BrowserLiveActKind = (typeof BROWSER_LIVE_ACT_KIND)[keyof typeof BROWSER_LIVE_ACT_KIND];

/** Main's end of one attached view's channel. */
export interface MainBrowserLivePort {
  post(message: BrowserLivePortOutbound): void;
  /** Hears each message the panel sends, unread. */
  onMessage(listener: (message: WireBoundaryInput) => void): void;
  close(): void;
}

/** How main reaches a panel's page for its ports. */
interface BrowserLivePortSeam {
  /** A fresh channel: main's end, with the other end already posted to the panel under the ticket. */
  open(sender: WebContents, ticket: BrowserLivePortTicket): MainBrowserLivePort;
  /** Calls `then` once, when the panel's page is gone. */
  whenGone(sender: WebContents, then: () => void): void;
}

export interface BrowserLiveActsDependencies {
  host: Pick<
    HostOperator,
    | "browserLiveConnect"
    | "browserLiveSend"
    | "browserLiveDisconnect"
    | "onBrowserLiveMessage"
    | "onBrowserLiveClosed"
  >;
  ports: BrowserLivePortSeam;
  /** Whether the account has the Browser tab experiment on now. */
  experimentOn: () => boolean;
  /** A fresh connection id. */
  createId: () => string;
  /** Runs what a port's message asks of the host, from the port's own callback. */
  run: <A>(effect: Effect.Effect<A>) => Promise<A>;
}

/** One view a panel attached: the connection the host knows it by, and main's end of its channel. */
interface Attached {
  readonly connectionId: string;
  readonly port: MainBrowserLivePort;
}

const readInbound = readEither(browserLivePortInboundSchema);

const browserLivePort = actPortFor<WebContents>();

export function browserLiveProcedures(
  dependencies: BrowserLiveActsDependencies,
): Pick<PlatformActProcedures<WebContents>, BrowserLiveActKind> {
  const { host, ports, experimentOn, createId, run } = dependencies;
  /** Each panel's attached views, by the id the panel minted. */
  const panels = new Map<WebContents, Map<string, Attached>>();
  /** Every attached view, by connection, which is how the host names its events. */
  const byConnection = new Map<string, MainBrowserLivePort>();

  host.onBrowserLiveMessage(({ connectionId, text }) => {
    byConnection.get(connectionId)?.post({ type: BROWSER_LIVE_PORT_MESSAGE.MESSAGE, text });
  });
  // A socket that closed closes its port after saying so; the panel opens another when it wants one.
  host.onBrowserLiveClosed(({ connectionId, code }) => {
    const port = byConnection.get(connectionId);
    if (port === undefined) return;
    byConnection.delete(connectionId);
    port.post({ type: BROWSER_LIVE_PORT_MESSAGE.CLOSED, code });
    port.close();
  });

  /** One attached view let go: its port closed and its connection ended at the host. */
  const release = (attached: Attached) =>
    Effect.suspend(() => {
      attached.port.close();
      byConnection.delete(attached.connectionId);
      return host.browserLiveDisconnect({ connectionId: attached.connectionId });
    });

  /** What the panel sent on one connection's port, read and handed to the host; anything else is dropped. */
  const heard = (connectionId: string, message: WireBoundaryInput): Effect.Effect<void> => {
    const read = readInbound(unparsedWire(message));
    if (Result.isFailure(read)) return Effect.void;
    return host.browserLiveSend({ connectionId, text: read.success.text });
  };

  /** The panel's attached views, its page's end watched for the first time it attaches any. */
  const attachedOf = (sender: WebContents) => {
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

  /** The asking panel's contents, or nothing where it is no panel or the experiment is off. */
  const panelOf = (actor: ActSender<WebContents>): WebContents | undefined =>
    actor.panel && experimentOn() ? actor.sender : undefined;

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
        taskId: input.taskId,
        tabId: input.tabId,
      });
      if (taken) return;
      // Note that only this attach's own entry goes, because a newer attach of the view may have taken its place.
      if (held.get(input.viewId) === attached) held.delete(input.viewId);
      yield* release(attached);
      return yield* Effect.fail(errors.REFUSED());
    }),
    // Note that a detach is answered even with the experiment off, because a view standing as it went off must still be let go.
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
