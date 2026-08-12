import { appendFile, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { githubRequest, requiredEnvironment } from "./lib/github.mjs";
import {
  BASELINE_DIRECTORY,
  mediaPath,
  publishMedia,
  pullRequestDirectory,
  readMedia,
} from "./publish-pr-media.mjs";

export const evidenceStart = "<!-- automated-visual-evidence:start -->";
export const evidenceEnd = "<!-- automated-visual-evidence:end -->";

/**
 * Read by the evidence gate, which cannot judge a screenshot by looking at it.
 * It carries the commit it describes so that a block left over from an earlier
 * push cannot vouch for the current one.
 */
export const changedMarker = "evidence-changed";

export function evidenceMarker(shown, headSha) {
  return `<!-- ${changedMarker}: ${shown} sha: ${headSha} -->`;
}

export const EVIDENCE_STATUS = {
  CHANGED: "changed",
  UNCHANGED: "unchanged",
  NEW: "new",
};

/**
 * Captions are fixed here so every pull request presents its evidence the same
 * way, and ordered so the description reads from the whole panel down.
 */
export const EVIDENCE_CAPTIONS = {
  "app-smoke-expanded.png": "Expanded panel (smoke fixture)",
  "app-smoke-settings.png": "Settings view (smoke fixture)",
  "app-smoke-compact.png": "Compact panel (smoke fixture)",
  "app-smoke-speaking.png": "Compact panel with the speaking waveform (smoke fixture)",
};

export function isCurrentPullHead(pull, headSha) {
  return pull.head?.sha === headSha;
}

export function caption(name) {
  return EVIDENCE_CAPTIONS[name] ?? name;
}

export function orderEvidenceFiles(names) {
  const captions = Object.keys(EVIDENCE_CAPTIONS);
  const rank = (name) => {
    const index = captions.indexOf(name);
    return index === -1 ? captions.length : index;
  };
  return [...names].sort((left, right) => rank(left) - rank(right) || left.localeCompare(right));
}

/**
 * Renders are deterministic, so equal bytes mean the change is not visible in
 * that scenario. That is the useful signal: a screenshot identical to the one
 * on the default branch is not evidence of anything this pull request did.
 */
export function compareEvidence(current, baseline) {
  if (baseline === undefined) return EVIDENCE_STATUS.NEW;
  return current.equals(baseline) ? EVIDENCE_STATUS.UNCHANGED : EVIDENCE_STATUS.CHANGED;
}

export function countShown(scenarios) {
  return scenarios.filter((scenario) => scenario.status !== EVIDENCE_STATUS.UNCHANGED).length;
}

export function buildEvidenceBlock(evidence) {
  const shown = evidence.scenarios.filter(
    (scenario) => scenario.status !== EVIDENCE_STATUS.UNCHANGED,
  );
  const unchanged = evidence.scenarios.filter(
    (scenario) => scenario.status === EVIDENCE_STATUS.UNCHANGED,
  );

  const sections = shown.flatMap((scenario) => {
    const heading = `#### ${caption(scenario.name)}`;
    if (scenario.status === EVIDENCE_STATUS.NEW) {
      return [heading, "", `![${caption(scenario.name)}](${scenario.afterUrl})`, ""];
    }
    return [
      heading,
      "",
      "| Before (`main`) | After |",
      "| --- | --- |",
      `| ![before](${scenario.beforeUrl}) | ![after](${scenario.afterUrl}) |`,
      "",
    ];
  });

  const body =
    evidence.scenarios.length === 0
      ? ["This run produced no screenshots. Check the workflow run before reviewing.", ""]
      : shown.length === 0
        ? [
            "Every scenario renders exactly as it does on `main`, so these screenshots do " +
              "not show this change. Attach one that does.",
            "",
          ]
        : sections;

  const unchangedNote =
    unchanged.length > 0 && shown.length > 0
      ? [`Unchanged since \`main\`: ${unchanged.map((s) => caption(s.name)).join(", ")}.`, ""]
      : [];

  return [
    evidenceStart,
    "### Automated visual evidence",
    "",
    evidenceMarker(countShown(evidence.scenarios), evidence.headSha),
    "",
    ...body,
    ...unchangedNote,
    `- Commit: \`${evidence.headSha}\``,
    "- Scenario: `smoke`",
    "- Physical-notch check: not performed by CI",
    `- [Download the originals](${evidence.artifactUrl}) · [workflow run](${evidence.runUrl})`,
    evidenceEnd,
  ].join("\n");
}

export function updateEvidenceBlock(body, evidence) {
  const block = buildEvidenceBlock(evidence);
  const start = body.indexOf(evidenceStart);
  const end = body.indexOf(evidenceEnd);
  if (start >= 0 && end >= start) {
    return `${body.slice(0, start)}${block}${body.slice(end + evidenceEnd.length)}`;
  }

  return `${body.trimEnd()}\n\n${block}\n`;
}

/**
 * Compares each screenshot with its baseline and publishes what a reviewer
 * needs to see: the current screenshot, plus the baseline beside it when the
 * two differ. An unchanged scenario needs neither.
 */
async function resolveScenarios({ repository, directory, names, pullRequest, headSha }) {
  const mediaDirectory = pullRequestDirectory(pullRequest, headSha);
  const scenarios = [];

  for (const name of names) {
    const file = join(directory, name);
    const current = await readFile(file);
    const baseline = await readMedia(repository, mediaPath(BASELINE_DIRECTORY, name));
    const status = compareEvidence(current, baseline?.contents);
    if (status === EVIDENCE_STATUS.UNCHANGED) {
      scenarios.push({ name, status });
      continue;
    }

    const [published] = await publishMedia({
      repository,
      directory: mediaDirectory,
      files: [file],
    });
    // The baseline is republished under this commit's directory rather than
    // linked at its own stable path, which GitHub's image cache would serve
    // stale once the default branch moves on.
    const before =
      status === EVIDENCE_STATUS.CHANGED
        ? await publishBaselineCopy(repository, mediaDirectory, name, baseline.contents)
        : undefined;
    scenarios.push({ name, status, afterUrl: published.url, beforeUrl: before });
  }

  return scenarios;
}

async function publishBaselineCopy(repository, directory, name, contents) {
  const scratch = await mkdtemp(join(tmpdir(), "luke-baseline-"));
  const copy = join(scratch, `before-${name}`);
  await writeFile(copy, contents);
  const [published] = await publishMedia({ repository, directory, files: [copy] });
  return published.url;
}

async function main() {
  const repository = requiredEnvironment("GITHUB_REPOSITORY");
  const pullRequest = Number(requiredEnvironment("PR_NUMBER"));
  if (!Number.isInteger(pullRequest) || pullRequest <= 0) {
    throw new Error("PR_NUMBER must be a positive integer");
  }

  const pull = await githubRequest(`/repos/${repository}/pulls/${pullRequest}`);
  const headSha = requiredEnvironment("HEAD_SHA");
  if (!isCurrentPullHead(pull.data, headSha)) {
    process.stdout.write(
      `Skipped visual evidence for stale commit ${headSha}; PR head is ${pull.data.head?.sha ?? "unknown"}\n`,
    );
    return;
  }

  const directory = requiredEnvironment("EVIDENCE_DIRECTORY");
  const entries = await readdir(directory).catch(() => []);
  const names = orderEvidenceFiles(entries.filter((entry) => entry.endsWith(".png")));
  const scenarios = await resolveScenarios({ repository, directory, names, pullRequest, headSha });

  const body = updateEvidenceBlock(pull.data.body ?? "", {
    scenarios,
    artifactUrl: requiredEnvironment("ARTIFACT_URL"),
    runUrl: requiredEnvironment("RUN_URL"),
    headSha,
  });

  await githubRequest(`/repos/${repository}/pulls/${pullRequest}`, {
    method: "PATCH",
    body: JSON.stringify({ body }),
  });
  // The count is reported as a job output, not read back from the description.
  // A pull-request body is author-editable in full — including the markers that
  // delimit this block — so it can carry the verdict for a human to read but
  // can never be the thing the gate trusts.
  const shown = countShown(scenarios);
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `scenarios-shown=${shown}\n`);
  }
  process.stdout.write(
    `Embedded evidence on PR #${pullRequest}: ${shown} of ${scenarios.length} scenarios differ from main\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
