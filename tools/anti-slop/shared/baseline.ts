export type Baseline = Readonly<Record<string, number>>;

export interface BaselineProblem {
  readonly file: string;
  readonly says: string;
  readonly grew: boolean;
}

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

export function shrunkBaseline(counts: ReadonlyMap<string, number>, baseline: Baseline): Baseline {
  const shrunk: Record<string, number> = {};
  for (const file of Object.keys(baseline).sort()) {
    const held = Math.min(counts.get(file) ?? 0, baseline[file] ?? 0);
    if (held > 0) shrunk[file] = held;
  }
  return shrunk;
}
