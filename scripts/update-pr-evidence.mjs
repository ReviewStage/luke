import { pathToFileURL } from "node:url";

export const evidenceStart = "<!-- automated-visual-evidence:start -->";
export const evidenceEnd = "<!-- automated-visual-evidence:end -->";

export function isCurrentPullHead(pull, headSha) {
  return pull.head?.sha === headSha;
}

export function updateEvidenceBlock(body, evidence) {
  const block = [
    evidenceStart,
    "### Automated visual evidence",
    "",
    `[Download the deterministic macOS evidence](${evidence.artifactUrl}) · [workflow run](${evidence.runUrl})`,
    "",
    `- Commit: \`${evidence.headSha}\``,
    "- Scenario: `smoke`",
    "- Physical-notch check: not performed by CI",
    evidenceEnd,
  ].join("\n");

  const start = body.indexOf(evidenceStart);
  const end = body.indexOf(evidenceEnd);
  if (start >= 0 && end >= start) {
    return `${body.slice(0, start)}${block}${body.slice(end + evidenceEnd.length)}`;
  }

  return `${body.trimEnd()}\n\n${block}\n`;
}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

async function githubRequest(path, init = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${requiredEnvironment("GITHUB_TOKEN")}`,
      "Content-Type": "application/json",
      "User-Agent": "luke-visual-evidence",
      "X-GitHub-Api-Version": "2022-11-28",
      ...init.headers,
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub API ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

async function main() {
  const repository = requiredEnvironment("GITHUB_REPOSITORY");
  const pullRequest = Number(requiredEnvironment("PR_NUMBER"));
  if (!Number.isInteger(pullRequest) || pullRequest <= 0) {
    throw new Error("PR_NUMBER must be a positive integer");
  }

  const pull = await githubRequest(`/repos/${repository}/pulls/${pullRequest}`);
  const headSha = requiredEnvironment("HEAD_SHA");
  if (!isCurrentPullHead(pull, headSha)) {
    process.stdout.write(
      `Skipped visual evidence for stale commit ${headSha}; PR head is ${pull.head?.sha ?? "unknown"}\n`,
    );
    return;
  }
  const body = updateEvidenceBlock(pull.body ?? "", {
    artifactUrl: requiredEnvironment("ARTIFACT_URL"),
    runUrl: requiredEnvironment("RUN_URL"),
    headSha,
  });

  await githubRequest(`/repos/${repository}/pulls/${pullRequest}`, {
    method: "PATCH",
    body: JSON.stringify({ body }),
  });
  process.stdout.write(`Updated visual evidence on PR #${pullRequest}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
