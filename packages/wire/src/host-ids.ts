import { sha256 } from "@noble/hashes/sha2.js";

const HOST_MINTED_ID_NAMESPACE = "3c9b1f8e-4a52-4d6b-9e0f-7b2c5a1d8e43";

const UUID_VERSION_8 = 0x80;
const UUID_VARIANT_RFC_4122 = 0x80;

const SENT_KIND = "sent";

const HEX = 16;

function uuidBytes(uuid: string): Uint8Array {
  const hex = uuid.replaceAll("-", "");
  return Uint8Array.from({ length: hex.length / 2 }, (_, at) =>
    Number.parseInt(hex.slice(at * 2, at * 2 + 2), HEX),
  );
}

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

export function hostMintedId(parts: readonly string[]): string {
  return nameBasedUuid(HOST_MINTED_ID_NAMESPACE, JSON.stringify(parts));
}

export function sentLineId(clientKey: string): string {
  return hostMintedId([SENT_KIND, clientKey]);
}
