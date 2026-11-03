/**
 * attached-files.ts -- a file's bytes as the wire spells them.
 *
 * Reading them, which come and why one cannot, is `useAttachedFiles`' own
 * (`../use-attached-files.ts`).
 */

/** Bytes as base64, a chunk at a time, since one call's arguments cannot hold a file. */
export function base64Of(bytes: Uint8Array): string {
  let binary = "";
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  }
  return btoa(binary);
}
