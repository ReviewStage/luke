import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import { GITHUB_FAILURE, type GitHubFailure } from "@sidecar/hosted";
import { HTTP_STATUS } from "@sidecar/wire";
import { Duration, Effect, Option, Redacted, Schema } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { GitHubUnavailable } from "./github-source.js";

/**
 * github-mcp.ts -- one call of GitHub's hosted, read-only `get_file_contents` tool under the account's credential.
 *
 * GitHub hosts the repository reads: this module is a standard MCP client
 * (`@ai-sdk/mcp` over Streamable HTTP) attached to the read-only repository
 * toolset at `GITHUB_MCP_ENDPOINT`, which exposes no write tool at all, and
 * of what it exposes the service calls `get_file_contents` alone. A client is
 * opened for the one call and closed with it, so nothing about one account's
 * session outlives the call that needed it.
 *
 * The credential rides the `Authorization` header and nothing else: the
 * arguments are the owner, repository, path, and commit the caller bound,
 * and what comes back is GitHub's `CallToolResult`, decoded to the parts a
 * caller reads.
 * A refusal at the transport is a `GITHUB_FAILURE` reason; GitHub's error
 * text never travels past here. The HTTP beneath the client is the `fetch`
 * `FetchHttpClient` itself reads, so a test answers MCP and GitHub's REST
 * reads from one fake.
 */

/** GitHub's hosted MCP service, the repository toolset, read-only. */
export const GITHUB_MCP_ENDPOINT = "https://api.githubcopilot.com/mcp/x/repos/readonly";

const GITHUB_MCP_TOOL = {
  GET_FILE_CONTENTS: "get_file_contents",
} as const;

/** One read, from the handshake to the answer. */
const GITHUB_MCP_TIMEOUT = Duration.seconds(25);

/** What a directory listing asks GitHub to return for each entry. */
const DIRECTORY_FIELDS = ["name", "path", "type", "size"] as const;

/** Where the read points: every field fixed by the caller, never by the model. */
export interface GitHubFileContentsTarget {
  readonly owner: string;
  readonly repo: string;
  /** Relative to the repository root; empty for the root itself. */
  readonly path: string;
  /** The full commit id every read is pinned to. */
  readonly sha: string;
}

/** The HTTP status the MCP client's transport error carries, where it carries one. */
const readTransportStatus = Schema.decodeUnknownOption(
  Schema.Struct({ statusCode: Schema.Number }),
);

/**
 * GitHub's `CallToolResult`, as much of it as the service reads: the text,
 * embedded resources, and resource links a `get_file_contents` answer is
 * made of, and whether the tool reported an error. Any other kind of item is
 * kept as its kind alone.
 */
const TextItemSchema = Schema.Struct({ type: Schema.Literal("text"), text: Schema.String });

const ResourceItemSchema = Schema.Struct({
  type: Schema.Literal("resource"),
  resource: Schema.Struct({
    text: Schema.optionalKey(Schema.String),
    blob: Schema.optionalKey(Schema.String),
  }),
});

const OtherItemSchema = Schema.Struct({ type: Schema.String });

const ToolResultSchema = Schema.Struct({
  content: Schema.Array(Schema.Union([TextItemSchema, ResourceItemSchema, OtherItemSchema])),
  isError: Schema.optionalKey(Schema.Boolean),
});

export type GitHubToolResult = typeof ToolResultSchema.Type;

const readToolResult = Schema.decodeUnknownEffect(ToolResultSchema);

/**
 * The reason a failed MCP exchange names. The transport carries GitHub's
 * HTTP status on the error it raises; a 401 or 403 there is GitHub refusing
 * the credential itself, before any tool ran.
 */
function failureOfClientError(cause: unknown): GitHubFailure {
  const status = Option.getOrUndefined(readTransportStatus(cause))?.statusCode;
  if (status === HTTP_STATUS.UNAUTHORIZED || status === HTTP_STATUS.FORBIDDEN) {
    return GITHUB_FAILURE.ACCESS_DENIED;
  }
  if (status === HTTP_STATUS.TOO_MANY_REQUESTS) return GITHUB_FAILURE.RATE_LIMITED;
  return GITHUB_FAILURE.FAILED;
}

function unavailable(cause: unknown): GitHubUnavailable {
  return new GitHubUnavailable({ reason: failureOfClientError(cause) });
}

/** A client attached for one call, closed when the call's scope ends, however it ended. */
function attached(token: Redacted.Redacted, fetch: typeof globalThis.fetch) {
  return Effect.acquireRelease(
    Effect.tryPromise({
      try: (signal) =>
        createMCPClient({
          transport: {
            type: "http",
            url: GITHUB_MCP_ENDPOINT,
            headers: { authorization: `Bearer ${Redacted.value(token)}` },
            fetch,
          },
          // GitHub's server takes `initialize` first; probing for discovery is a wasted round trip.
          protocolVersionDiscovery: false,
          initializationOptions: { signal },
          clientName: "luke",
        }),
      catch: unavailable,
    }),
    (client: MCPClient) => Effect.promise(() => client.close()),
  );
}

/** GitHub's answer to one `get_file_contents` call at the bound commit. */
export const getFileContents = /* @__PURE__ */ Effect.fn("web/githubGetFileContents")(function* (
  token: Redacted.Redacted,
  target: GitHubFileContentsTarget,
) {
  const fetch = yield* FetchHttpClient.Fetch;
  return yield* Effect.scoped(
    Effect.flatMap(attached(token, fetch), (client) =>
      Effect.tryPromise({
        try: (signal) =>
          client.callTool({
            name: GITHUB_MCP_TOOL.GET_FILE_CONTENTS,
            arguments: {
              owner: target.owner,
              repo: target.repo,
              path: target.path,
              sha: target.sha,
              fields: [...DIRECTORY_FIELDS],
            },
            options: { signal },
          }),
        catch: unavailable,
      }),
    ),
  ).pipe(
    // An answer in no shape the service reads is GitHub not having answered what was asked.
    Effect.flatMap((answered) =>
      Effect.mapError(
        readToolResult(answered),
        () => new GitHubUnavailable({ reason: GITHUB_FAILURE.FAILED }),
      ),
    ),
    Effect.timeout(GITHUB_MCP_TIMEOUT),
    Effect.catchTag("TimeoutError", () =>
      Effect.fail(new GitHubUnavailable({ reason: GITHUB_FAILURE.FAILED })),
    ),
  );
});
