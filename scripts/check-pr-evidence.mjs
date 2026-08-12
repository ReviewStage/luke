#!/usr/bin/env node
// Fails a pull request whose user-interface change carries no visual evidence.
//
// The rule this enforces is in WORKFLOW.md. It runs after the macOS job has
// embedded its screenshots, so a desktop change satisfies it automatically once
// that job succeeds; what it catches is a surface CI cannot screenshot, or a
// desktop change whose evidence never got produced.
import { pathToFileURL } from "node:url";
import { githubRequest, requiredEnvironment } from "./lib/github.mjs";
import { changedMarker, evidenceEnd, evidenceStart } from "./update-pr-evidence.mjs";

export const EXEMPTION_LABEL = "evidence-exempt";

/**
 * Paths whose change is visible to a user. Desktop surfaces are screenshotted
 * by CI; web surfaces have no automated capture, so their evidence is attached
 * by whoever opens the pull request.
 */
export const UI_PATHS = {
  DESKTOP: ["apps/desktop/src/renderer/", "apps/desktop/native/macos/"],
  WEB: ["apps/web/"],
};

const IMAGE_PATTERN = /!\[[^\]]*\]\([^)]+\)|<img\b/;

export function classifyChanges(filenames) {
  const touches = (prefixes) =>
    filenames.some((filename) => prefixes.some((prefix) => filename.startsWith(prefix)));
  return { desktop: touches(UI_PATHS.DESKTOP), web: touches(UI_PATHS.WEB) };
}

/**
 * How many captured scenarios CI reported as differing from the default branch,
 * or undefined when CI has not reported yet. Only CI writes this marker, and the
 * pull-request template ships without one, so its absence is a reliable "not
 * evaluated" rather than "nothing differs". The distinction matters: this check
 * also runs on a description edit, which can happen seconds after a pull request
 * is opened and long before the macOS job has produced anything.
 */
export function scenariosShown(body) {
  const marker = new RegExp(`<!--\\s*${changedMarker}:\\s*(\\d+)\\s*-->`).exec(body);
  return marker ? Number(marker[1]) : undefined;
}

/** Separates CI's block from the description an author controls. */
export function splitEvidence(body) {
  const start = body.indexOf(evidenceStart);
  const end = body.indexOf(evidenceEnd);
  if (start < 0 || end < start) return { automated: "", authored: body };
  return {
    automated: body.slice(start, end + evidenceEnd.length),
    authored: body.slice(0, start) + body.slice(end + evidenceEnd.length),
  };
}

export function evaluateEvidence({ body = "", labels = [], filenames = [] }) {
  const changed = classifyChanges(filenames);
  if (!changed.desktop && !changed.web) {
    return { required: false, failures: [], summary: "No user-interface paths changed." };
  }
  if (labels.includes(EXEMPTION_LABEL)) {
    return { required: true, failures: [], summary: `Exempted by the ${EXEMPTION_LABEL} label.` };
  }

  const { authored } = splitEvidence(body);
  const shown = scenariosShown(body);
  const failures = [];
  const notes = [];
  // A screenshot identical to the one on `main` shows nothing this pull request
  // did, so the presence of an image is not the test. CI reports how many
  // scenarios actually differ; a desktop change passes when at least one does,
  // or when the author attached evidence of their own. A web change always
  // needs authored evidence: CI screenshots only the desktop app, and a pull
  // request touching both surfaces would otherwise pass on desktop evidence
  // alone while the page went uninspected.
  if (changed.desktop && !IMAGE_PATTERN.test(authored)) {
    if (shown === undefined) {
      notes.push(
        "The macOS job has not published evidence for this commit yet; the check that runs " +
          "after it is the one that decides.",
      );
    } else if (shown === 0) {
      failures.push(
        "This pull request changes the desktop interface, but no captured scenario differs " +
          "from `main`, so CI's screenshots do not show the change. Add a scenario to " +
          "`./scripts/evidence.sh` that renders the affected surface, or capture it yourself " +
          "and publish it with `node scripts/publish-pr-media.mjs <pr> <file>`.",
      );
    }
  }
  if (changed.web && !IMAGE_PATTERN.test(authored)) {
    failures.push(
      "This pull request changes the web interface, which CI does not screenshot. Capture " +
        "the page after `pnpm --filter @luke/web dev`, publish it with " +
        "`node scripts/publish-pr-media.mjs <pr> <file>`, and embed the URL in the " +
        "Evidence section.",
    );
  }

  const summary =
    failures.length > 0
      ? "Visual evidence is missing."
      : notes.length > 0
        ? notes.join(" ")
        : "Visual evidence is attached.";
  return { required: true, failures, notes, summary };
}

async function changedFilenames(repository, pullRequest) {
  const filenames = [];
  for (let page = 1; page <= 10; page += 1) {
    const response = await githubRequest(
      `/repos/${repository}/pulls/${pullRequest}/files?per_page=100&page=${page}`,
    );
    filenames.push(...response.data.map((file) => file.filename));
    if (response.data.length < 100) break;
  }
  return filenames;
}

async function main() {
  const repository = requiredEnvironment("GITHUB_REPOSITORY");
  const pullRequest = Number(requiredEnvironment("PR_NUMBER"));
  const pull = await githubRequest(`/repos/${repository}/pulls/${pullRequest}`);

  const result = evaluateEvidence({
    body: pull.data.body ?? "",
    labels: (pull.data.labels ?? []).map((label) => label.name),
    filenames: await changedFilenames(repository, pullRequest),
  });

  process.stdout.write(`${result.summary}\n`);
  if (result.failures.length === 0) return;

  for (const failure of result.failures) process.stderr.write(`error: ${failure}\n`);
  process.stderr.write(
    `\nAdd the missing evidence to the pull-request description, or apply the ` +
      `${EXEMPTION_LABEL} label with a comment saying why none applies. ` +
      `Editing the description re-runs this check.\n`,
  );
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
