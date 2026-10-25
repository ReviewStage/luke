/**
 * A guard's baseline: the places a rule still finds, counted by file, that
 * may only shrink. A rule lands with one where today's code breaks it, so it
 * holds every file from the day it lands; each change that fixes a place
 * lowers the count in the same change, and the rule is at zero once the
 * baseline is empty. Kept as a checked-in JSON object of counts by path.
 */

/** How many places each file may still hold, by path from the repository's root. */
export type Baseline = Readonly<Record<string, number>>;

/** A file whose count and baseline part: `grew` where it holds more than the baseline allows. */
export interface BaselineProblem {
  readonly file: string;
  readonly says: string;
  readonly grew: boolean;
}

/**
 * Where what each file holds and its baseline part: a place past the count,
 * which fails, and a count above what the file still holds, which fails too,
 * so the baseline shrinks in the change that fixes a place rather than
 * leaving room for a new one. A rule that started clean takes no baseline,
 * so any entry for it fails.
 */
export function baselineProblems(
  counts: ReadonlyMap<string, number>,
  baseline: Baseline,
  takesBaseline: boolean,
): readonly BaselineProblem[] {
  const problems: BaselineProblem[] = [];
  for (const [file, allowed] of Object.entries(baseline)) {
    const held = counts.get(file) ?? 0;
    if (!takesBaseline) {
      problems.push({ file, says: "the rule started clean and takes no baseline", grew: false });
    } else if (!Number.isInteger(allowed) || allowed < 1) {
      problems.push({ file, says: "a baseline count is a whole number above 0", grew: false });
    } else if (held < allowed) {
      const says = `holds ${held} where its baseline allows ${allowed}; lower it to ${held}`;
      problems.push({ file, says, grew: false });
    }
  }
  for (const [file, held] of counts) {
    const allowed = takesBaseline ? (baseline[file] ?? 0) : 0;
    if (held > allowed)
      problems.push({ file, says: `holds ${held} where ${allowed} may stand`, grew: true });
  }
  return problems;
}

/** A baseline lowered to what each file now holds and never raised, its files in order. */
export function shrunkBaseline(counts: ReadonlyMap<string, number>, baseline: Baseline): Baseline {
  const shrunk: Record<string, number> = {};
  for (const file of Object.keys(baseline).sort()) {
    const held = Math.min(counts.get(file) ?? 0, baseline[file] ?? 0);
    if (held > 0) shrunk[file] = held;
  }
  return shrunk;
}
