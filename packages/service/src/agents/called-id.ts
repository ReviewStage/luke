import { createHash } from "node:crypto";

const NAME_BASED_UUID = { VERSION: 0x50, VERSION_MASK: 0x0f, VARIANT: 0x80, VARIANT_MASK: 0x3f };

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
