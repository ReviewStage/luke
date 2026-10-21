/**
 * browser-live-acts.ts -- what a cloud Browser tab's live view says to the desktop's main process and hears back: the attach and detach acts' payloads, and the messages on the port each attached view gets.
 *
 * The desktop opens the live view's socket (`browser-live-wire.ts`) from its
 * host under the account's bearer, never from the page, as it opens a
 * terminal. Its acts carry ids alone, never a frame, an address, or a title;
 * what the socket carries travels on one `MessagePort` per attached view,
 * posted by main to the panel that asked and to no other window, so nothing
 * the page shows enters app state, an act, a trace, or the voice window
 * (root `AGENTS.md`'s cloud browser line). The port is posted on its own
 * channel with a ticket naming the view the panel minted; the preload hands
 * it into the page the way Electron hands a port to an isolated world, and
 * the page reads it back by that channel. The web app opens the same socket
 * from its own page, at the same path (`browserLivePath`).
 */

import { Schema as EffectSchema } from "effect";
import { BROWSER_LIVE } from "./browser-live-wire.js";

/** The channel each attached view's port is posted on. */
export const BROWSER_LIVE_PORT_CHANNEL = "browser-live:port";

/** The kinds of message on a view's port. */
export const BROWSER_LIVE_PORT_MESSAGE = {
  /** main → renderer: one text frame the service sent, unread. */
  MESSAGE: "message",
  /** main → renderer: the socket closed, with its close code; the port closes after it. */
  CLOSED: "closed",
  /** renderer → main: one text frame for the service. */
  SEND: "send",
} as const;

/**
 * The close code a socket that never opened is told with, as a browser's
 * `WebSocket` tells a refused or unreachable upgrade: a drop, which the tab
 * opens again after a wait.
 */
export const BROWSER_LIVE_ABNORMAL_CLOSE = 1006;

/** The most characters one text frame the panel sends carries: an input message, well under it. */
const BROWSER_LIVE_SEND_MAX_CHARS = 16_384;

/** One cloud Browser tab of one task, as its live view names it. */
export const browserLiveTargetSchema = EffectSchema.Struct({
  taskId: EffectSchema.NonEmptyString,
  tabId: EffectSchema.NonEmptyString,
});

export type BrowserLiveTarget = typeof browserLiveTargetSchema.Type;

/** The ticket a view's port is posted with: the id the panel minted for it. */
export const browserLivePortTicketSchema = EffectSchema.Struct({
  viewId: EffectSchema.NonEmptyString,
});

export type BrowserLivePortTicket = typeof browserLivePortTicketSchema.Type;

/** An attach: the view the panel minted, and the tab it shows. */
export const browserLiveAttachParamsSchema = EffectSchema.Struct({
  ...browserLivePortTicketSchema.fields,
  ...browserLiveTargetSchema.fields,
});

/** A detach: the view the panel minted. */
export const browserLiveDetachParamsSchema = browserLivePortTicketSchema;

/** What the renderer sends on a view's port, read by main before anything is sent on. */
export const browserLivePortInboundSchema = EffectSchema.Struct({
  type: EffectSchema.Literal(BROWSER_LIVE_PORT_MESSAGE.SEND),
  text: EffectSchema.String.check(EffectSchema.isMaxLength(BROWSER_LIVE_SEND_MAX_CHARS)),
});

export type BrowserLivePortInbound = typeof browserLivePortInboundSchema.Type;

/** What main sends on a view's port: a text frame the service sent, or the socket's close. */
export const browserLivePortOutboundSchema = EffectSchema.Union([
  EffectSchema.Struct({
    type: EffectSchema.Literal(BROWSER_LIVE_PORT_MESSAGE.MESSAGE),
    text: EffectSchema.String,
  }),
  EffectSchema.Struct({
    type: EffectSchema.Literal(BROWSER_LIVE_PORT_MESSAGE.CLOSED),
    code: EffectSchema.Int,
  }),
]);

export type BrowserLivePortOutbound = typeof browserLivePortOutboundSchema.Type;

/** The socket's path and query for one tab, which the desktop puts on the service's origin and the web on its own. */
export function browserLivePath(target: BrowserLiveTarget): string {
  const query = new URLSearchParams({
    [BROWSER_LIVE.QUERY.TASK]: target.taskId,
    [BROWSER_LIVE.QUERY.TAB]: target.tabId,
  });
  return `${BROWSER_LIVE.PATH}?${query.toString()}`;
}

/** One attached view, as the desktop names it to its host: the connection main minted for it. */
export const browserLiveConnectionParamsSchema = EffectSchema.Struct({
  connectionId: EffectSchema.NonEmptyString,
});

/** A view's socket opened by the host: its connection, and the tab it shows. */
export const browserLiveConnectParamsSchema = EffectSchema.Struct({
  ...browserLiveConnectionParamsSchema.fields,
  ...browserLiveTargetSchema.fields,
});

/** One text frame for the service, on a view's connection. */
export const browserLiveSendParamsSchema = EffectSchema.Struct({
  ...browserLiveConnectionParamsSchema.fields,
  text: browserLivePortInboundSchema.fields.text,
});

/** The host's event for one text frame the service sent on a view's connection. */
export const browserLiveMessageEventSchema = EffectSchema.Struct({
  ...browserLiveConnectionParamsSchema.fields,
  text: EffectSchema.String,
});

export type BrowserLiveMessageEvent = typeof browserLiveMessageEventSchema.Type;

/** The host's event for a view's socket closing, with its close code. */
export const browserLiveClosedEventSchema = EffectSchema.Struct({
  ...browserLiveConnectionParamsSchema.fields,
  code: EffectSchema.Int,
});

export type BrowserLiveClosedEvent = typeof browserLiveClosedEventSchema.Type;
