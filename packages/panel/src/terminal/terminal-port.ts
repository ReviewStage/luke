/**
 * terminal-port.ts -- the ports main posts for attached shells, as the page receives them from the desktop's preload.
 *
 * The port reaches the page as this window's own message, under the
 * terminal channel and the ticket naming the shell it carries: a
 * `MessagePort` cannot cross the context bridge, so the preload hands each
 * one in with `window.postMessage`, the way Electron hands a port to an
 * isolated world. A message from any other source, a page's frame or
 * another window's script, is no host's port and is ignored.
 */

import {
  TERMINAL_PORT_CHANNEL,
  type TerminalPortTicket,
  terminalPortTicketSchema,
} from "@repo/features/terminal-acts";
import { isRecord, unparsedWire } from "@repo/wire";
import { readEither } from "@repo/wire/effect";
import { Result } from "effect";

const readTicket = readEither(terminalPortTicketSchema);

/** Calls back with each shell's port as main posts it to this window, until the returned function is called. */
export function onTerminalPort(
  callback: (ticket: TerminalPortTicket, port: MessagePort) => void,
): () => void {
  const listener = (event: MessageEvent) => {
    // Only this window's own post hands a port in: the desktop's preload's.
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
