/**
 * terminal-port.ts -- the ports the host posts for attached shells, as the page receives them: from the desktop's preload, or from the host in a browser tab.
 *
 * Either way the port reaches the page as this window's own message, under
 * the terminal channel and the ticket naming the shell it carries. On the
 * desktop a `MessagePort` cannot cross the context bridge, so the preload
 * hands each one in with `window.postMessage`, the way Electron hands a port
 * to an isolated world; in a browser tab the host runs in the page and posts
 * each one to its own window (`apps/web`'s `web-host.ts`). A message from
 * any other source, a page's frame or another window's script, is no
 * host's port and is ignored.
 */

import { TERMINAL_PORT_CHANNEL } from "@luke/features/port-channels";
import { type TerminalPortTicket, terminalPortTicketSchema } from "@luke/features/terminal-acts";
import { isRecord, unparsedWire } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Result } from "effect";

const readTicket = readEither(terminalPortTicketSchema);

/** Calls back with each shell's port as main posts it to this window, until the returned function is called. */
export function onTerminalPort(
  callback: (ticket: TerminalPortTicket, port: MessagePort) => void,
): () => void {
  const listener = (event: MessageEvent) => {
    // Only this window's own post hands a port in: the desktop's preload's, or the tab's host's.
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
