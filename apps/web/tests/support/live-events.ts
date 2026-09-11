import { LIVE_DELEGATION_TARGET, LIVE_SERVER_EVENT, type LiveServerEvent } from "../../server/live";

/**
 * The server events of a synthetic Live stream, as the tests over the voice
 * record feed them: no real spoken word or session, each event numbered from
 * one shared counter so two tests never spell one id twice.
 */

let eventIds = 0;

export function liveEventId(): string {
  eventIds += 1;
  return `evt_${eventIds}`;
}

export function sessionStarted(liveSessionId: string): LiveServerEvent {
  return {
    type: LIVE_SERVER_EVENT.SESSION_STARTED,
    event_id: liveEventId(),
    session: { id: liveSessionId },
  };
}

/** One delta of the developer's transcript, on the session's clock. */
export function heard(delta: string, startMs: number, endMs: number): LiveServerEvent {
  return {
    type: LIVE_SERVER_EVENT.INPUT_TRANSCRIPT_DELTA,
    event_id: liveEventId(),
    delta,
    start_ms: startMs,
    end_ms: endMs,
  };
}

/** One delta of Luke's transcript, on the session's clock. */
export function said(delta: string, startMs: number, endMs: number): LiveServerEvent {
  return {
    type: LIVE_SERVER_EVENT.OUTPUT_TRANSCRIPT_DELTA,
    event_id: liveEventId(),
    delta,
    start_ms: startMs,
    end_ms: endMs,
  };
}

/** The acknowledgment of one commentary append, placed on the session's clock. */
export function appended(clientEventId: string, startMs: number, endMs: number): LiveServerEvent {
  return {
    type: LIVE_SERVER_EVENT.COMMENTARY_APPENDED,
    event_id: liveEventId(),
    client_event_id: clientEventId,
    start_ms: startMs,
    end_ms: endMs,
  };
}

/** A client delegation the model created at one offset on the session's clock. */
export function delegated(delegationId: string, offsetMs: number): LiveServerEvent {
  return {
    type: LIVE_SERVER_EVENT.DELEGATION_CREATED,
    event_id: liveEventId(),
    offset_ms: offsetMs,
    delegation: { id: delegationId, target: LIVE_DELEGATION_TARGET.CLIENT },
  };
}
