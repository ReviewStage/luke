import { join } from "node:path";
import { exit } from "node:process";
import {
  CALLER_KIND,
  type CallerReport,
  checkApiCallers,
  RESOLUTION,
} from "../server/api-callers.js";
import { API_REWRITES_FILE } from "../server/function-rewrites.js";

const WEB = join(import.meta.dirname, "..");
const REPO_ROOT = join(WEB, "..", "..");

function count<T>(items: readonly T[], matches: (item: T) => boolean): number {
  return items.filter(matches).length;
}

function summary(report: CallerReport): string {
  const callers = report.resolved.map((entry) => entry.caller);
  const sites = callers.reduce((total, caller) => total + caller.sites.length, 0);
  return [
    `api callers: ${report.filesScanned} files scanned`,
    `${sites} sites`,
    `${count(callers, (caller) => caller.kind === CALLER_KIND.STATIC)} static paths`,
    `${count(callers, (caller) => caller.kind === CALLER_KIND.BUILDER)} built paths (${report.builderExports} builder exports evaluated)`,
    `${count(report.resolved, (entry) => entry.resolution === RESOLUTION.REWRITE)} on rewrites`,
    `${count(report.resolved, (entry) => entry.resolution === RESOLUTION.PROCEDURE)} on procedures`,
    `${count(report.resolved, (entry) => entry.resolution === RESOLUTION.ALIAS)} on aliases`,
    `${count(report.resolved, (entry) => entry.resolution === RESOLUTION.PREFIX)} as prefixes`,
  ].join(", ");
}

const report = await checkApiCallers({ repoRoot: REPO_ROOT, web: WEB });
// biome-ignore lint/suspicious/noConsole: a check that found nothing must say what it counted, or its silence reads as coverage.
console.log(summary(report));

if (report.refused.length > 0) {
  console.error(
    `error: ${report.refused.length} /api/ path(s) clients build resolve to no route in ${API_REWRITES_FILE}, the Build Output aliases, or the hosted procedures:`,
  );
  for (const refusal of report.refused) {
    console.error(`  ${refusal.display}  (${refusal.reason})`);
    for (const site of refusal.sites) console.error(`    ${site.file}:${site.line}`);
  }
  exit(1);
}
