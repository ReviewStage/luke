import type { ParsedRealtimeServerEvent } from "@sidecar/realtime";

/**
 * One named handler per server event a call acts on, each narrowed to its own
 * event. The table is deliberately partial: a call answers the events its own
 * kind of turn-taking needs, and everything else the parser kept — an event
 * type this build knows but this call has no use for — is simply unhandled.
 * What a subclass adds or overrides is visible as the keys it spreads over its
 * parent's, rather than as arms interleaved in one switch.
 */
export type RealtimeServerEventHandlers = {
  [Type in ParsedRealtimeServerEvent["type"]]?: (
    event: Extract<ParsedRealtimeServerEvent, { type: Type }>,
  ) => void;
};
