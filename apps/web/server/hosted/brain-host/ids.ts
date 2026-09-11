import { createHash } from "node:crypto";

/**
 * The ids the host mints for what eve's stream names only relatively. A turn
 * of eve's is `turn_<n>` inside its session, and a received message or a
 * reasoning item has no id of its own; the store keys a turn by uuid and a
 * message by a client id unique in its conversation. Each id here is the
 * same function of the same coordinates, so a retried step that re-emits an
 * event under a new event id lands on the row the first attempt opened
 * rather than beside it. The ids are name-based uuids in RFC 9562's custom
 * version 8 shape, the coordinates digested with SHA-256: nothing about them
 * is secret, and the digest is only what makes the same name the same id.
 */

/** The one namespace every host-minted id hashes under; a fixed uuid, never derived from data. */
const BRAIN_HOST_ID_NAMESPACE = "3c9b1f8e-4a52-4d6b-9e0f-7b2c5a1d8e43";

const UUID_VERSION_8 = 0x80;
const UUID_VARIANT_RFC_4122 = 0x80;

function uuidBytes(uuid: string): Buffer {
  return Buffer.from(uuid.replaceAll("-", ""), "hex");
}

/** A name-based uuid: the SHA-256 of the namespace and the name, its first sixteen bytes laid out as a version 8 uuid. */
function nameBasedUuid(namespace: string, name: string): string {
  const digest = createHash("sha256")
    .update(uuidBytes(namespace))
    .update(name, "utf8")
    .digest()
    .subarray(0, 16);
  digest[6] = ((digest[6] ?? 0) & 0x0f) | UUID_VERSION_8;
  digest[8] = ((digest[8] ?? 0) & 0x3f) | UUID_VARIANT_RFC_4122;
  const hex = digest.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The parts of a coordinate, joined so no part can run into the next. */
function coordinate(parts: readonly string[]): string {
  return JSON.stringify(parts);
}

const ID_KIND = {
  TURN: "turn",
  RECEIVED: "received",
  ANSWER: "answer",
  REASONING: "reasoning",
} as const;

/** The store's id for one turn of one eve session. */
export function hostTurnId(sessionId: string, eveTurnId: string): string {
  return nameBasedUuid(BRAIN_HOST_ID_NAMESPACE, coordinate([ID_KIND.TURN, sessionId, eveTurnId]));
}

/** The client id of the user message a turn was handed; one per turn, since eve delivers one message per turn. */
export function receivedMessageId(sessionId: string, eveTurnId: string): string {
  return nameBasedUuid(
    BRAIN_HOST_ID_NAMESPACE,
    coordinate([ID_KIND.RECEIVED, sessionId, eveTurnId]),
  );
}

/** The client id of the assistant message a turn completes; the turn's id is its journal's client id already, so this is another. */
export function answerMessageId(sessionId: string, eveTurnId: string): string {
  return nameBasedUuid(BRAIN_HOST_ID_NAMESPACE, coordinate([ID_KIND.ANSWER, sessionId, eveTurnId]));
}

/** The id a reasoning item stands under, since eve's stream carries none of the provider's. */
export function reasoningItemId(
  sessionId: string,
  eveTurnId: string,
  stepIndex: number,
  ordinal: number,
): string {
  return nameBasedUuid(
    BRAIN_HOST_ID_NAMESPACE,
    coordinate([ID_KIND.REASONING, sessionId, eveTurnId, String(stepIndex), String(ordinal)]),
  );
}
