const apiRoot = "https://api.github.com";

export function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export class GitHubError extends Error {
  constructor(status, path, body) {
    super(`GitHub API ${status} for ${path}: ${body}`);
    this.status = status;
    this.path = path;
  }
}

/**
 * Issues an authenticated GitHub REST request. `allowStatuses` returns the
 * response for statuses the caller handles itself, such as the 404 that means a
 * branch does not exist yet.
 */
export async function githubRequest(path, { allowStatuses = [], ...init } = {}) {
  const response = await fetch(`${apiRoot}${path}`, {
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
    if (allowStatuses.includes(response.status)) return { ok: false, status: response.status };
    throw new GitHubError(response.status, path, await response.text());
  }

  return { ok: true, status: response.status, data: await response.json() };
}
