/**
 * mac-terminal-port.ts -- the ports main posts for terminals of this Mac, as the page receives them from the preload.
 *
 * A `MessagePort` cannot cross the context bridge, so the preload hands each
 * one into the page with `window.postMessage`, as it hands a Terminal tab's
 * (`../terminal/terminal-port.ts`), under the channel and the ticket naming
 * the agent whose terminal it carries. A message from any other source is no
 * port of main's and is ignored.
 */

import {
  MAC_TERMINAL_PORT_CHANNEL,
  macTerminalKeySchema,
} from "@luke/features/mac-repository-wire";
import { isRecord, unparsedWire } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Result } from "effect";

const readTicket = readEither(macTerminalKeySchema);

/** Calls back with each port main posts to this window for the agent's terminal, until the returned function is called. */
export function onMacTerminalPort(
  agentId: string,
  callback: (port: MessagePort) => void,
): () => void {
  const listener = (event: MessageEvent) => {
    // Only the preload, posting to its own window, hands a port in.
    if (event.source !== window) return;
    const message = unparsedWire(event.data);
    if (!isRecord(message) || message.channel !== MAC_TERMINAL_PORT_CHANNEL) return;
    const ticket = readTicket(message.ticket);
    const [port] = event.ports;
    if (Result.isFailure(ticket) || port === undefined || ticket.success.agentId !== agentId)
      return;
    callback(port);
  };
  window.addEventListener("message", listener);
  return () => window.removeEventListener("message", listener);
}
