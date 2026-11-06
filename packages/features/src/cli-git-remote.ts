import { GITHUB_REPOSITORY_PATTERN } from "./link-grammar.js";

const GITHUB_HOSTS: ReadonlySet<string> = new Set(["github.com", "www.github.com"]);

const SCP_REMOTE = /^(?:[^@/:]+@)?([^/:]+):(.+)$/u;

const PATH_SEPARATOR = "/";

const REMOTE_SCHEMES: ReadonlySet<string> = new Set(["ssh:", "https:", "http:", "git:"]);

function repositoryOfPath(path: string): string | undefined {
  let start = 0;
  let end = path.length;
  while (start < end && path[start] === PATH_SEPARATOR) start += 1;
  while (end > start && path[end - 1] === PATH_SEPARATOR) end -= 1;
  const named = path.slice(start, end).replace(/\.git$/u, "");
  return GITHUB_REPOSITORY_PATTERN.test(named) ? named : undefined;
}

export function githubRepositoryOfRemote(remote: string): string | undefined {
  const trimmed = remote.trim();
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
