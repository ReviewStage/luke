import { createHash } from "node:crypto";

/**
 * called-id.ts -- the id a row an agent's call makes is made under, drawn from the member and eve's key for the call.
 *
 * eve runs a tool call again where its answer was lost, under the same key,
 * so a call that makes a row, a section or a task, makes it under an id
 * named from that key and the member the caller acts for: the call run
 * again names the row it made, and finds it rather than making a second,
 * and no other account's call names it.
 */

/** The UUID's version and variant bits, set as RFC 9562 sets them on a name-based (SHA) id. */
const NAME_BASED_UUID = { VERSION: 0x50, VERSION_MASK: 0x0f, VARIANT: 0x80, VARIANT_MASK: 0x3f };

/** The name-based UUID of the member and the call's key. */
export function calledId(userId: string, clientKey: string): string {
  const digest = createHash("sha256")
    .update(JSON.stringify([userId, clientKey]))
    .digest();
  digest[6] = ((digest[6] ?? 0) & NAME_BASED_UUID.VERSION_MASK) | NAME_BASED_UUID.VERSION;
  digest[8] = ((digest[8] ?? 0) & NAME_BASED_UUID.VARIANT_MASK) | NAME_BASED_UUID.VARIANT;
  const hex = digest.subarray(0, 16).toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}
