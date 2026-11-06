import type { DatabaseServices, QueryError } from "@repo/database/core/query";
import { type Agent, readAgent } from "@repo/database/models/agent-store";
import { recordedRuntimeSession } from "@repo/database/models/recorded-session";
import {
  nextSessionSandboxes,
  sessionSandboxDeferred,
  sessionSandboxDeleted,
} from "@repo/database/models/session-sandbox-cleanup";
import { Clock, Context, Duration, Effect, Layer, Option, Result, type Schema } from "effect";
import { afterResponse } from "../http/after-response.js";
import { agentDriveName } from "./agent-drive.js";
import { discardedOrLogged } from "./device-discard.js";
import { sandboxFirewall } from "./sandbox-firewall.js";
import { keepAliveExtension } from "./sandbox-keep-alive.js";
import {
  deploymentOidcToken,
  SANDBOX_STATUS,
  SandboxUnavailable,
  UP_STATUSES,
  type VercelSandboxApi,
  vercelSandboxApi,
} from "./vercel-sandbox-api.js";

const SESSION_SANDBOX_SWEEP = {
  MAX_SESSIONS: 20,
  CONCURRENCY: 5,
} as const;

const ARCHIVE_STOP = {
  TIMEOUT: Duration.seconds(15),
  CONCURRENCY: 5,
} as const;

export interface SessionSandboxesService {
  readonly keepAliveFor: (sessionId: string) => Effect.Effect<number, SandboxUnavailable>;
  readonly deleteFor: (sessionId: string) => Effect.Effect<number, SandboxUnavailable>;
  readonly stopFor: (
    sessionId: string,
  ) => Effect.Effect<number, SandboxUnavailable, DatabaseServices>;
}

export class SessionSandboxes extends Context.Service<SessionSandboxes, SessionSandboxesService>()(
  "SessionSandboxes",
) {}

function sessionSandboxesOver(api: VercelSandboxApi): SessionSandboxesService {
  return {
    keepAliveFor: (sessionId) =>
      Effect.gen(function* () {
        const sandboxes = yield* api.listTagged(sessionId);
        let extended = 0;
        for (const sandbox of sandboxes) {
          const running = sandbox.currentSessionId;
          const endsAt = sandbox.expiresAt;
          if (sandbox.status !== SANDBOX_STATUS.RUNNING || running === undefined) continue;
          if (endsAt === undefined) continue;
          const extension = keepAliveExtension(endsAt, yield* Clock.currentTimeMillis);
          if (extension === undefined) continue;
          const session = yield* api.session({ name: sandbox.name, sessionId: running });
          yield* session.extendTimeout(extension);
          extended += 1;
        }
        return extended;
      }),
    deleteFor: (sessionId) =>
      Effect.gen(function* () {
        const sandboxes = yield* api.listTagged(sessionId);
        for (const { name } of sandboxes) yield* api.deleteSandbox(name);
        yield* api.deleteDrive(agentDriveName(sessionId));
        return sandboxes.length;
      }),
    stopFor: (sessionId) =>
      Effect.gen(function* () {
        const sandboxes = yield* api.listTagged(sessionId);
        let stopped = 0;
        for (const sandbox of sandboxes) {
          const running = sandbox.currentSessionId;
          if (sandbox.status === undefined || !UP_STATUSES.has(sandbox.status)) continue;
          if (running === undefined) return yield* Effect.fail(new SandboxUnavailable({}));
          const session = { name: sandbox.name, sessionId: running };
          yield* sandboxFirewall(api).clear(session);
          yield* Effect.flatMap(api.session(session), (held) => held.stop());
          stopped += 1;
        }
        return stopped;
      }),
  };
}

export const sessionSandboxesLayer: Layer.Layer<SessionSandboxes> = Layer.effect(
  SessionSandboxes,
  Effect.map(vercelSandboxApi(deploymentOidcToken), sessionSandboxesOver),
);

export function keepSessionSandboxAlive(sessionId: string): Effect.Effect<void> {
  return Effect.flatMap(SessionSandboxes, (sandboxes) => sandboxes.keepAliveFor(sessionId)).pipe(
    Effect.provide(sessionSandboxesLayer),
    Effect.asVoid,
    Effect.catch((failure) =>
      Effect.logWarning(`a session's sandbox was not kept alive: ${failure.message}`),
    ),
  );
}

