#!/usr/bin/env node
// Publish pull-request media to the shared `pr-assets` branch and print the raw
// URLs that render inline in a pull-request description.
//
//   node scripts/publish-pr-media.mjs <pull-request-number> <file>...
//
// Requires GITHUB_TOKEN with `contents: write`; locally, `gh auth token`
// supplies one. Files are written through the contents API rather than a push
// so that a shallow checkout, a concurrent pull request, and an in-progress
// working tree cannot interfere with publishing.
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";
import { githubRequest, requiredEnvironment } from "./lib/github.mjs";

export const MEDIA_BRANCH = "pr-assets";

/**
 * The baseline every pull request's evidence is compared against. It is
 * republished on each push to the default branch, so it always describes what
 * the app looks like today.
 */
export const BASELINE_DIRECTORY = "baseline";

const CONFLICT_ATTEMPTS = 5;

/**
 * Pull-request media lives under `pr-<number>/<commit>/`. The commit component
 * is what keeps a refreshed screenshot visible: GitHub proxies and caches image
 * URLs, so reusing one path for successive versions of a screenshot serves the
 * stale image. A new path per commit is always fetched.
 */
export function pullRequestDirectory(pullRequest, commit) {
  return `pr-${pullRequest}/${commit.slice(0, 12)}`;
}

export function mediaPath(directory, file) {
  return `${directory}/${basename(file)}`;
}

export function rawUrl(repository, path) {
  return `https://raw.githubusercontent.com/${repository}/${MEDIA_BRANCH}/${path}`;
}

/**
 * The media branch carries no source history, so it starts as an empty orphan
 * commit rather than a copy of the default branch.
 */
async function ensureMediaBranch(repository) {
  const existing = await githubRequest(`/repos/${repository}/branches/${MEDIA_BRANCH}`, {
    allowStatuses: [404],
  });
  if (existing.ok) return;

  const tree = await githubRequest(`/repos/${repository}/git/trees`, {
    method: "POST",
    body: JSON.stringify({ tree: [] }),
  });
  const commit = await githubRequest(`/repos/${repository}/git/commits`, {
    method: "POST",
    body: JSON.stringify({
      message: "chore(pr-assets): start the durable pull-request media branch",
      tree: tree.data.sha,
      parents: [],
    }),
  });
  await githubRequest(`/repos/${repository}/git/refs`, {
    method: "POST",
    body: JSON.stringify({ ref: `refs/heads/${MEDIA_BRANCH}`, sha: commit.data.sha }),
  });
}

/** Reads a published file, or nothing when it has never been published. */
export async function readMedia(repository, path) {
  const response = await githubRequest(
    `/repos/${repository}/contents/${path}?ref=${MEDIA_BRANCH}`,
    { allowStatuses: [404] },
  );
  if (!response.ok) return undefined;
  return { sha: response.data.sha, contents: Buffer.from(response.data.content, "base64") };
}

async function putMediaFile(repository, path, contents) {
  // Concurrent pull requests publish to the same branch, so a 409 is an
  // expected outcome rather than a failure: the branch moved between reading
  // the file's state and writing it. Retrying re-reads that state.
  for (let attempt = 1; attempt <= CONFLICT_ATTEMPTS; attempt += 1) {
    const existing = await readMedia(repository, path);
    const result = await githubRequest(`/repos/${repository}/contents/${path}`, {
      method: "PUT",
      allowStatuses: [409, 422],
      body: JSON.stringify({
        branch: MEDIA_BRANCH,
        message: `chore(pr-assets): publish ${path}`,
        content: contents.toString("base64"),
        ...(existing ? { sha: existing.sha } : {}),
      }),
    });
    if (result.ok) return;
  }

  throw new Error(`Could not publish media after ${CONFLICT_ATTEMPTS} attempts: ${path}`);
}

/** Publishes each file into `directory` and returns its raw URL, in order. */
export async function publishMedia({ repository, directory, files }) {
  if (files.length === 0) return [];
  await ensureMediaBranch(repository);

  const published = [];
  for (const file of files) {
    const path = mediaPath(directory, file);
    await putMediaFile(repository, path, await readFile(file));
    published.push({ file, path, url: rawUrl(repository, path) });
  }
  return published;
}

async function main() {
  const [pullRequest, ...files] = process.argv.slice(2);
  if (!/^\d+$/.test(pullRequest ?? "") || files.length === 0) {
    process.stderr.write("usage: publish-pr-media.mjs <pull-request-number> <file>...\n");
    process.exit(2);
  }

  const commit = process.env.MEDIA_COMMIT?.trim() || requiredEnvironment("HEAD_SHA");
  const published = await publishMedia({
    repository: requiredEnvironment("GITHUB_REPOSITORY"),
    directory: pullRequestDirectory(Number(pullRequest), commit),
    files,
  });

  process.stdout.write(`${published.map((entry) => entry.url).join("\n")}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
