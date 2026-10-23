/**
 * attachment-chip.ts -- the name a drawn attachment chip carries, as a test reads it.
 */

/** The file name an attachment chip says: its thumbnail's alt, else its name's words. */
export function attachmentChipName(chip: Element): string | null {
  const picture = chip.querySelector("img")?.getAttribute("alt");
  return picture ?? chip.querySelector(".luke-attachment-chip-name")?.textContent ?? null;
}
