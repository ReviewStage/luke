/**
 * github-fake.ts -- GitHub as a test answers it: the REST metadata reads behind one `fetch`.
 *
 * The fake stands where production's network does: `FetchHttpClient.Fetch`,
 * the `fetch` Effect's `HttpClient` sends through. Each token names the
 * repositories it can read, and a revoked token is refused at the door the
 * way GitHub refuses it, with a 401.
 *
 * The account's connection is the fake's too: `GitHubAccess` answers the
 * token `connect` gave an account, and `not-connected` for any other.
 */

import { GITHUB_FAILURE } from "@sidecar/hosted/github-wire";
import { Effect, Layer, Redacted } from "effect";
import { FetchHttpClient, type HttpClient } from "effect/unstable/http";
import {
  GitHubAccess,
  type GitHubAccessShape,
  GitHubUnavailable,
} from "../../server/hosted/github-source";

export interface FakeRepository {
  readonly owner: string;
  readonly name: string;
  readonly private: boolean;
  readonly defaultBranch: string;
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
}

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

/** A GitHub access under which no account holds a connection, for a host offered none. */
export const noGitHubConnections: GitHubAccessShape = {
  token: () => Effect.fail(new GitHubUnavailable({ reason: GITHUB_FAILURE.NOT_CONNECTED })),
};

export function fakeGitHub(): FakeGitHub {
  const readableByToken = new Map<string, Readable>();
  const tokenByUser = new Map<string, string>();

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

  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
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
  };
}
