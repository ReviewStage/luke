import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { type Baseline, baselineProblems, shrunkBaseline } from "./shared/baseline.ts";
import {
  RETIRED,
  RETIRED_KIND,
  type RetiredPlace,
  type Retirement,
  retiredCssPlaces,
} from "./shared/retired.ts";
import {
  isWatched,
  STYLE_RULE_IDS,
  STYLE_RULES,
  type StyleRule,
  type StyleViolation,
  styleSuppressionLines,
  styleViolations,
  themeNames,
} from "./shared/style-guard.ts";

/**
 * The style guard, run by `pnpm lint`: reads every stylesheet and every
 * Tailwind class string outside `@luke/ui`'s token sheets and fails on a
 * place a rule refuses beyond its baseline, on a baseline above what a file
 * still holds, and on a comment asking to silence it. `--shrink` lowers
 * each baseline to what the files now hold, and never raises one. It also
 * holds `anti-slop/retired`'s classes in every stylesheet's selectors, which
 * oxlint cannot read, against the CSS rows of each retired file's baseline.
 */
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const BASELINES = path.join(REPOSITORY_ROOT, "tools", "anti-slop", "style-baselines");
const THEME_SHEET = path.join(REPOSITORY_ROOT, "packages", "ui", "src", "tailwind", "theme.css");
const SHRINK_FLAG = "--shrink";

/** Tracked files and new ones git does not ignore, so a local run sees a file not yet added. */
function sourceFiles(): readonly string[] {
  const listed = spawnSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { cwd: REPOSITORY_ROOT, encoding: "utf8" },
  );
  if (listed.status !== 0) throw new Error(`git ls-files failed:\n${listed.stderr}`);
  return listed.stdout.split("\0").filter((file) => file.length > 0);
}

function baselinePath(rule: StyleRule): string {
  return path.join(BASELINES, `${rule}.json`);
}

function readBaseline(rule: StyleRule): Baseline {
  const file = baselinePath(rule);
  if (!existsSync(file)) return {};
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${path.relative(REPOSITORY_ROOT, file)} is not an object of counts`);
  }
  return Object.fromEntries(Object.entries(parsed).map(([key, count]) => [key, Number(count)]));
}

function writeBaseline(rule: StyleRule, baseline: Baseline): void {
  writeFileSync(baselinePath(rule), `${JSON.stringify(baseline, null, 2)}\n`);
}

const names = themeNames(readFileSync(THEME_SHEET, "utf8"));
const found = new Map<StyleRule, Map<string, StyleViolation[]>>(
  STYLE_RULE_IDS.map((rule) => [rule, new Map()]),
);
const suppressions: string[] = [];
const retired = new Map<Retirement, Map<string, RetiredPlace[]>>();
for (const file of sourceFiles()) {
  const absolute = path.join(REPOSITORY_ROOT, file);
  if (!existsSync(absolute)) continue;
  if (file.endsWith(".css")) {
    for (const place of retiredCssPlaces(file, readFileSync(absolute, "utf8"))) {
      const byFile = retired.get(place.retirement) ?? new Map<string, RetiredPlace[]>();
      byFile.set(file, [...(byFile.get(file) ?? []), place]);
      retired.set(place.retirement, byFile);
    }
  }
  if (!isWatched(file)) continue;
  const text = readFileSync(absolute, "utf8");
  if (file.endsWith(".css")) {
    for (const line of styleSuppressionLines(text)) suppressions.push(`${file}:${line}`);
  }
  for (const violation of styleViolations(file, text, names)) {
    const byFile = found.get(violation.rule);
    byFile?.set(file, [...(byFile.get(file) ?? []), violation]);
  }
}

if (process.argv.includes(SHRINK_FLAG)) {
  for (const rule of STYLE_RULE_IDS) {
    const counts = new Map([...(found.get(rule) ?? [])].map(([file, list]) => [file, list.length]));
    writeBaseline(rule, shrunkBaseline(counts, readBaseline(rule)));
  }
}

const strays = readdirSync(BASELINES).filter(
  (name) => !STYLE_RULE_IDS.some((rule) => name === `${rule}.json`),
);
if (strays.length > 0) {
  process.stderr.write(
    `error: style-baselines/ holds only one baseline per rule; no rule is named ${strays.join(", ")}\n`,
  );
  process.exitCode = 1;
}
if (suppressions.length > 0) {
  process.stderr.write(
    `error: the style guard takes no suppression; fix the place, or shrink its baseline:\n${suppressions.map((place) => `  ${place}`).join("\n")}\n`,
  );
  process.exitCode = 1;
}
for (const rule of STYLE_RULE_IDS) {
  const byFile = found.get(rule) ?? new Map<string, StyleViolation[]>();
  const counts = new Map([...byFile].map(([file, list]) => [file, list.length]));
  const problems = baselineProblems(counts, readBaseline(rule), STYLE_RULES[rule].backlog);
  if (problems.length === 0) continue;
  const places = problems.flatMap(({ file, says, grew }) => [
    `  ${file}: ${says}`,
    ...(grew ? (byFile.get(file) ?? []) : []).map(
      (violation) => `    ${file}:${violation.line}: ${violation.excerpt}`,
    ),
  ]);
  process.stderr.write(
    `error: style-guard/${rule} refuses ${STYLE_RULES[rule].refuses}. How to fix one: packages/ui/README.md's "The style guard".\n${places.join("\n")}\n`,
  );
  process.exitCode = 1;
}
for (const retirement of RETIRED) {
  if (retirement.kind !== RETIRED_KIND.CLASS) continue;
  const byFile = retired.get(retirement) ?? new Map<string, RetiredPlace[]>();
  const counts = new Map([...byFile].map(([file, list]) => [file, list.length]));
  const sheets = Object.entries(retirement.baseline).filter(([file]) => file.endsWith(".css"));
  const problems = baselineProblems(counts, Object.fromEntries(sheets), true);
  if (problems.length === 0) continue;
  const places = problems.flatMap(({ file, says, grew }) => [
    `  ${file}: ${says}`,
    ...(grew ? (byFile.get(file) ?? []) : []).map(
      (place) => `    ${file}:${place.line}: ${place.excerpt}`,
    ),
  ]);
  process.stderr.write(
    `error: anti-slop/retired refuses the class \`${retirement.name}\` (tools/anti-slop/retired/${retirement.file}): ${retirement.instead}\n${places.join("\n")}\n`,
  );
  process.exitCode = 1;
}
