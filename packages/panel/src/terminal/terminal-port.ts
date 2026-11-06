import {
  TERMINAL_PORT_CHANNEL,
  type TerminalPortTicket,
  terminalPortTicketSchema,
} from "@repo/features/terminal-acts";
import { isRecord, unparsedWire } from "@repo/wire";
import { readEither } from "@repo/wire/effect";
import { Result } from "effect";

const readTicket = readEither(terminalPortTicketSchema);

export function onTerminalPort(
  callback: (ticket: TerminalPortTicket, port: MessagePort) => void,
): () => void {
  const listener = (event: MessageEvent) => {
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
