#!/usr/bin/env node
// Fails a pull request whose user-interface change carries no visual evidence.
//
// The rule this enforces is in WORKFLOW.md. It runs after the macOS job has
// embedded its screenshots, so a desktop change satisfies it automatically once
// that job succeeds; what it catches is a surface CI cannot screenshot, or a
// desktop change whose evidence never got produced.
import { pathToFileURL } from "node:url";
import { githubRequest, requiredEnvironment } from "./lib/github.mjs";
import { evidenceEnd, evidenceStart } from "./update-pr-evidence.mjs";

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
 * Markdown that a reader will actually see. An image inside an HTML comment or a
 * fenced code block renders as nothing, so counting it as evidence would let a
 * description satisfy the gate while showing the reviewer no picture at all.
 *
 * Stripping repeats until the text stops changing: one pass over nested comment
 * openers can leave a `<!--` behind and reveal what it was hiding.
 */
export function visibleText(markdown) {
  let text = markdown;
  for (let pass = 0; pass < 10; pass += 1) {
    const stripped = text.replace(/<!--[\s\S]*?-->/g, "").replace(/```[\s\S]*?```|`[^`\n]*`/g, "");
    if (stripped === text) return stripped;
    text = stripped;
  }
  return text.replace(/<!--|-->|```/g, "");
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

/**
 * `shown` is the number of scenarios CI found to differ from the default
 * branch, passed from the macOS job's own output. It is never read back from the
 * description: a pull-request body is author-editable in full, including the
 * markers that delimit CI's block, so any verdict recovered from it can be
 * forged by pasting a convincing-looking block ahead of the real one. Undefined
 * means no macOS job reported into this run.
 */
export function evaluateEvidence({
  body = "",
  labels = [],
  filenames = [],
  shown,
  evidenceRunSucceeded = true,
}) {
  const changed = classifyChanges(filenames);
  if (!changed.desktop && !changed.web) {
    return { required: false, failures: [], summary: "No user-interface paths changed." };
  }
  if (labels.includes(EXEMPTION_LABEL)) {
    return { required: true, failures: [], summary: `Exempted by the ${EXEMPTION_LABEL} label.` };
  }

  const { authored } = splitEvidence(body);
  const authoredImage = IMAGE_PATTERN.test(visibleText(authored));
  const failures = [];
  const notes = [];
  // A screenshot identical to the one on `main` shows nothing this pull request
  // did, so the presence of an image is not the test. CI reports how many
  // scenarios actually differ; a desktop change passes when at least one does,
  // or when the author attached evidence of their own. A web change always
  // needs authored evidence: CI screenshots only the desktop app, and a pull
  // request touching both surfaces would otherwise pass on desktop evidence
  // alone while the page went uninspected.
  if (changed.desktop && !authoredImage) {
    if (!evidenceRunSucceeded) {
      // No screenshots exist for this commit, so there is nothing to wait for.
      failures.push(
        "The macOS job did not produce evidence for this commit, so this desktop change has " +
          "no screenshots. Fix that job rather than merging an unevidenced change.",
      );
    } else if (shown === undefined) {
      notes.push(
        "This run has no macOS evidence to judge; the check in the run that built this " +
          "commit is the one that decides.",
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
  if (changed.web && !authoredImage) {
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

  // `success` when the macOS job produced evidence for this commit, `skipped`
  // when this run is a description recheck and that job belongs to another run.
  const evidenceRun = process.env.EVIDENCE_RUN_RESULT?.trim() || "success";
  const result = evaluateEvidence({
    body: pull.data.body ?? "",
    labels: (pull.data.labels ?? []).map((label) => label.name),
    filenames: await changedFilenames(repository, pullRequest),
    shown: /^\d+$/.test(process.env.EVIDENCE_SCENARIOS_SHOWN ?? "")
      ? Number(process.env.EVIDENCE_SCENARIOS_SHOWN)
      : undefined,
    evidenceRunSucceeded: evidenceRun === "success" || evidenceRun === "skipped",
  });

  process.stdout.write(`${result.summary}\n`);
  if (result.failures.length === 0) return;

  for (const failure of result.failures) process.stderr.write(`error: ${failure}\n`);
  process.stderr.write(
    `\nAdd the missing evidence to the pull-request description, or apply the ` +
      `${EXEMPTION_LABEL} label with a comment saying why none applies. ` +
      `Editing the description re-runs the recheck.\n`,
  );
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
