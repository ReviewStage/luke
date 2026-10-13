/**
 * linear-connection.ts -- the one Linear MCP connection every agent of Luke's registers.
 *
 * The planning assistant, the coding agent, and each one's declared worker
 * are four eve agents, and eve hands a declared subagent none of its
 * parent's connections, so each registers `connections/linear.ts` of its
 * own; every one of those files is this definition over its own ownership
 * check, the root's or the delegated one, and nothing else.
 *
 * The connection is Linear's own hosted MCP server, every tool it lists,
 * and no approval: a write runs the moment the model calls it, as the plan
 * decided. Its credential is the account's, read from Vercel Connect under
 * the user id the ownership check admitted, never the session's principal:
 * a spoken planning turn runs as the deployment acting for the account, and
 * eve's own user-scoped auth would refuse it before reading any token. So
 * the auth here is eve's plain `getToken` form, credentialed as the app, and
 * the account is chosen inside it. That form has no interactive half, so
 * eve never parks a turn on a sign-in: sign-in happens in Luke's account
 * settings, before any run.
 *
 * A connection that cannot be used fails only the call that tried it: the
 * token read throws one of the fixed sentences below, which eve reports as
 * that call's error, and every other tool, and the run, carries on. No
 * sentence carries a token, a Connect message, or an HTTP status, because
 * eve reads a status in an error's words as a sign-in to start.
 *
 * eve opens the connection's client once a model step and reuses it for the
 * rest of that step, so the account's row is read at each opening: a
 * Disconnect takes effect from the next step, whatever the SDK cached.
 */

import { causeKind } from "@sidecar/runtime/effect";
import { Effect, Redacted, Result, type Schema } from "effect";
import type { SqlClient } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { defineMcpClientConnection, type McpClientConnectionDefinition } from "eve/connections";
import type { SessionAuth } from "eve/context";
import type { ConversationAdmission } from "./brain-host/conversation.js";
import { LINEAR_CONNECTION_NAME } from "./connection-tools.js";
import { LINEAR_CONNECT_FAILURE, LinearConnect } from "./linear-connect.js";
import { expireLinearConnection, LINEAR_ROW_STATUS, readLinearConnection } from "./linear-store.js";

/** Linear's own hosted MCP server, and how the model is told of it. */
export const LINEAR_MCP = {
  /** The name eve registers the connection under, which its file's name is. */
  NAME: LINEAR_CONNECTION_NAME,
  URL: "https://mcp.linear.app/mcp",
  DESCRIPTION:
    "Linear, the developer's issue tracker, as their own account sees it: find, read, create, and update issues, projects, cycles, documents, and comments.",
} as const;

/** Why a Linear call ran nothing, in words the model can act on and say. */
export const LINEAR_UNAVAILABLE = {
  NOT_CONNECTED:
    "Linear is not connected for this account. The developer can connect it in Luke's account settings; carry on without it.",
  EXPIRED:
    "Linear's sign-in for this account has expired. The developer can connect it again in Luke's account settings; carry on without it.",
  NOT_CONFIGURED: "Linear is not set up on this deployment of Luke; carry on without it.",
  UNREACHABLE:
    "Luke could not reach Linear's sign-in service just now. Try once more later, or carry on without it.",
  NO_ACCOUNT: "This session stands for no account that can use Linear.",
} as const;

type LinearUnavailable = (typeof LINEAR_UNAVAILABLE)[keyof typeof LINEAR_UNAVAILABLE];

/** The credential eve sends Linear: the token in the clear, which is the one place it is. */
interface LinearTokenResult {
  readonly token: string;
  readonly expiresAt: number;
}

/** How a host admits the session a connection is opened under: the root's own standing, or a worker's ownership alone. */
export type LinearAdmission = Effect.Effect<
  ConversationAdmission,
  SqlError | Schema.SchemaError,
  SqlClient.SqlClient
>;

/** What the token read answers: the credential, or why there is none. */
export type LinearTokenAnswer = Result.Result<LinearTokenResult, LinearUnavailable>;

/** The account's token while its row stands connected; any other row, or none, is why not. */
const connectedToken = /* @__PURE__ */ Effect.fnUntraced(function* (userId: string) {
  const row = yield* readLinearConnection(userId);
  if (row?.status !== LINEAR_ROW_STATUS.CONNECTED) {
    return Result.fail(
      row?.status === LINEAR_ROW_STATUS.EXPIRED
        ? LINEAR_UNAVAILABLE.EXPIRED
        : LINEAR_UNAVAILABLE.NOT_CONNECTED,
    );
  }
  const connect = yield* LinearConnect;
  const issued = yield* Effect.result(connect.token(userId, { fresh: false }));
  if (Result.isFailure(issued)) {
    switch (issued.failure.reason) {
      case LINEAR_CONNECT_FAILURE.NOT_AUTHORIZED:
        // Connect holds no grant to use, so the account is told so in settings too.
        yield* expireLinearConnection(userId);
        return Result.fail(LINEAR_UNAVAILABLE.EXPIRED);
      case LINEAR_CONNECT_FAILURE.NOT_CONFIGURED:
        return Result.fail(LINEAR_UNAVAILABLE.NOT_CONFIGURED);
      case LINEAR_CONNECT_FAILURE.UNAVAILABLE:
        yield* Effect.logWarning("Vercel Connect gave no Linear token", issued.failure.message);
        return Result.fail(LINEAR_UNAVAILABLE.UNREACHABLE);
    }
  }
  // A Disconnect that landed while Connect answered wins over the token it answered.
  const standing = yield* readLinearConnection(userId);
  if (standing?.status !== LINEAR_ROW_STATUS.CONNECTED) {
    return Result.fail(LINEAR_UNAVAILABLE.NOT_CONNECTED);
  }
  return Result.succeed({
    token: Redacted.value(issued.success.token),
    expiresAt: issued.success.expiresAt,
  });
});

/**
 * The Linear token for the account the session was admitted for, or the
 * sentence saying why there is none. The account is the admitted
 * conversation's owner and nothing the session's principal names; a store
 * the read cannot reach fails the call like Connect being unreachable.
 */
export function linearAccessToken(
  admission: LinearAdmission,
): Effect.Effect<LinearTokenAnswer, never, SqlClient.SqlClient | LinearConnect> {
  return Effect.gen(function* () {
    const admitted = yield* admission;
    if (Result.isFailure(admitted)) return Result.fail(LINEAR_UNAVAILABLE.NO_ACCOUNT);
    return yield* connectedToken(admitted.success.target.userId);
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.as(
        Effect.logWarning(`the Linear connection could not be read: ${causeKind(cause)}`),
        Result.fail(LINEAR_UNAVAILABLE.UNREACHABLE),
      ),
    ),
  );
}

/** How an agent's edge reads the token for one session: its own admission, run where the edge runs effects. */
export type LinearTokenRead = (auth: SessionAuth, sessionId: string) => Promise<LinearTokenAnswer>;

/**
 * The connection one agent registers, over the token read its edge composed
 * with that agent's ownership check. The read runs inside eve's turn, given
 * the session the connection is opened under; a refusal is thrown as its
 * sentence, which is the call's error and nothing more.
 */
export function linearConnection(read: LinearTokenRead): McpClientConnectionDefinition {
  return defineMcpClientConnection({
    url: LINEAR_MCP.URL,
    description: LINEAR_MCP.DESCRIPTION,
    auth: (ctx) => ({
      credentialOwner: "app",
      getToken: async () => {
        const answer = await read(ctx.session.auth, ctx.session.id);
        if (Result.isFailure(answer)) throw new Error(answer.failure);
        return answer.success;
      },
    }),
  });
}
