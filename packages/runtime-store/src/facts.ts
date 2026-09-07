import { isRememberedFact, maximumRememberedFacts, type RememberedFact } from "@sidecar/acts";
import { parsedList } from "./history.js";

/**
 * Reads the remembered facts as the legacy `memory.json` holds them: invalid
 * records dropped, duplicates by id or words dropped, and nothing past the
 * cap. The facts file stays the live store of these until the notebook
 * arrives; this reader is what the import stages them from.
 */
export function rememberedFactsFromStored(stored: string | undefined): readonly RememberedFact[] {
  const facts: RememberedFact[] = [];
  const ids = new Set<string>();
  const words = new Set<string>();
  for (const value of parsedList(stored, "facts")) {
    if (isRememberedFact(value) && !ids.has(value.id) && !words.has(value.words)) {
      facts.push(value);
      ids.add(value.id);
      words.add(value.words);
    }
    if (facts.length === maximumRememberedFacts) break;
  }
  return facts;
}
