/**
 * linear-issues.ts -- a workspace's Linear issues, read through the one grant an owner or admin connected for it.
 *
 * A workspace's Linear grant is held by Vercel Connect under the
 * workspace's own id as its subject (`integration-connect.ts` takes any
 * subject id), on a connector of its own (`WorkspaceLinearConnect`), and
 * Luke uses it only while the workspace's row stands connected
 * (`workspace-integration-store.ts`). It is a Linear API OAuth token, which
 * Linear's GraphQL API takes as a bearer, and which the accounts' connector,
 * signing in through Linear's MCP server, does not issue, so the picker's list and the
 * issue a plan starts from are read there, with no team filter: whatever
 * the grant reaches, every member of the workspace reads, a private team's
 * issues among them, which is what the admin agreed to on connecting.
 *
 * Every failure is one word, and nothing Linear said is kept: an error's
 * message is Linear's own, which nothing here can vouch for holding no
 * credential.
 */

import type { DatabaseServices, QueryError } from "@luke/database/core/query";
import { INTEGRATION_ROW_STATUS } from "@luke/database/integration-vocabulary";
import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import {
  LINEAR_BOUNDS,
  type LinearIssueSummary,
  type TaskLinearIssue,
} from "@luke/features/linear-wire";
import { Data, Duration, Effect, Option, Redacted, Result, Schema } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
} from "../http/http-effect.js";
import {
  INTEGRATION_CONNECT_FAILURE,
  type IntegrationToken,
  WorkspaceLinearConnect,
} from "./integration-connect.js";
import {
  expireWorkspaceIntegration,
  readWorkspaceIntegration,
} from "./workspace-integration-store.js";

/** Linear's GraphQL API, which takes an OAuth token as a bearer. */
const LINEAR_GRAPHQL_URL = "https://api.linear.app/graphql";

/** How long one read of Linear may take. */
const READ_TIMEOUT = Duration.seconds(10);

/** Why a workspace's Linear answered nothing usable. */
export const LINEAR_READ_FAILURE = {
  /** The workspace has no Linear connected, or the deployment names no Linear connector. */
  NOT_CONNECTED: "not-connected",
  /** Connect or Linear holds no grant it honors for the workspace any more: an owner or admin connects again. */
  EXPIRED: "expired",
  /** The issue asked for is none the grant reaches. */
  NOT_FOUND: "not-found",
  /** Connect or Linear could not be asked, or answered something unreadable. */
  UNAVAILABLE: "unavailable",
} as const;

export type LinearReadFailureReason =
  (typeof LINEAR_READ_FAILURE)[keyof typeof LINEAR_READ_FAILURE];

export class LinearReadFailure extends Data.TaggedError("LinearReadFailure")<{
  readonly reason: LinearReadFailureReason;
}> {
  override get message(): string {
    return `Linear answered ${this.reason}`;
  }
}

const failed = (reason: LinearReadFailureReason) => new LinearReadFailure({ reason });

const IssueNodeSchema = Schema.Struct({
  id: Schema.String,
  identifier: Schema.String,
  title: Schema.String,
  url: Schema.String,
  state: Schema.optionalKey(Schema.NullOr(Schema.Struct({ name: Schema.String }))),
  assignee: Schema.optionalKey(Schema.NullOr(Schema.Struct({ name: Schema.String }))),
});

const IssueListSchema = Schema.Struct({
  data: Schema.Struct({
    issues: Schema.Struct({ nodes: Schema.Array(IssueNodeSchema) }),
  }),
});

const IssueSearchSchema = Schema.Struct({
  data: Schema.Struct({
    searchIssues: Schema.Struct({ nodes: Schema.Array(IssueNodeSchema) }),
  }),
});

const IssueOneSchema = Schema.Struct({
  data: Schema.Struct({
    issue: Schema.NullOr(
      Schema.Struct({
        identifier: Schema.String,
        title: Schema.String,
        url: Schema.String,
        description: Schema.optionalKey(Schema.NullOr(Schema.String)),
      }),
    ),
  }),
});

const IssueByIdentifierSchema = Schema.Struct({
  data: Schema.Struct({ issue: Schema.NullOr(IssueNodeSchema) }),
});

const ISSUE_FIELDS = "id identifier title url state { name } assignee { name }";

const QUERY = {
  RECENT: `query LukeRecentIssues($first: Int!) { issues(first: $first, orderBy: updatedAt) { nodes { ${ISSUE_FIELDS} } } }`,
  SEARCH: `query LukeSearchIssues($term: String!, $first: Int!) { searchIssues(term: $term, first: $first) { nodes { ${ISSUE_FIELDS} } } }`,
  ONE: "query LukeIssue($id: String!) { issue(id: $id) { identifier title url description } }",
  BY_IDENTIFIER: `query LukeIssueByIdentifier($id: String!) { issue(id: $id) { ${ISSUE_FIELDS} } }`,
} as const;

