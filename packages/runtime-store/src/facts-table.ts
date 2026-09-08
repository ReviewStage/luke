import { isRememberedFact, maximumRememberedFacts, type RememberedFact } from "@sidecar/acts";
import type { RuntimeDatabase } from "./database.js";

/**
 * The facts Luke remembers about the developer, written whole. The remember
 * and forget acts compute the next list from the one they read and hand it
 * here; the cap and the no-duplicate rules are the list's own, and a list
 * past them is refused rather than cut.
 */

export function replacePersonalFacts(
  database: RuntimeDatabase,
  facts: readonly RememberedFact[],
): boolean {
  if (facts.length > maximumRememberedFacts) return false;
  if (!facts.every((fact) => isRememberedFact({ id: fact.id, words: fact.words }))) return false;
  if (new Set(facts.map((fact) => fact.words)).size !== facts.length) return false;
  if (new Set(facts.map((fact) => fact.id)).size !== facts.length) return false;
  database.transaction(() => {
    database.exec("DELETE FROM personal_facts");
    const insert = database.prepare(
      "INSERT INTO personal_facts (id, ordinal, words) VALUES (?, ?, ?)",
    );
    facts.forEach((fact, ordinal) => {
      insert.run(fact.id, ordinal, fact.words);
    });
  });
  return true;
}

export function personalFacts(database: RuntimeDatabase): readonly RememberedFact[] {
  // SAFETY: the two text columns selected are the ones the row type names.
  const rows = database.prepare("SELECT id, words FROM personal_facts ORDER BY ordinal").all() as {
    id: string;
    words: string;
  }[];
  return rows.map((row) => ({ id: row.id, words: row.words }));
}
