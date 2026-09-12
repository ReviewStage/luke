import assert from "node:assert/strict";
import { describe, it } from "@effect/vitest";
import { RUN_ORIGIN } from "@sidecar/runtime/vocabulary";
import {
  normalizeSession,
  type ObservedWorkspaceProject,
  SESSION_CONTROL_KIND,
  SESSION_STATUS,
  type Session,
  WORKSPACE_TASK_SUPPORT,
} from "@sidecar/session";
import { Cause, Deferred, Effect, Exit, Fiber } from "effect";
import { ACTION_KIND } from "./action-kinds.js";
import { ACTION_REFUSAL, type AdmitContext, AdmitRefusal, admitEffect } from "./admit.js";

/**
 * The gauntlet as an Effect: what it succeeds with, what it fails with, and
 * what it reads to decide. Each case asserts the refusal's tag and its reason
 * as values, because the reason is what the action journal records and Luke
 * says aloud.
 */

const NOW = 1_800_000_000_000;

const IDENTITY = { provider_id: "conductor", provider_session_id: "chat-1" };

function offering(): Session {
  return normalizeSession(
    { id: "conductor", displayName: "Conductor" },
    {
      providerSessionId: "chat-1",
      title: "Conductor: luke",
      status: SESSION_STATUS.WAITING,
      lastActivityAt: NOW,
      advertises: [
        { kind: ACTION_KIND.MESSAGE },
        {
          kind: ACTION_KIND.CONTROL,
          id: "cancel-run",
          label: "Stop this run",
          controlKind: SESSION_CONTROL_KIND.STOP,
        },
      ],
      detail: { link: "https://app.conductor.build/sessions/chat-1" },
    },
  );
}

function context(
  options: { sessions?: readonly Session[]; guard?: AdmitContext["guard"] } = {},
): AdmitContext & { rosterReads(): number } {
  let reads = 0;
  const sessions = options.sessions ?? [offering()];
  return {
    origin: RUN_ORIGIN.USER,
    ...(options.guard ? { guard: options.guard } : undefined),
    roster: {
      read: () =>
        Effect.sync(() => {
          reads += 1;
          return sessions;
        }),
    },
    rosterReads: () => reads,
  };
}

const MESSAGE = { kind: ACTION_KIND.MESSAGE, fields: { ...IDENTITY, text: "add tests too" } };

const LISTED_PROJECT: ObservedWorkspaceProject = {
  providerId: "conductor",
  providerName: "Conductor",
  providerProjectId: "luke",
  repository: "luke",
  taskSupport: WORKSPACE_TASK_SUPPORT.OPTIONAL,
};

const CREATE = {
  kind: ACTION_KIND.CREATE_WORKSPACE,
  fields: { provider_id: "conductor", project_id: "luke" },
};

/** A context whose projects and defaults are effects of their own, each counting its runs. */
function offeringProjects(): AdmitContext & {
  projectReads(): number;
  defaultsReads(): number;
} {
  let projectReads = 0;
  let defaultsReads = 0;
  return {
    origin: RUN_ORIGIN.USER,
    roster: { read: () => Effect.succeed([offering()]) },
    projects: {
      read: () =>
        Effect.sync(() => {
          projectReads += 1;
          return [LISTED_PROJECT];
        }),
      defaults: () =>
        Effect.sync(() => {
          defaultsReads += 1;
          return {};
        }),
      agentModels: () => [],
    },
    projectReads: () => projectReads,
    defaultsReads: () => defaultsReads,
  };
}

