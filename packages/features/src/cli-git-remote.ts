/**
 * cli-git-remote.ts -- the GitHub repository a git remote's address names, as `owner/name`, in each form `git remote get-url` prints one.
 *
 * The `vespin` command reads the working folder's `origin` to name the
 * repository a task is about, and to check that an agent's branch is checked
 * out into the repository it was pushed to. A remote is spelled as scp-like
 * ssh (`git@github.com:owner/name.git`), as an ssh, https, http, or git
 * address (`ssh://git@github.com/owner/name`), with a user or a port or
 * neither, and with or without `.git` and a closing slash. A remote on any
 * host but GitHub's names no repository here, since a task's repository is
 * one on GitHub.
 */

import { GITHUB_REPOSITORY_PATTERN } from "./link-grammar.js";

/** The hosts a remote on GitHub is spelled with. */
const GITHUB_HOSTS: ReadonlySet<string> = new Set(["github.com", "www.github.com"]);

/** An scp-like ssh remote: an optional user, the host, a colon, and the path, with no scheme. */
const SCP_REMOTE = /^(?:[^@/:]+@)?([^/:]+):(.+)$/u;

/** What separates a path's segments, trimmed from both of its ends. */
const PATH_SEPARATOR = "/";

/** The schemes a remote address may name. */
const REMOTE_SCHEMES: ReadonlySet<string> = new Set(["ssh:", "https:", "http:", "git:"]);

/** A path's `owner/name`, its `.git` and any separators around it dropped, where it is GitHub's shape. */
function repositoryOfPath(path: string): string | undefined {
  // Note that the separators are trimmed by walking in from each end rather than by a pattern, since a pattern anchored at the end backtracks over a long run of them.
  let start = 0;
  let end = path.length;
  while (start < end && path[start] === PATH_SEPARATOR) start += 1;
  while (end > start && path[end - 1] === PATH_SEPARATOR) end -= 1;
  const named = path.slice(start, end).replace(/\.git$/u, "");
  return GITHUB_REPOSITORY_PATTERN.test(named) ? named : undefined;
}

/** The `owner/name` a git remote's address names on GitHub, or none where it names no repository there. */
export function githubRepositoryOfRemote(remote: string): string | undefined {
  const trimmed = remote.trim();
  // Note that an scp-like remote with no user, `github.com:owner/name`, parses as an address whose scheme is its host, so only a remote's own schemes are read as one.
  const address = URL.canParse(trimmed) ? new URL(trimmed) : undefined;
  if (address !== undefined && REMOTE_SCHEMES.has(address.protocol)) {
    return GITHUB_HOSTS.has(address.hostname.toLowerCase())
      ? repositoryOfPath(address.pathname)
      : undefined;
  }
  const scp = SCP_REMOTE.exec(trimmed);
  if (scp === null) return undefined;
  const [, host = "", path = ""] = scp;
  return GITHUB_HOSTS.has(host.toLowerCase()) ? repositoryOfPath(path) : undefined;
}