/** HTTP statuses Linear answers a token it no longer honors with. */
const REFUSED_STATUSES: readonly number[] = [401, 403];

/**
 * One GraphQL request under the bearer, its answer decoded by the schema.
 * Note that a GraphQL error comes back as 200 with no `data`, so it fails
 * the decode and reads as unavailable, and an issue that is not found comes
 * back the same way: the one read that tells those apart is `linearIssue`,
 * which asks for the issue by id and reads a null.
 */
function graphql<S extends Schema.Top>(
  token: Redacted.Redacted,
  query: string,
  variables: Record<string, string | number>,
  schema: S,
): Effect.Effect<S["Type"], LinearReadFailure, HttpClient.HttpClient | S["DecodingServices"]> {
  return Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const request = HttpClientRequest.post(LINEAR_GRAPHQL_URL).pipe(
      HttpClientRequest.setHeaders({
        authorization: `Bearer ${Redacted.value(token)}`,
        accept: "application/json",
      }),
      HttpClientRequest.bodyJsonUnsafe({ query, variables }),
    );
    const response = yield* Effect.mapError(client.execute(request), () =>
      failed(LINEAR_READ_FAILURE.UNAVAILABLE),
    );
    if (REFUSED_STATUSES.includes(response.status))
      return yield* failed(LINEAR_READ_FAILURE.EXPIRED);
    if (response.status >= 400) return yield* failed(LINEAR_READ_FAILURE.UNAVAILABLE);
    const body = yield* Effect.mapError(response.json, () =>
      failed(LINEAR_READ_FAILURE.UNAVAILABLE),
    );
    return yield* Effect.mapError(Schema.decodeUnknownEffect(schema)(body), () =>
      failed(LINEAR_READ_FAILURE.UNAVAILABLE),
    );
  }).pipe(
    Effect.timeoutOrElse({
      duration: READ_TIMEOUT,
      orElse: () => Effect.fail(failed(LINEAR_READ_FAILURE.UNAVAILABLE)),
    }),
  );
}

function summaryOf(node: typeof IssueNodeSchema.Type): LinearIssueSummary {
  const state = node.state?.name;
  const assignee = node.assignee?.name;
  return {
    id: node.id,
    identifier: node.identifier,
    title: node.title,
    url: node.url,
    ...(state !== undefined ? { state } : undefined),
    ...(assignee !== undefined ? { assignee } : undefined),
  };
}

/**
 * The workspace's Linear token while its row stands connected, or why
 * there is none. A grant Connect no longer holds marks the row expired, so
 * the settings row says so and an owner or admin can connect again; a
 * connected row on a deployment that names no workspace connector is
 * unavailable, never not connected.
 */
export const workspaceLinearToken = /* @__PURE__ */ Effect.fn("web/workspaceLinearToken")(
  function* (
    organizationId: string,
  ): Effect.fn.Return<
    Result.Result<IntegrationToken, LinearReadFailureReason>,
    QueryError | Schema.SchemaError,
    DatabaseServices | WorkspaceLinearConnect
  > {
    const row = yield* readWorkspaceIntegration(organizationId, INTEGRATION_PROVIDER.LINEAR);
    if (row?.status === INTEGRATION_ROW_STATUS.EXPIRED) {
      return Result.fail(LINEAR_READ_FAILURE.EXPIRED);
    }
    if (row?.status !== INTEGRATION_ROW_STATUS.CONNECTED) {
      return Result.fail(LINEAR_READ_FAILURE.NOT_CONNECTED);
    }
    const connector = yield* WorkspaceLinearConnect;
    const issued = yield* Effect.result(connector.token(organizationId, { fresh: false }));
    if (Result.isSuccess(issued)) return Result.succeed(issued.success);
    switch (issued.failure.reason) {
      case INTEGRATION_CONNECT_FAILURE.NOT_AUTHORIZED:
        yield* expireWorkspaceIntegration(organizationId, INTEGRATION_PROVIDER.LINEAR);
        return Result.fail(LINEAR_READ_FAILURE.EXPIRED);
      case INTEGRATION_CONNECT_FAILURE.NOT_CONFIGURED:
        // Note that a connected row is unavailable rather than not connected, because a turn
        // answered not connected reads the member's own Linear in the workspace's place.
        yield* Effect.logWarning("The deployment names no workspace Linear connector");
        return Result.fail(LINEAR_READ_FAILURE.UNAVAILABLE);
      case INTEGRATION_CONNECT_FAILURE.UNAVAILABLE:
        yield* Effect.logWarning(
          "Vercel Connect gave no workspace Linear token",
          issued.failure.message,
        );
        return Result.fail(LINEAR_READ_FAILURE.UNAVAILABLE);
    }
  },
);

