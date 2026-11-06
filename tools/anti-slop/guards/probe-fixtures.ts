import { isDeepStrictEqual } from "node:util";

import { loadModule, type RepositoryGuard, readText } from "./guard.ts";

const CLAUDE_PROBE = "tools/claude-code-probe";
const CODEX_SANITIZER = "packages/agent-runner/src/testing/sanitize.ts";
const CLAUDE_FIXTURES = [`${CLAUDE_PROBE}/fixtures/claude-code-stream.jsonl`];
const CODEX_FIXTURES = ["packages/agent-runner/src/testing/app-server.jsonl"];

type FindLeaks = (text: string, secrets: readonly never[]) => readonly string[];
type Scrub = (value: unknown) => unknown;

export function fixtureValues(file: string, text: string): readonly unknown[] {
  if (!file.endsWith(".jsonl")) return [JSON.parse(text)];
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as unknown);
}

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

function fixturesOf(root: string, files: readonly string[]) {
  return files.map((file) => ({ file, text: readText(root, file) }));
}

async function probeProblems(root: string): Promise<readonly string[]> {
  const claude = await loadModule(root, `${CLAUDE_PROBE}/src/sanitize.ts`);
  const codex = await loadModule(root, CODEX_SANITIZER);
  if (typeof claude.fixtureLeaks !== "function" || typeof claude.sanitizer !== "function")
    throw new Error(`${CLAUDE_PROBE}'s sanitize.ts no longer exports fixtureLeaks and sanitizer`);
  if (typeof codex.findLeaks !== "function")
    throw new Error(`${CODEX_SANITIZER} no longer exports findLeaks`);
  const scrub = (claude.sanitizer as (options: object) => Scrub)({ secrets: [], replacements: [] });
  return [
    ...fixtureProblems(fixturesOf(root, CLAUDE_FIXTURES), claude.fixtureLeaks as FindLeaks, scrub),
    ...fixtureProblems(fixturesOf(root, CODEX_FIXTURES), codex.findLeaks as FindLeaks, undefined),
  ];
}

export const probeFixturesGuard: RepositoryGuard = {
  holds:
    "the probes' committed fixtures hold nothing their own leak guards name, and are already sanitized: record them again through the probe",
  problems: probeProblems,
};
