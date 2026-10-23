/**
 * parsed-url.ts -- text read as an address, or nothing where it is none.
 *
 * Every link reader here reads an address in whatever browser opened it, and
 * Safari has no `URL.canParse` before 17 and no `URL.parse` before 18, so the
 * constructor is caught instead.
 */

/** The address parsed, or nothing for text that is no URL. */
export function parsedUrl(address: string): URL | undefined {
  try {
    return new URL(address);
  } catch {
    return undefined;
  }
}
