/**
 * github-fake.ts -- GitHub as a test answers it: the REST metadata reads and the hosted MCP repository toolset, behind one `fetch`.
 *
 * The fake stands where production's network does: `FetchHttpClient.Fetch`,
 * the `fetch` both Effect's `HttpClient` and the MCP client's transport
 * send through, so the service's own MCP client speaks JSON-RPC to it
 * exactly as it would to `api.githubcopilot.com`, and its REST reads reach
 * the same route table. Each token names the repositories it can read, and
 * a revoked token is refused at the door the way GitHub refuses it: 401 on
 * REST and on the MCP endpoint alike. `get_file_contents` answers in the
 * shapes GitHub's own server does (a JSON directory listing, an embedded
 * text or blob resource, a resource link past 1 MB with a download URL
 * carrying a raw token, a tree suggestion, a tool error), read from the
 * files each commit holds, so what a read returns shows which commit it
 * was made at.
 *
 * The account's connection is the fake's too: `GitHubAccess` answers the
 * token `connect` gave an account, and `not-connected` for any other.
 */

import { GITHUB_FAILURE } from "@sidecar/hosted/github-wire";
import { Effect, Layer, Redacted } from "effect";
import { FetchHttpClient, type HttpClient } from "effect/unstable/http";
import { GITHUB_MCP_ENDPOINT } from "../../server/hosted/github-mcp";
import {
  GitHubAccess,
  type GitHubAccessShape,
  GitHubUnavailable,
} from "../../server/hosted/github-source";

/** One file at one commit: its text, bytes that are not text, or a size past GitHub's 1 MB read. */
type FakeFile =
  | { readonly text: string }
  | { readonly binary: Uint8Array }
  | { readonly largeBytes: number };

export interface FakeRepository {
  readonly owner: string;
  readonly name: string;
  readonly private: boolean;
  readonly defaultBranch: string;
  /** Each commit's files by path. */
  readonly commits: ReadonlyMap<string, ReadonlyMap<string, FakeFile>>;
  /** Where each branch stands. */
  readonly branches: Map<string, string>;
}

export interface FakeGitHub {
  /** The fake's `fetch`, the `HttpClient` over it, and the account connections. */
  readonly layer: Layer.Layer<GitHubAccess | HttpClient.HttpClient>;
  /** The account connections alone, for a seam that takes the access as a value. */
  readonly access: GitHubAccessShape;
  /** Gives the account a connection under `token`, which reads `repositories`. */
  readonly connect: (
    userId: string,
    token: string,
    repositories: readonly FakeRepository[],
  ) => void;
  /** GitHub stops honoring the token, as it does when access is revoked. */
  readonly revoke: (token: string) => void;
  /** The token stops reading one repository, as when it is removed from an installation. */
  readonly withdraw: (token: string, repository: FakeRepository) => void;
  /** The MCP endpoint answers every request with this status instead. */
  readonly breakMcp: (status: number) => void;
}

const MCP_PROTOCOL_VERSION = "2025-06-18";
/** The raw-download token GitHub puts on a private file's download URL; no result may carry it. */
export const RAW_DOWNLOAD_TOKEN = "RAWTOKEN0000fixture";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

