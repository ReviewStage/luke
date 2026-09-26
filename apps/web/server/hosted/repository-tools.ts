import { GITHUB_FAILURE, type GitHubFailure, type PlanRepository } from "@sidecar/hosted";
import { EXCESS_KEYS, type UnparsedWireValue, unparsedWire } from "@sidecar/wire";
import { describeWire, readEither } from "@sidecar/wire/effect";
import { Effect, Option, Result, Schema } from "effect";
import type { SqlClient } from "effect/unstable/sql";
import { type GitHubToolResult, getFileContents } from "./github-mcp.js";
import { GitHubAccess, type GitHubUnavailable } from "./github-source.js";
import { readPlan } from "./plan-store.js";
import { logStoreFailure } from "./store-failure.js";
import type { PlanToolBinding } from "./update-plan-tool.js";

/**
 * repository-tools.ts -- the planning model's one source read: a directory listing or a file, from the plan's repository at the plan's commit.
 *
 * Note that the call's argument is a path and nothing else. The account,
 * the repository, and the commit are the binding the service built from the
 * authenticated session and the plan it opened, read from the plan's row on
 * every call, so a resumed conversation reads the same commit its plan was
 * started at and a model can name no other account, repository, or commit:
 * an argument naming one is refused with the rest of a malformed call, and a
 * path that climbs out of the repository with `..` is refused before it is
 * sent. The credential is the account's own GitHub connection, read here and
 * handed straight to the MCP call (`github-mcp.ts`); it is never an
 * argument, never in a result, and never in a log line.
 *
 * What GitHub answers is read into this module's own shape rather than
 * handed through: a directory is its entries' paths and types, a file is its
 * text, and each names the repository and commit it came from. GitHub's
 * own text is never forwarded, because it can carry download links that
 * hold a credential of their own. Every outcome that is not source is a
 * `not-read` result whose words say nothing was read and why, so the model
 * cannot mistake a failure, a revoked connection, a binary file, or a file
 * over GitHub's limit for code it inspected; a long file or directory is
 * returned cut and marked `truncated`.
 */

export const REPOSITORY_READ_BOUNDS = {
  MAX_PATH_CHARS: 1_000,
  /** The most characters of one file returned; past it the text is cut and marked. */
  MAX_FILE_CHARS: 60_000,
  /** The most entries of one directory returned; past it the listing is cut and marked. */
  MAX_DIRECTORY_ENTRIES: 500,
} as const;

export const REPOSITORY_READ_STATUS = {
  DIRECTORY: "directory",
  FILE: "file",
  NOT_READ: "not-read",
} as const;

/** Why a call read nothing, in words the model can act on. */
export const REPOSITORY_READ_REFUSAL = {
  UNREADABLE:
    "Not read: the arguments must be exactly `path`, relative to the repository root " +
    '("" for the root), with no ".", "..", or empty segments. The repository and commit ' +
    "are fixed by the plan and cannot be chosen.",
  NO_PLAN: "Not read: this plan no longer exists, so it names no repository.",
  STORE_UNAVAILABLE:
    "Not read: the service could not reach its store to read the plan's repository. " +
    "Nothing was read; the call may be made again.",
  NOT_CONNECTED:
    "Not read: the account has no GitHub connection, so nothing in the repository was read. " +
    "The developer has to connect GitHub.",
  ACCESS_DENIED:
    "Not read: GitHub refused the account's connection (revoked, expired, or uninstalled), " +
    "so nothing was read. The developer has to reconnect GitHub.",
  NOT_FOUND:
    "Not read: nothing exists at this path at the plan's commit, or the connection can no " +
    "longer read this repository.",
  RATE_LIMITED: "Not read: GitHub is rate limiting the connection. Nothing was read.",
  FAILED:
    "Not read: GitHub or the network failed, or answered in a shape the service does not " +
    "read. Nothing was read; the call may be made again.",
  BINARY: "Not read: this path is a binary file, and only text is returned.",
  TOO_LARGE: "Not read: this file is over GitHub's 1 MB read limit, so no content was returned.",
  NO_CONTENT: "Not read: this path is a symbolic link or submodule, which has no content here.",
} as const;

const REFUSAL_OF_FAILURE = {
  [GITHUB_FAILURE.NOT_CONNECTED]: REPOSITORY_READ_REFUSAL.NOT_CONNECTED,
  [GITHUB_FAILURE.ACCESS_DENIED]: REPOSITORY_READ_REFUSAL.ACCESS_DENIED,
  [GITHUB_FAILURE.NOT_FOUND]: REPOSITORY_READ_REFUSAL.NOT_FOUND,
  [GITHUB_FAILURE.EMPTY_REPOSITORY]: REPOSITORY_READ_REFUSAL.NOT_FOUND,
  [GITHUB_FAILURE.RATE_LIMITED]: REPOSITORY_READ_REFUSAL.RATE_LIMITED,
  [GITHUB_FAILURE.FAILED]: REPOSITORY_READ_REFUSAL.FAILED,
} as const satisfies Record<GitHubFailure, string>;