describe("admitEffect", () => {
  it.effect("succeeds with the payload the admitter built, stamped with the turn's origin", () =>
    Effect.gen(function* () {
      const standing = context();
      const admitted = yield* admitEffect(MESSAGE, standing);
      assert.deepEqual(admitted, {
        kind: ACTION_KIND.MESSAGE,
        identity: { providerId: "conductor", providerSessionId: "chat-1" },
        text: "add tests too",
        origin: RUN_ORIGIN.USER,
      });
      assert.equal(standing.rosterReads(), 1);
    }),
  );

  it.effect("fails with the refusal when the roster it reads holds no such target", () =>
    Effect.gen(function* () {
      const elsewhere = context({ sessions: [] });
      const refusal = yield* Effect.flip(admitEffect(MESSAGE, elsewhere));
      assert.equal(refusal._tag, "AdmitRefusal");
      assert.equal(refusal.reason, ACTION_REFUSAL.NO_SESSION);
      assert.equal(elsewhere.rosterReads(), 1);
    }),
  );

  it.effect(
    "reads the roster for itself, so a target the caller was shown but the roster lost is refused",
    () =>
      Effect.gen(function* () {
        const shown = offering();
        const moved = normalizeSession(
          { id: "conductor", displayName: "Conductor" },
          {
            providerSessionId: "chat-2",
            title: shown.title,
            status: SESSION_STATUS.WAITING,
            lastActivityAt: NOW,
          },
        );
        const stale = context({ sessions: [moved] });
        const refusal = yield* Effect.flip(admitEffect(MESSAGE, stale));
        assert.equal(refusal._tag, "AdmitRefusal");
        assert.equal(refusal.reason, ACTION_REFUSAL.NO_SESSION);
      }),
  );

  it.effect("fails with the turn over, reading nothing, when the guard is already revoked", () =>
    Effect.gen(function* () {
      const revoked = context({ guard: { isRevoked: () => true } });
      const refusal = yield* Effect.flip(admitEffect(MESSAGE, revoked));
      assert.equal(refusal._tag, "AdmitRefusal");
      assert.equal(refusal.reason, ACTION_REFUSAL.TURN_OVER);
      assert.equal(revoked.rosterReads(), 0);
    }),
  );

  it.effect("fails with the turn over when the turn ends while the roster is read", () =>
    Effect.gen(function* () {
      let over = false;
      const controller = new AbortController();
      const refusal = yield* Effect.flip(
        admitEffect(MESSAGE, {
          origin: RUN_ORIGIN.USER,
          guard: { isRevoked: () => over, signal: controller.signal },
          roster: {
            read: () =>
              Effect.sync(() => {
                over = true;
                return [offering()];
              }),
          },
        }),
      );
      assert.equal(refusal.reason, ACTION_REFUSAL.TURN_OVER);
    }),
  );

  it.effect(
    "fails with the advertisement's refusal for an action the session does not advertise",
    () =>
      Effect.gen(function* () {
        const refusal = yield* Effect.flip(
          admitEffect(
            { kind: ACTION_KIND.CONTROL, fields: { ...IDENTITY, control_id: "terminate" } },
            context(),
          ),
        );
        assert.equal(refusal.reason, ACTION_REFUSAL.NO_CONTROL);
      }),
  );

  it.effect("fails with the bound's refusal for the developer's own text past it", () =>
    Effect.gen(function* () {
      const refusal = yield* Effect.flip(
        admitEffect({ kind: ACTION_KIND.MESSAGE, fields: { ...IDENTITY, text: "   " } }, context()),
      );
      assert.equal(refusal.reason, ACTION_REFUSAL.MESSAGE_BOUND);
    }),
  );

  it.effect("carries a roster read's own failure as a defect, never as a refusal", () =>
    Effect.gen(function* () {
      const failure = new Error("roster offline");
      const exit = yield* Effect.exit(
        admitEffect(MESSAGE, {
          origin: RUN_ORIGIN.USER,
          roster: { read: () => Effect.promise(() => Promise.reject(failure)) },
        }),
      );
      assert.ok(Exit.isFailure(exit));
      assert.equal(Cause.isDie(exit.cause), true);
      assert.equal(Cause.squash(exit.cause), failure);
    }),
  );

  it.effect("reads the roster once however many admitters ask for it", () =>
    Effect.gen(function* () {
      const standing = context();
      yield* admitEffect({ kind: ACTION_KIND.PANEL, fields: { filters: ["conductor"] } }, standing);
      assert.equal(standing.rosterReads(), 1);
    }),
  );

  it.effect("runs the projects read and the defaults read once each for a creation", () =>
    Effect.gen(function* () {
      const standing = offeringProjects();
      const admitted = yield* admitEffect(CREATE, standing);
      assert.equal(admitted.kind, ACTION_KIND.CREATE_WORKSPACE);
      assert.equal(admitted.providerProjectId, LISTED_PROJECT.providerProjectId);
      assert.equal(standing.projectReads(), 1);
      assert.equal(standing.defaultsReads(), 1);
    }),
  );

  it.effect("runs neither projects read for an action that names no project", () =>
    Effect.gen(function* () {
      const standing = offeringProjects();
      yield* admitEffect(MESSAGE, standing);
      assert.equal(standing.projectReads(), 0);
      assert.equal(standing.defaultsReads(), 0);
    }),
  );

  it.effect("interrupts a read still out when the guard's signal fires, and refuses the turn", () =>
    Effect.gen(function* () {
      const controller = new AbortController();
      const started = yield* Deferred.make<void>();
      let interrupted = false;
      const held: Effect.Effect<readonly Session[]> = Effect.zipRight(
        Deferred.succeed(started, undefined),
        Effect.never,
      ).pipe(
        Effect.onInterrupt(() =>
          Effect.sync(() => {
            interrupted = true;
          }),
        ),
      );
      const admitting = yield* Effect.fork(
        Effect.flip(
          admitEffect(MESSAGE, {
            origin: RUN_ORIGIN.USER,
            guard: { isRevoked: () => controller.signal.aborted, signal: controller.signal },
            roster: { read: () => held },
          }),
        ),
      );
      yield* Deferred.await(started);
      controller.abort();
      const refusal = yield* Fiber.join(admitting);
      assert.equal(refusal.reason, ACTION_REFUSAL.TURN_OVER);
      assert.equal(interrupted, true);
    }),
  );

  it.effect("answers a caller that admits inside an uninterruptible region", () =>
    Effect.gen(function* () {
      const controller = new AbortController();
      const admitted = yield* Effect.uninterruptible(
        admitEffect(MESSAGE, {
          origin: RUN_ORIGIN.USER,
          guard: { isRevoked: () => controller.signal.aborted, signal: controller.signal },
          roster: { read: () => Effect.succeed([offering()]) },
        }),
      );
      assert.equal(admitted.kind, ACTION_KIND.MESSAGE);
    }),
  );
});

it("AdmitRefusal is the tagged error the gauntlet fails with", () => {
  const refusal = new AdmitRefusal({ reason: ACTION_REFUSAL.NO_SESSION });
  assert.equal(refusal._tag, "AdmitRefusal");
  assert.equal(refusal.reason, ACTION_REFUSAL.NO_SESSION);
});
