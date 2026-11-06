import { NOTE_KIND, type DescriptionNote } from "@repo/features/description-notes";

export function added(section: string, text: string): DescriptionNote {
  return { kind: NOTE_KIND.ADD, section, text };
}