/** Where a read came from: the plan's repository and commit, and the path asked for. */
interface ReadSource {
  readonly repository: { readonly owner: string; readonly name: string };
  readonly commit: string;
  readonly path: string;
}

// A type rather than an interface, so a result is a `WireRecord` the model is handed as it stands.
type RepositoryEntry = {
  readonly path: string;
  /** GitHub's own kind: `file`, `dir`, `symlink`, or `submodule`. */
  readonly type: string;
  /** Bytes, for a file. */
  readonly size?: number;
};

export type RepositoryReadResult =
  | (ReadSource & {
      readonly status: typeof REPOSITORY_READ_STATUS.DIRECTORY;
      readonly entries: readonly RepositoryEntry[];
      readonly truncated: boolean;
    })
  | (ReadSource & {
      readonly status: typeof REPOSITORY_READ_STATUS.FILE;
      readonly content: string;
      /** The file's whole length, which is longer than `content` where it was cut. */
      readonly characters: number;
      readonly truncated: boolean;
    })
  | (Partial<ReadSource> & {
      readonly status: typeof REPOSITORY_READ_STATUS.NOT_READ;
      readonly reason: string;
      /** Where a malformed call went wrong, as the dotted path of the field refused. */
      readonly field?: string;
      /** Paths at the commit whose ends match the one asked for, as GitHub suggested them. */
      readonly suggestions?: readonly string[];
    });

