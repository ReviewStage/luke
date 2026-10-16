/**
 * pr-run-port.ts -- the ports main posts for pull request runs, as the page receives them from the preload.
 *
 * A `MessagePort` cannot cross the context bridge, so the preload hands each
 * one into the page with `window.postMessage`, as it hands a Terminal tab's
 * (`../terminal/terminal-port.ts`), under the run channel and the ticket
 * naming the pull request it carries. A message from any other source is no
 * port of main's and is ignored.
 */

import {
  PR_RUN_PORT_CHANNEL,
  type PrRunTarget,
  prRunPortTicketSchema,
} from "@luke/features/pr-run-view";
import { isRecord, unparsedWire } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Result } from "effect";

const readTicket = readEither(prRunPortTicketSchema);

/** Calls back with each run's port as main posts it to this window, until the returned function is called. */
export function onPrRunPort(
  callback: (ticket: PrRunTarget, port: MessagePort) => void,
): () => void {
  const listener = (event: MessageEvent) => {
    // Only the preload, posting to its own window, hands a port in.
    if (event.source !== window) return;
    const message = unparsedWire(event.data);
    if (!isRecord(message) || message.channel !== PR_RUN_PORT_CHANNEL) return;
    const ticket = readTicket(message.ticket);
    const [port] = event.ports;
    if (Result.isFailure(ticket) || port === undefined) return;
    callback(ticket.success, port);
  };
  window.addEventListener("message", listener);
  return () => window.removeEventListener("message", listener);
}
