import { sha256 } from "@noble/hashes/sha2.js";

/**
 * host-ids.ts -- the name-based uuids the host mints, as one function every side can run: the service writing a row, and a window that sent the line and must know the row before it lands.
 *
 * The store keys what eve's stream names only relatively (a turn, a received
 * message, a reasoning item) and the lines a client sends by ids that are the
 * same function of the same coordinates, so a retried write lands on the row
 * the first attempt opened. The ids are name-based uuids in RFC 9562's custom
 * version 8 shape, the coordinates digested with SHA-256: nothing about them
 * is secret, and the digest is only what makes the same name the same id. The
 * digest is a pure one rather than `node:crypto`'s, so the panel derives a
 * sent line's row id (`sentLineId`) exactly as the service writes it.
 */

/** The one namespace every host-minted id hashes under; a fixed uuid, never derived from data. */
const BRAIN_HOST_ID_NAMESPACE = "3c9b1f8e-4a52-4d6b-9e0f-7b2c5a1d8e43";

const UUID_VERSION_8 = 0x80;
const UUID_VARIANT_RFC_4122 = 0x80;

/** What a sent line's coordinate is named, apart from every other kind the host mints. */
const SENT_KIND = "sent";

const HEX = 16;

function uuidBytes(uuid: string): Uint8Array {
  const hex = uuid.replaceAll("-", "");
  return Uint8Array.from({ length: hex.length / 2 }, (_, at) =>
    Number.parseInt(hex.slice(at * 2, at * 2 + 2), HEX),
  );
}

/** A name-based uuid: the SHA-256 of the namespace and the name, its first sixteen bytes laid out as a version 8 uuid. */
function nameBasedUuid(namespace: string, name: string): string {
  const space = uuidBytes(namespace);
  const words = new TextEncoder().encode(name);
  const input = new Uint8Array(space.length + words.length);
  input.set(space);
  input.set(words, space.length);
  const digest = sha256(input).subarray(0, 16);
  digest[6] = ((digest[6] ?? 0) & 0x0f) | UUID_VERSION_8;
  digest[8] = ((digest[8] ?? 0) & 0x3f) | UUID_VARIANT_RFC_4122;
  const hex = Array.from(digest, (byte) => byte.toString(HEX).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The host's id for a coordinate, its parts joined so no part can run into the next. */
export function brainHostId(parts: readonly string[]): string {
  return nameBasedUuid(BRAIN_HOST_ID_NAMESPACE, JSON.stringify(parts));
}

/** The developer's line sent to a coding agent, under the key the client made for the send, which is how a send repeated after a lost answer finds the row it already wrote, and how the window that sent it knows that row as it lands. */
export function sentLineId(clientKey: string): string {
  return brainHostId([SENT_KIND, clientKey]);
}