export interface SandboxStopReach {
  readonly sessionSandboxes: Layer.Layer<SessionSandboxes>;
  readonly keepAwake: <R>(work: Effect.Effect<void, never, R>) => Effect.Effect<void, never, R>;
}

export const deploymentSandboxStops: SandboxStopReach = {
  sessionSandboxes: sessionSandboxesLayer,
  keepAwake: (work) => afterResponse("an archived agent's sandbox stop", work),
};

function describeStopFailure(failure: {
  readonly _tag: string;
  readonly message?: string;
}): string {
  return failure._tag === "SandboxUnavailable" ? (failure.message ?? failure._tag) : failure._tag;
}

const stoppedWhileArchived = /* @__PURE__ */ Effect.fnUntraced(function* (
  agent: Pick<Agent, "id" | "userId">,
  sessionId: string,
) {
  const current = yield* readAgent(agent.userId, agent.id);
  if (Option.isNone(current) || current.value.archivedAt === null) return;
  yield* (yield* SessionSandboxes).stopFor(sessionId);
});

export const stoppedInBackground = /* @__PURE__ */ Effect.fnUntraced(function* (
  reach: SandboxStopReach,
  agents: ReadonlyArray<Pick<Agent, "id" | "userId" | "conversationId">>,
) {
  const read = yield* Effect.forEach(agents, (agent) =>
    recordedRuntimeSession(agent).pipe(
      Effect.catch((failure) =>
        Effect.as(
          Effect.logWarning(
            `an archived agent's sandbox was not found to stop: ${describeStopFailure(failure)}`,
          ),
          undefined,
        ),
      ),
    ),
  );
  const stops = agents.flatMap((agent, at) => {
    const sessionId = read[at];
    return sessionId === undefined ? [] : [{ agent, sessionId }];
  });
  const stopOne = ({ agent, sessionId }: (typeof stops)[number]) =>
    stoppedWhileArchived(agent, sessionId).pipe(
      Effect.provide(reach.sessionSandboxes),
      Effect.timeout(ARCHIVE_STOP.TIMEOUT),
      Effect.catch((failure) =>
        Effect.logWarning(
          `an archived agent's sandbox was not stopped: ${describeStopFailure(failure)}`,
        ),
      ),
    );
  yield* reach.keepAwake(
    Effect.all(
      [
        Effect.forEach(stops, stopOne, { concurrency: ARCHIVE_STOP.CONCURRENCY, discard: true }),
        Effect.forEach(agents, discardedOrLogged, {
          concurrency: ARCHIVE_STOP.CONCURRENCY,
          discard: true,
        }),
      ],
      { concurrency: 2, discard: true },
    ),
  );
});

export interface SessionSandboxSweepOutcome {
  deleted: number;
  pending: number;
}

const SESSION_ENDING = { DELETED: "deleted", PENDING: "pending" } as const;

type SessionEnding = (typeof SESSION_ENDING)[keyof typeof SESSION_ENDING];

const endSession = /* @__PURE__ */ Effect.fnUntraced(function* (
  sessionId: string,
  now: Date,
): Effect.fn.Return<
  SessionEnding,
  QueryError | Schema.SchemaError,
  SessionSandboxes | DatabaseServices
> {
  const sandboxes = yield* SessionSandboxes;
  const deleted = yield* Effect.result(sandboxes.deleteFor(sessionId));
  if (Result.isSuccess(deleted)) {
    yield* sessionSandboxDeleted(sessionId);
    return SESSION_ENDING.DELETED;
  }
  yield* Effect.logWarning(`a session's sandbox was not deleted: ${deleted.failure.message}`);
  yield* sessionSandboxDeferred(sessionId, now);
  return SESSION_ENDING.PENDING;
});

export const sweepSessionSandboxes = /* @__PURE__ */ Effect.fn("web/sweepSessionSandboxes")(
  function* (
    now: Date,
  ): Effect.fn.Return<
    SessionSandboxSweepOutcome,
    QueryError | Schema.SchemaError,
    SessionSandboxes | DatabaseServices
  > {
    const queued = yield* nextSessionSandboxes(SESSION_SANDBOX_SWEEP.MAX_SESSIONS);
    const endings = yield* Effect.forEach(queued, (sessionId) => endSession(sessionId, now), {
      concurrency: SESSION_SANDBOX_SWEEP.CONCURRENCY,
    });
    return {
      deleted: endings.filter((ending) => ending === SESSION_ENDING.DELETED).length,
      pending: endings.filter((ending) => ending === SESSION_ENDING.PENDING).length,
    };
  },
);
