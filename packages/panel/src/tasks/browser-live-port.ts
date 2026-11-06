import {
  BROWSER_LIVE_ABNORMAL_CLOSE,
  BROWSER_LIVE_PORT_CHANNEL,
  BROWSER_LIVE_PORT_MESSAGE,
  type BrowserLiveTarget,
  browserLivePortOutboundSchema,
  browserLivePortTicketSchema,
} from "@repo/features/browser-live-acts";
import { ACT_KIND } from "@repo/host/acts";
import { isRecord, unparsedWire } from "@repo/wire";
import { readEither } from "@repo/wire/effect";
import { Result } from "effect";
import { askAct, tellAct } from "../act.js";
import type { BrowserLiveListener, BrowserLiveSocket } from "./cloud-browser-live.js";

const HELD_WHILE_OPENING = 32;

const readTicket = readEither(browserLivePortTicketSchema);
const readOutbound = readEither(browserLivePortOutboundSchema);

function onViewPort(viewId: string, callback: (port: MessagePort) => void): () => void {
  const listener = (event: MessageEvent) => {
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