function json(body: JsonValue, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/** The repositories one token reads, by owner then name, each in GitHub's case-insensitive spelling. */
type Readable = Map<string, Map<string, FakeRepository>>;

function readableOf(repositories: readonly FakeRepository[]): Readable {
  const readable: Readable = new Map();
  for (const repository of repositories) {
    const owner = repository.owner.toLowerCase();
    const byName = readable.get(owner) ?? new Map<string, FakeRepository>();
    byName.set(repository.name.toLowerCase(), repository);
    readable.set(owner, byName);
  }
  return readable;
}

function lookUp(readable: Readable, owner: string, name: string): FakeRepository | undefined {
  return readable.get(owner.toLowerCase())?.get(name.toLowerCase());
}

/** The immediate entries under a directory at one commit, or nothing where the path is no directory. */
function directoryEntries(files: ReadonlyMap<string, FakeFile>, directory: string) {
  const prefix = directory === "" ? "" : `${directory}/`;
  const entries = new Map<string, { name: string; path: string; type: string; size: number }>();
  for (const [path, file] of files) {
    if (!path.startsWith(prefix)) continue;
    const [name, ...rest] = path.slice(prefix.length).split("/");
    if (name === undefined || name === "") continue;
    const entryPath = `${prefix}${name}`;
    entries.set(
      entryPath,
      rest.length > 0
        ? { name, path: entryPath, type: "dir", size: 0 }
        : { name, path: entryPath, type: "file", size: fileSize(file) },
    );
  }
  return entries.size === 0 ? undefined : [...entries.values()];
}

function fileSize(file: FakeFile): number {
  if ("text" in file) return new TextEncoder().encode(file.text).length;
  if ("binary" in file) return file.binary.length;
  return file.largeBytes;
}

function toolText(text: string): JsonValue {
  return { content: [{ type: "text", text }] };
}

function toolError(text: string): JsonValue {
  return { content: [{ type: "text", text }], isError: true };
}

/** `get_file_contents` as GitHub's server answers it, for one repository at one commit. */
function fileContents(repository: FakeRepository, sha: string, path: string): JsonValue {
  const files = repository.commits.get(sha);
  if (!files) {
    return toolError(
      `failed to resolve git reference: GET https://api.github.com/repos/${repository.owner}/${repository.name}/commits/${sha}: 404 Not Found []`,
    );
  }
  const uri = `repo://${repository.owner}/${repository.name}/sha/${sha}/contents/${path}`;
  const file = files.get(path);
  if (file && "text" in file) {
    return {
      content: [
        { type: "text", text: `successfully downloaded text file (SHA: ${sha.slice(0, 7)})` },
        {
          type: "resource",
          resource: { uri, mimeType: "text/plain; charset=utf-8", text: file.text },
        },
      ],
    };
  }
  if (file && "binary" in file) {
    return {
      content: [
        { type: "text", text: "successfully downloaded binary file" },
        {
          type: "resource",
          resource: {
            uri,
            mimeType: "image/png",
            blob: Buffer.from(file.binary).toString("base64"),
          },
        },
      ],
    };
  }
  if (file) {
    const download = `https://raw.githubusercontent.com/${repository.owner}/${repository.name}/${sha}/${path}?token=${RAW_DOWNLOAD_TOKEN}`;
    return {
      content: [
        {
          type: "text",
          text: `File ${path} is too large to display (${file.largeBytes} bytes). Use the download URL to fetch the content: ${download}`,
        },
        { type: "resource_link", uri, name: path.split("/").at(-1) ?? path, size: file.largeBytes },
      ],
    };
  }
  const entries = directoryEntries(files, path);
  if (entries) return toolText(JSON.stringify(entries));
  const matches = [...files.keys()].filter((candidate) => candidate.endsWith(path)).slice(0, 3);
  if (matches.length > 0) {
    return toolText(
      `Resolved potential matches in the repository tree (resolved refs: {"ref":"","sha":"${sha}"}, matching files: ${JSON.stringify(matches)}).`,
    );
  }
  return toolError(
    "Failed to get file contents. The path does not point to a file or directory, or the file does not exist in the repository.",
  );
}

export function fakeGitHub(): FakeGitHub {
  const readableByToken = new Map<string, Readable>();
  const tokenByUser = new Map<string, string>();
  let mcpStatus: number | undefined;

  const readable = (request: Request) => {
    const token = request.headers.get("authorization")?.replace(/^Bearer /u, "");
    return token === undefined ? undefined : readableByToken.get(token);
  };

  const rest = (request: Request, url: URL): Response => {
    const repositories = readable(request);
    if (!repositories) return json({ message: "Bad credentials" }, 401);
    const segments = url.pathname.split("/").slice(1).map(decodeURIComponent);
    if (segments[0] === "user" && segments[1] === "repos") {
      const page = Number(url.searchParams.get("page") ?? "1");
      const perPage = Number(url.searchParams.get("per_page") ?? "30");
      const all = [...repositories.values()].flatMap((byName) => [...byName.values()]);
      const slice = all.slice((page - 1) * perPage, page * perPage);
      const next = page * perPage < all.length;
      return json(
        slice.map((repository) => ({
          name: repository.name,
          owner: { login: repository.owner },
          private: repository.private,
          default_branch: repository.defaultBranch,
        })),
        200,
        next ? { link: `<https://api.github.com/user/repos?page=${page + 1}>; rel="next"` } : {},
      );
    }
    const [root, owner = "", name = "", kind, branch] = segments;
    const repository = root === "repos" ? lookUp(repositories, owner, name) : undefined;
    if (!repository) return json({ message: "Not Found" }, 404);
    if (kind === undefined) {
      return json({
        name: repository.name,
        owner: { login: repository.owner },
        private: repository.private,
        default_branch: repository.defaultBranch,
      });
    }
    const sha = kind === "branches" && branch ? repository.branches.get(branch) : undefined;
    if (sha === undefined) return json({ message: "Branch not found" }, 404);
    return json({ name: branch ?? "", commit: { sha } });
  };

  const mcp = async (request: Request): Promise<Response> => {
    if (mcpStatus !== undefined) return json({ message: "unavailable" }, mcpStatus);
    const repositories = readable(request);
    if (!repositories) return json({ message: "Bad credentials" }, 401);
    if (request.method !== "POST") return new Response(null, { status: 405 });
    const message = await request.json();
    if (message.id === undefined) return new Response(null, { status: 202 });
    const answer = (result: JsonValue) => json({ jsonrpc: "2.0", id: message.id, result });
    if (message.method === "initialize") {
      return answer({
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "github-mcp-server", version: "fake" },
      });
    }
    if (message.method !== "tools/call" || message.params?.name !== "get_file_contents") {
      return json({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "no" } });
    }
    const args = message.params.arguments ?? {};
    const repository = lookUp(repositories, args.owner ?? "", args.repo ?? "");
    if (!repository) {
      return answer(
        toolError(
          `failed to resolve git reference: GET https://api.github.com/repos/${args.owner}/${args.repo}: 404 Not Found []`,
        ),
      );
    }
    const sha: string = args.sha ?? repository.branches.get(repository.defaultBranch) ?? "";
    return answer(fileContents(repository, sha, String(args.path ?? "").replace(/^\/+/u, "")));
  };

  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.href === GITHUB_MCP_ENDPOINT) return mcp(request);
    if (url.origin === "https://api.github.com") return rest(request, url);
    throw new Error(`the GitHub fake answers no ${url.href}`);
  };

  const access: GitHubAccessShape = {
    token: (userId: string) => {
      const token = tokenByUser.get(userId);
      return token === undefined
        ? Effect.fail(new GitHubUnavailable({ reason: GITHUB_FAILURE.NOT_CONNECTED }))
        : Effect.succeed(Redacted.make(token));
    },
  };

  return {
    layer: Layer.mergeAll(
      Layer.succeed(GitHubAccess, access),
      FetchHttpClient.layer,
      Layer.succeed(FetchHttpClient.Fetch, fetch),
    ),
    access,
    connect: (userId, token, repositories) => {
      tokenByUser.set(userId, token);
      readableByToken.set(token, readableOf(repositories));
    },
    revoke: (token) => {
      readableByToken.delete(token);
    },
    withdraw: (token, repository) => {
      readableByToken
        .get(token)
        ?.get(repository.owner.toLowerCase())
        ?.delete(repository.name.toLowerCase());
    },
    breakMcp: (status) => {
      mcpStatus = status;
    },
  };
}
