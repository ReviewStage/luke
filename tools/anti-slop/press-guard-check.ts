import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BUSY_GUARD_RULE } from "./shared/busy-guard.ts";
import { TYPESCRIPT_SOURCE } from "./shared/effect-edges.ts";
import { HEADING_GUARD_RULE } from "./shared/heading-guard.ts";
import { KEPT_GUARD_RULE } from "./shared/kept-guard.ts";
import { LIVE_REGION_GUARD_RULE } from "./shared/live-region-guard.ts";
import { LUCIDE_GUARD_RULE } from "./shared/lucide-guard.ts";
import { OPEN_PAGE_GUARD_RULE } from "./shared/open-page-guard.ts";
import {
  configWeakensGuard,
  guardSuppressionLines,
  ignoredFiles,
  isOutsideUi,
  JSX_SOURCE,
  PRESS_GUARD_RULE,
} from "./shared/press-guard.ts";
import { PRESS_LISTENER_GUARD_RULE } from "./shared/press-listener-guard.ts";
import { namesRetired, RETIRED_GUARD_RULE } from "./shared/retired.ts";
import { SKELETON_GUARD_RULE } from "./shared/skeleton-guard.ts";

/**
 * The design system's guards have no escape hatch: oxlint honors every
 * inline disable and has no flag to refuse one, so `pnpm lint` runs this
 * after it. It fails on a JSX-capable file outside `@luke/ui` holding a
 * directive that would silence `no-raw-press-outside-ui`, on any JSX-capable
 * file holding one that would silence `skeleton-through-components` or
 * `async-press-needs-busy`, whose baseline is the only way past it, on a
 * JSX-capable file outside `@luke/ui` holding one that would silence
 * `no-open-page-from-button`, `no-raw-heading-outside-ui` or
 * `no-hand-written-live-region`, on any TypeScript file holding one that would
 * silence `no-lucide-outside-door` or, where it adds a listener,
 * `no-document-press-listener` or, where it names the window's storage or
 * its helpers, `no-direct-view-storage`, whose baselines are the only way past
 * them, on any TypeScript file that spells
 * a retired name and holds one that would silence `retired`, whose retired
 * file's baseline is the only way past it, and on an `.oxlintrc.json` that
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

/** A press listener on the whole window, as far as the text says: the only file that has anything to silence. */
const PRESS_LISTENER =
  /(?:document|window|globalThis|ownerDocument|defaultView)\s*\.\s*addEventListener\(\s*["'`](?:pointerdown|mousedown|touchstart|click|auxclick)/u;

/** A file that touches the window's storage or imports the helpers over it, as far as the text says: the only file that has anything to silence. */
const KEPT_STORAGE = /\b(?:localStorage|sessionStorage)\b|kept-storage/u;

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
    rule: BUSY_GUARD_RULE,
    sources: JSX_SOURCE,
    watches: () => true,
    remedy:
      "Pass `busy` and `busyLabel` to the button (`useBusyPress` holds them), so a press that waits shows it is working",
  },
  {
    rule: OPEN_PAGE_GUARD_RULE,
    sources: JSX_SOURCE,
    watches: (absolute: string) => isOutsideUi(absolute),
    remedy:
      "Draw a link instead (ButtonLink, TextLink, or Chip's href), so a page opens from a link",
  },
  {
    rule: HEADING_GUARD_RULE,
    sources: JSX_SOURCE,
    watches: (absolute: string) => isOutsideUi(absolute),
    remedy:
      "Draw the heading with Text from @luke/ui (`as` for the element, a type role for the look) instead",
  },
  {
    rule: LIVE_REGION_GUARD_RULE,
    sources: JSX_SOURCE,
    watches: (absolute: string) => isOutsideUi(absolute),
    remedy:
      "Say it with `announce` from @luke/ui, or draw the words in FailureNote, ErrorState, EmptyState or NoteLine, instead",
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
  {
    rule: PRESS_LISTENER_GUARD_RULE,
    sources: TYPESCRIPT_SOURCE,
    // A file that never adds a listener has nothing to silence; the guards' own tests spell fixtures.
    watches: (absolute: string) =>
      !path.relative(REPOSITORY_ROOT, absolute).startsWith("tools/anti-slop/") &&
      existsSync(absolute) &&
      PRESS_LISTENER.test(readFileSync(absolute, "utf8")),
    remedy:
      "Close the popover through `onPressAway` on its AnchoredPopover or RectFloat, or `usePressAway`, instead",
  },
  {
    rule: KEPT_GUARD_RULE,
    sources: TYPESCRIPT_SOURCE,
    // A file that names no storage has nothing to silence; the guards' own tests spell fixtures.
    watches: (absolute: string) =>
      !path.relative(REPOSITORY_ROOT, absolute).startsWith("tools/anti-slop/") &&
      existsSync(absolute) &&
      KEPT_STORAGE.test(readFileSync(absolute, "utf8")),
    remedy:
      "Keep the choice through `useKept` (`packages/panel/src/use-kept.ts`) instead, or name storage that is no view choice in tools/anti-slop/kept-storage-allowed.json with its reason",
  },
  {
    rule: RETIRED_GUARD_RULE,
    sources: TYPESCRIPT_SOURCE,
    // As for Lucide: a file that never spells a retired name has nothing to silence.
    watches: (absolute: string) =>
      !path.relative(REPOSITORY_ROOT, absolute).startsWith("tools/anti-slop/") &&
      existsSync(absolute) &&
      namesRetired(readFileSync(absolute, "utf8")),
    remedy: "Use what the retired file under tools/anti-slop/retired/ names instead",
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
