import { isDeepStrictEqual } from "node:util";

import { loadModule, type RepositoryGuard, readText } from "./guard.ts";

/**
 * probe-fixtures.ts -- the probes' committed recordings pass the probes' own leak guards, whoever edited them last.
 *
 * Each probe scrubs a live run before it writes a fixture and refuses to
 * write one its leak guard still names something in. A fixture edited by
 * hand, or recorded by an older probe, skips that door; this is the only
 * scan that reads what is committed (root AGENTS.md's "Never": no
 * credential in a fixture).
 */

const CLAUDE_PROBE = "tools/claude-code-probe";
const CODEX_PROBE = "tools/codex-probe";
const CLAUDE_FIXTURES = [
  "fixtures/claude-code-stream.jsonl",
  "fixtures/claude-code-probe-report.json",
];
const CODEX_FIXTURES = ["fixtures/hermetic/app-server.jsonl", "fixtures/live/report.json"];

type FindLeaks = (text: string, secrets: readonly never[]) => readonly string[];
type Scrub = (value: unknown) => unknown;

/** A fixture's values: each line of a JSON-lines file, or the one value of a JSON file. */
export function fixtureValues(file: string, text: string): readonly unknown[] {
  if (!file.endsWith(".jsonl")) return [JSON.parse(text)];
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as unknown);
}

/** What a leak guard names in each fixture, and each value scrubbing would still change. */
export function fixtureProblems(
  fixtures: readonly { readonly file: string; readonly text: string }[],
  findLeaks: FindLeaks,
  scrub: Scrub | undefined,
): readonly string[] {
  const problems: string[] = [];
  for (const { file, text } of fixtures) {
    for (const leak of findLeaks(text, []))
      problems.push(`${file}: the probe's leak guard names ${leak}`);
    if (scrub === undefined) continue;
    const changed = fixtureValues(file, text).filter(
      (value) => !isDeepStrictEqual(scrub(value), value),
    );
    if (changed.length > 0)
      problems.push(`${file}: ${changed.length} value(s) the probe's sanitizer would still change`);
  }
  return problems;
}

function fixturesOf(root: string, probe: string, files: readonly string[]) {
  return files.map((file) => ({
    file: `${probe}/${file}`,
    text: readText(root, `${probe}/${file}`),
  }));
}

async function probeProblems(root: string): Promise<readonly string[]> {
  const claude = await loadModule(root, `${CLAUDE_PROBE}/src/sanitize.ts`);
  const codex = await loadModule(root, `${CODEX_PROBE}/src/sanitize.ts`);
  if (typeof claude.fixtureLeaks !== "function" || typeof claude.sanitizer !== "function")
    throw new Error(`${CLAUDE_PROBE}'s sanitize.ts no longer exports fixtureLeaks and sanitizer`);
  if (typeof codex.findLeaks !== "function")
    throw new Error(`${CODEX_PROBE}'s sanitize.ts no longer exports findLeaks`);
  const scrub = (claude.sanitizer as (options: object) => Scrub)({ secrets: [], replacements: [] });
  return [
    ...fixtureProblems(
      fixturesOf(root, CLAUDE_PROBE, CLAUDE_FIXTURES),
      claude.fixtureLeaks as FindLeaks,
      scrub,
    ),
    ...fixtureProblems(
      fixturesOf(root, CODEX_PROBE, CODEX_FIXTURES),
      codex.findLeaks as FindLeaks,
      undefined,
    ),
  ];
}

export const probeFixturesGuard: RepositoryGuard = {
  holds:
    "the probes' committed fixtures hold nothing their own leak guards name, and are already sanitized: record them again through the probe",
  problems: probeProblems,
};
