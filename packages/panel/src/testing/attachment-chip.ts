export function attachmentChipName(chip: Element): string | null {
  const picture = chip.querySelector("img")?.getAttribute("alt");
  return picture ?? chip.querySelector(".ui-attachment-chip-name")?.textContent ?? null;
}