/** The issues the grant reaches, newest changed first, or those a search matches, at most a page of them. */
export function listLinearIssues(
  token: Redacted.Redacted,
  query: string | undefined,
): Effect.Effect<readonly LinearIssueSummary[], LinearReadFailure, HttpClient.HttpClient> {
  const term = query?.trim() ?? "";
  const first = LINEAR_BOUNDS.MAX_ISSUES;
  const nodes =
    term === ""
      ? Effect.map(
          graphql(token, QUERY.RECENT, { first }, IssueListSchema),
          (answer) => answer.data.issues.nodes,
        )
      : Effect.map(
          graphql(token, QUERY.SEARCH, { term, first }, IssueSearchSchema),
          (answer) => answer.data.searchIssues.nodes,
        );
  return Effect.map(nodes, (read) => read.slice(0, first).map(summaryOf));
}

/**
 * The one issue an identifier names, `ENG-123`, as the picker lists one, its
 * state among it, which Linear's `issue` query takes in place of an id; none
 * where Linear answers no issue for it.
 */
export function linearIssueByIdentifier(
  token: Redacted.Redacted,
  identifier: string,
): Effect.Effect<readonly LinearIssueSummary[], LinearReadFailure, HttpClient.HttpClient> {
  return Effect.map(
    graphql(token, QUERY.BY_IDENTIFIER, { id: identifier }, IssueByIdentifierSchema),
    (answer) => (answer.data.issue === null ? [] : [summaryOf(answer.data.issue)]),
  );
}

/** One issue by its id, as a plan keeps it: its description bounded, empty where it has none. */
export function linearIssue(
  token: Redacted.Redacted,
  id: string,
): Effect.Effect<TaskLinearIssue, LinearReadFailure, HttpClient.HttpClient> {
  return Effect.flatMap(graphql(token, QUERY.ONE, { id }, IssueOneSchema), (answer) =>
    Option.match(Option.fromNullOr(answer.data.issue), {
      onNone: () => Effect.fail(failed(LINEAR_READ_FAILURE.NOT_FOUND)),
      onSome: (issue) =>
        Effect.succeed({
          identifier: issue.identifier,
          title: issue.title,
          url: issue.url,
          description: (issue.description ?? "").slice(0, LINEAR_BOUNDS.MAX_DESCRIPTION_CHARS),
        }),
    }),
  );
}

/**
 * A read through the workspace's Linear: its token, then the read, and the
 * workspace's row marked expired where Linear itself refused the token, so
 * Settings says so and New plan stops offering a picker that cannot read.
 */
export function throughWorkspaceLinear<A>(
  organizationId: string,
  read: (token: Redacted.Redacted) => Effect.Effect<A, LinearReadFailure, HttpClient.HttpClient>,
): Effect.Effect<
  A,
  LinearReadFailure | QueryError | Schema.SchemaError,
  DatabaseServices | WorkspaceLinearConnect | HttpClient.HttpClient
> {
  return Effect.gen(function* () {
    const token = yield* workspaceLinearToken(organizationId);
    if (Result.isFailure(token)) return yield* failed(token.failure);
    return yield* read(token.success.token).pipe(
      Effect.tapError((failure) =>
        failure.reason === LINEAR_READ_FAILURE.EXPIRED
          ? expireWorkspaceIntegration(organizationId, INTEGRATION_PROVIDER.LINEAR)
          : Effect.void,
      ),
    );
  });
}

/**
 * A Linear read as a route answers it: Linear's own failure as the one
 * Linear refusal, logged by its word, and a store failure as unavailable.
 */
export function linearOrRefused<A, R>(
  read: Effect.Effect<A, LinearReadFailure | QueryError | Schema.SchemaError, R>,
  logLine: string,
): Effect.Effect<A, HostedRefusal, R> {
  return Effect.catch(read, (failure) =>
    failure instanceof LinearReadFailure
      ? Effect.andThen(
          Effect.logWarning(logLine, failure.reason),
          Effect.fail(HOSTED_REFUSAL.LINEAR_UNAVAILABLE),
        )
      : hostedStoreOrUnavailable(Effect.fail(failure)),
  );
}
