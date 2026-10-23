/**
 * browser-live-port.ts -- the desktop's door to a cloud Browser tab's live view: the socket its host opens under the account's bearer, reached over the port main posts this window.
 *
 * The page never holds the bearer, so it asks main to attach a view under an
 * id it minted (`browser-live-acts.ts` in the desktop's main), and main posts
 * the view's port to this window alone. A `MessagePort` cannot cross the
 * context bridge, so the preload hands it into the page with
 * `window.postMessage` under the live view's channel and the ticket naming
 * the view, as a Terminal tab's port is handed in; a message from any other
 * source is no port of main's and is ignored. What the panel sends before
 * the port arrives is held for it, up to a bound.
 */

import {
  BROWSER_LIVE_ABNORMAL_CLOSE,
  BROWSER_LIVE_PORT_MESSAGE,
  type BrowserLiveTarget,
  browserLivePortOutboundSchema,
  browserLivePortTicketSchema,
} from "@luke/features/browser-live-acts";
import { BROWSER_LIVE_PORT_CHANNEL } from "@luke/features/port-channels";
import { ACT_KIND } from "@luke/host/acts";
import { isRecord, unparsedWire } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Result } from "effect";
import { askAct, tellAct } from "../act.js";
import type { BrowserLiveListener, BrowserLiveSocket } from "./cloud-browser-live.js";

/** The most text frames a view holds for a port still on its way; past it the newest are let go. */
const HELD_WHILE_OPENING = 32;

const readTicket = readEither(browserLivePortTicketSchema);
const readOutbound = readEither(browserLivePortOutboundSchema);

/** Calls back with the port main posts this window for the view named, until the returned function is called. */
function onViewPort(viewId: string, callback: (port: MessagePort) => void): () => void {
  const listener = (event: MessageEvent) => {
    // Only the preload, posting to its own window, hands a port in.
    if (event.source !== window) return;
    const message = unparsedWire(event.data);
    if (!isRecord(message) || message.channel !== BROWSER_LIVE_PORT_CHANNEL) return;
    const ticket = readTicket(message.ticket);
    const [port] = event.ports;
    if (Result.isFailure(ticket) || ticket.success.viewId !== viewId || port === undefined) return;
    callback(port);
  };
  window.addEventListener("message", listener);
  return () => window.removeEventListener("message", listener);
}

/** Opens one tab's live view through main: its port, once posted, carries the socket's text frames each way. */
export function openBrowserLiveOverPort(
  target: BrowserLiveTarget,
  listener: BrowserLiveListener,
): BrowserLiveSocket {
  const viewId = crypto.randomUUID();
  const held: string[] = [];
  let port: MessagePort | undefined;
  let done = false;
  const post = (to: MessagePort, text: string) =>
    to.postMessage({ type: BROWSER_LIVE_PORT_MESSAGE.SEND, text });
  const finish = (code: number) => {
    if (done) return;
    done = true;
    unhear();
    port?.close();
    listener.closed(code);
  };
  const unhear = onViewPort(viewId, (received) => {
    unhear();
    if (done) {
      received.close();
      return;
    }
    port = received;
    received.onmessage = (event) => {
      const read = readOutbound(unparsedWire(event.data));
      if (Result.isFailure(read)) return;
      const outbound = read.success;
      if (outbound.type === BROWSER_LIVE_PORT_MESSAGE.MESSAGE) listener.message(outbound.text);
      else finish(outbound.code);
    };
    for (const text of held.splice(0)) post(received, text);
  });
  askAct(ACT_KIND.BROWSER_LIVE_ATTACH, { viewId, ...target }).catch(() =>
    finish(BROWSER_LIVE_ABNORMAL_CLOSE),
  );
  return {
    send: (text) => {
      if (done) return;
      if (port !== undefined) post(port, text);
      else if (held.length < HELD_WHILE_OPENING) held.push(text);
    },
    close: () => {
      if (done) return;
      done = true;
      unhear();
      port?.close();
      tellAct(ACT_KIND.BROWSER_LIVE_DETACH, { viewId });
    },
  };
}
