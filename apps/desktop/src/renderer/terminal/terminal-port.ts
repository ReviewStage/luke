/**
 * terminal-port.ts -- the ports main posts for attached shells, as the page receives them from the preload.
 *
 * A `MessagePort` cannot cross the context bridge, so the preload hands each
 * one into the page with `window.postMessage`, the way Electron hands a port
 * to an isolated world, under the terminal channel and the ticket naming the
 * shell it carries. A message from any other source — a page's frame, a
 * script posting to this window — is no port of main's and is ignored.
 */

import {
  TERMINAL_PORT_CHANNEL,
  type TerminalPortTicket,
  terminalPortTicketSchema,
} from "@luke/features/terminal-acts";
import { isRecord, unparsedWire } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Result } from "effect";

const readTicket = readEither(terminalPortTicketSchema);

/** Calls back with each shell's port as main posts it to this window, until the returned function is called. */
export function onTerminalPort(
  callback: (ticket: TerminalPortTicket, port: MessagePort) => void,
): () => void {
  const listener = (event: MessageEvent) => {
    // Only the preload, posting to its own window, hands a port in.
    if (event.source !== window) return;
    const message = unparsedWire(event.data);
    if (!isRecord(message) || message.channel !== TERMINAL_PORT_CHANNEL) return;
    const ticket = readTicket(message.ticket);
    const [port] = event.ports;
    if (Result.isFailure(ticket) || port === undefined) return;
    callback(ticket.success, port);
  };
  window.addEventListener("message", listener);
  return () => window.removeEventListener("message", listener);
}