/** A path the repository's own contents could hold: no climbing, no empty or dot segments, nothing a URL reads specially. */
const REPOSITORY_PATH = Schema.Trim.check(
  Schema.isMaxLength(REPOSITORY_READ_BOUNDS.MAX_PATH_CHARS),
  Schema.makeFilter((path: string) => {
    const relative = path.replace(/^\/+|\/+$/gu, "");
    if (relative === "") return true;
    if (/[\\?#%\p{Cc}]/u.test(relative)) return false;
    return relative
      .split("/")
      .every((segment) => segment !== "" && segment !== "." && segment !== "..");
  }),
);

const GET_FILE_CONTENTS_INPUT = Schema.Struct({
  path: describeWire(
    REPOSITORY_PATH,
    'A directory or file path relative to the repository root, such as "src/app" or ' +
      '"package.json"; "" lists the root.',
  ),
});

const readInput = readEither(GET_FILE_CONTENTS_INPUT);

/** The tool as a planning model is offered it: its name, its words, and its input schema. */
export const GET_FILE_CONTENTS_TOOL = {
  name: "get_file_contents",
  description:
    "Read the plan's GitHub repository at the plan's saved commit: a directory path lists its " +
    "entries, a file path returns its text. The repository and commit are fixed by the plan. " +
    "Answers the source with its path and commit, or `not-read` and why nothing was read.",
  inputSchema: GET_FILE_CONTENTS_INPUT,
} as const;

const DirectorySchema = Schema.fromJsonString(
  Schema.Array(
    Schema.Struct({
      path: Schema.String,
      type: Schema.String,
      size: Schema.optionalKey(Schema.Number),
    }),
  ),
);

const readDirectory = readEither(DirectorySchema, { excess: EXCESS_KEYS.DROP });

/** GitHub's answer for a path that is not one, and the paths its tree suggests instead. */
const POTENTIAL_MATCHES = /^Resolved potential matches.*matching files: (\[[^\]]*\])/su;
const readSuggestions = readEither(Schema.fromJsonString(Schema.Array(Schema.String)));

const RESOURCE_LINK = "resource_link";

function notRead(
  reason: string,
  source?: ReadSource,
  extra?: { readonly field?: string; readonly suggestions?: readonly string[] },
): RepositoryReadResult {
  return { status: REPOSITORY_READ_STATUS.NOT_READ, reason, ...source, ...extra };
}

/**
 * The reason an MCP tool error names. The tool reports GitHub's refusals
 * as text, so the status in it is all there is to go on; the text itself
 * goes no further.
 */
function refusalOfToolError(texts: readonly string[]): string {
  const words = texts.join(" ").toLowerCase();
  if (words.includes("rate limit")) return REPOSITORY_READ_REFUSAL.RATE_LIMITED;
  if (words.includes("401") || words.includes("bad credentials")) {
    return REPOSITORY_READ_REFUSAL.ACCESS_DENIED;
  }
  if (words.includes("404") || words.includes("not found") || words.includes("does not exist")) {
    return REPOSITORY_READ_REFUSAL.NOT_FOUND;
  }
  if (words.includes("403")) return REPOSITORY_READ_REFUSAL.NOT_FOUND;
  return REPOSITORY_READ_REFUSAL.FAILED;
}

/** A directory's entries as the model reads them, cut at the bound. */
function directoryRead(source: ReadSource, text: string): RepositoryReadResult | undefined {
  const entries = readDirectory(unparsedWire(text));
  if (Result.isFailure(entries)) return undefined;
  const kept = entries.success.slice(0, REPOSITORY_READ_BOUNDS.MAX_DIRECTORY_ENTRIES);
  return {
    status: REPOSITORY_READ_STATUS.DIRECTORY,
    ...source,
    entries: kept.map((entry) => ({
      path: entry.path,
      type: entry.type,
      ...(entry.size === undefined ? undefined : { size: entry.size }),
    })),
    truncated: kept.length < entries.success.length,
  };
}

/** A file's text as the model reads it, cut at the bound. */
function fileRead(source: ReadSource, text: string): RepositoryReadResult {
  const truncated = text.length > REPOSITORY_READ_BOUNDS.MAX_FILE_CHARS;
  return {
    status: REPOSITORY_READ_STATUS.FILE,
    ...source,
    content: truncated ? text.slice(0, REPOSITORY_READ_BOUNDS.MAX_FILE_CHARS) : text,
    characters: text.length,
    truncated,
  };
}

/** A text-only answer: a directory, a path GitHub could only suggest matches for, or a link or submodule. */
function textRead(source: ReadSource, text: string): RepositoryReadResult {
  const directory = directoryRead(source, text);
  if (directory) return directory;
  const matches = POTENTIAL_MATCHES.exec(text)?.[1];
  if (matches !== undefined) {
    const suggestions = readSuggestions(unparsedWire(matches));
    return notRead(
      REPOSITORY_READ_REFUSAL.NOT_FOUND,
      source,
      Result.isSuccess(suggestions) ? { suggestions: suggestions.success } : undefined,
    );
  }
  if (text.trimStart().startsWith("{")) return notRead(REPOSITORY_READ_REFUSAL.NO_CONTENT, source);
  return notRead(REPOSITORY_READ_REFUSAL.FAILED, source);
}

/** GitHub's `CallToolResult` read into what the model is shown. */
function readOfToolResult(source: ReadSource, result: GitHubToolResult): RepositoryReadResult {
  const texts: string[] = [];
  for (const item of result.content) {
    if ("text" in item) texts.push(item.text);
  }
  if (result.isError === true) return notRead(refusalOfToolError(texts), source);
  for (const item of result.content) {
    if (!("resource" in item)) continue;
    if (item.resource.text !== undefined) return fileRead(source, item.resource.text);
    if (item.resource.blob !== undefined) return notRead(REPOSITORY_READ_REFUSAL.BINARY, source);
  }
  if (result.content.some((item) => item.type === RESOURCE_LINK)) {
    return notRead(REPOSITORY_READ_REFUSAL.TOO_LARGE, source);
  }
  const [text] = texts;
  if (text === undefined) return notRead(REPOSITORY_READ_REFUSAL.FAILED, source);
  return textRead(source, text);
}

function sourceOf(repository: PlanRepository, path: string): ReadSource {
  return {
    repository: { owner: repository.owner, name: repository.name },
    commit: repository.commit,
    path: path.replace(/^\/+|\/+$/gu, ""),
  };
}

/** The plan's repository and the account's credential, then GitHub's answer at the plan's commit. */
const readAtPlanCommit = /* @__PURE__ */ Effect.fnUntraced(function* (
  binding: PlanToolBinding,
  path: string,
) {
  const stored = yield* readPlan(binding.userId, binding.planId).pipe(
    Effect.tapError(logStoreFailure),
    Effect.orElseSucceed(() => undefined),
  );
  if (stored === undefined) return notRead(REPOSITORY_READ_REFUSAL.STORE_UNAVAILABLE);
  if (Option.isNone(stored)) return notRead(REPOSITORY_READ_REFUSAL.NO_PLAN);
  const repository = stored.value.plan.repository;
  const source = sourceOf(repository, path);
  const github = yield* GitHubAccess;
  return yield* github.token(binding.userId).pipe(
    Effect.flatMap((token) =>
      getFileContents(token, {
        owner: repository.owner,
        repo: repository.name,
        path: source.path,
        sha: repository.commit,
      }),
    ),
    Effect.map((answered) => readOfToolResult(source, answered)),
    Effect.catchTag("GitHubUnavailable", (failure: GitHubUnavailable) =>
      Effect.succeed(notRead(REFUSAL_OF_FAILURE[failure.reason], source)),
    ),
  );
});

/** One call of `get_file_contents` under the plan the service bound, answered as the result the model reads. */
export function runGetFileContents(
  binding: PlanToolBinding,
  input: UnparsedWireValue,
): Effect.Effect<RepositoryReadResult, never, SqlClient.SqlClient | GitHubAccess> {
  return Effect.suspend(() => {
    const read = readInput(input);
    if (Result.isFailure(read)) {
      const field = read.failure.path.join(".");
      return Effect.succeed(
        notRead(REPOSITORY_READ_REFUSAL.UNREADABLE, undefined, field ? { field } : undefined),
      );
    }
    return readAtPlanCommit(binding, read.success.path);
  });
}
