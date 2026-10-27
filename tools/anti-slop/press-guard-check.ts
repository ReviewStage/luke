import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TYPESCRIPT_SOURCE } from "./shared/effect-edges.ts";
import { LUCIDE_GUARD_RULE } from "./shared/lucide-guard.ts";
import {
  configWeakensGuard,
  guardSuppressionLines,
  ignoredFiles,
  isOutsideUi,
  JSX_SOURCE,
  PRESS_GUARD_RULE,
} from "./shared/press-guard.ts";
import { SKELETON_GUARD_RULE } from "./shared/skeleton-guard.ts";

/**
 * The design system's guards have no escape hatch: oxlint honors every
 * inline disable and has no flag to refuse one, so `pnpm lint` runs this
 * after it. It fails on a JSX-capable file outside `@luke/ui` holding a
 * directive that would silence `no-raw-press-outside-ui`, on any JSX-capable
 * file holding one that would silence `skeleton-through-components`, on any
 * TypeScript file holding one that would silence `no-lucide-outside-door`,
 * whose baseline is the only way past it, and on an `.oxlintrc.json` that
 * leaves any of them short of an error anywhere or whose `ignorePatterns`
 * hide a file one of them watches.
 */
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Tracked files and new ones git does not ignore, so a local run sees a file not yet added. */
function sourceFiles(): readonly string[] {
  const listed = spawnSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    {
      cwd: REPOSITORY_ROOT,
      encoding: "utf8",
    },
  );
  if (listed.status !== 0) throw new Error(`git ls-files failed:\n${listed.stderr}`);
  return listed.stdout.split("\0").filter((file) => file.length > 0);
}

/** Each guard, the files it watches, and what to do instead of silencing it. */
const GUARDS = [
  {
    rule: PRESS_GUARD_RULE,
    sources: JSX_SOURCE,
    watches: (absolute: string) => isOutsideUi(absolute),
    remedy: "Move the press onto a @luke/ui component or variant instead",
  },
  {
    rule: SKELETON_GUARD_RULE,
    sources: JSX_SOURCE,
    watches: () => true,
    remedy:
      "Draw the skeleton in a `*Skeleton` component, through the components the loaded state draws with",
  },
  {
    rule: LUCIDE_GUARD_RULE,
    sources: TYPESCRIPT_SOURCE,
    // The guards' own tests spell bare directives as fixtures, and oxlint ignores that tree anyway.
    // A file that never names the library has nothing to silence, so an ignored tree of vendored code is no gap.
    watches: (absolute: string) =>
      !path.relative(REPOSITORY_ROOT, absolute).startsWith("tools/anti-slop/") &&
      existsSync(absolute) &&
      readFileSync(absolute, "utf8").includes("lucide-react"),
    remedy: "Import the icon from @luke/ui/icons instead",
  },
] as const;

const config: unknown = JSON.parse(
  readFileSync(path.join(REPOSITORY_ROOT, ".oxlintrc.json"), "utf8"),
);
const files = sourceFiles();
for (const guard of GUARDS) {
  const problems: string[] = [];
  const weakened = configWeakensGuard(config, guard.rule);
  if (weakened !== undefined) problems.push(`.oxlintrc.json: ${weakened}`);
  const watched = files.filter(
    (file) => guard.sources.test(file) && guard.watches(path.join(REPOSITORY_ROOT, file)),
  );
  for (const [pattern, hidden] of ignoredFiles(config, watched)) {
    problems.push(
      `.oxlintrc.json: ignorePatterns entry "${pattern}" hides files it watches, ${hidden[0]} among them`,
    );
  }
  for (const file of files) {
    if (!guard.sources.test(file)) continue;
    const absolute = path.join(REPOSITORY_ROOT, file);
    if (!guard.watches(absolute) || !existsSync(absolute)) continue;
    for (const line of guardSuppressionLines(readFileSync(absolute, "utf8"), guard.rule)) {
      problems.push(`${file}:${line}: a disable directive silences ${guard.rule}`);
    }
  }
  if (problems.length === 0) continue;
  process.stderr.write(
    `error: ${guard.rule} takes no suppression. ${guard.remedy}:\n${problems.map((problem) => `  ${problem}`).join("\n")}\n`,
  );
  process.exitCode = 1;
}
