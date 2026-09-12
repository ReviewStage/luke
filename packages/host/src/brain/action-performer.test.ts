import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  ACTION_KIND,
  ACTION_OUTPUT,
  ACTION_OUTPUT_STATUS,
  ACTION_REFUSAL,
  ACTION_TOOL,
  admitEffect,
  type CarriedActionResult,
  type CarriedSessionAction,
  type RememberedFact,
  type ValidatedAction,
} from "@sidecar/actions";
import type { BrainActionExecution } from "@sidecar/brain";
import type { BrainAppActionRequest } from "@sidecar/brain/requests-wire";
import { CAPTIONS_GUIDE, performCall } from "@sidecar/brain/testing";
import { APP_SETTING_KIND, EMPTY_APP_GUIDE } from "@sidecar/guide";
import { MAIN_SESSION_KEY, RUN_ORIGIN } from "@sidecar/runtime/vocabulary";
import type { ConversationEntry } from "@sidecar/session";
import {
  normalizeSession,
  type ObservedWorkspaceProject,
  SESSION_CONTROL_KIND,
  SESSION_STATUS,
  type Session,
  WORKSPACE_TASK_SUPPORT,
} from "@sidecar/session";
import { ACTION_RESULT_STATUS, UNKNOWN_ACTION_STATUS, type WireRecord } from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { Deferred, Effect, Either, Fiber, Option } from "effect";
import { test } from "vitest";
import {
  type BrainActionPerformerDependencies,
  createBrainActionPerformer,
} from "./action-performer.js";

const NOW = 1_800_000_000_000;

/** A developer-opened turn still standing, or one revoked from the moment `revoked()` first says so. */
function developerTurn(revoked: () => boolean = () => false): BrainActionExecution {
  return {
    conversationId: MAIN_SESSION_KEY,
    turnId: "run-1",
    runId: "run-1",
    origin: RUN_ORIGIN.USER,
    isRevoked: revoked,
    signal: new AbortController().signal,
  };
}

/** An observation turn's standing: the same shape, attributed to Luke's own judgment. */
function observationTurn(): BrainActionExecution {
  return {
    conversationId: MAIN_SESSION_KEY,
    turnId: "wake-1",
    runId: "wake-1",
    origin: RUN_ORIGIN.OBSERVATION,
    isRevoked: () => false,
    signal: new AbortController().signal,
  };
}

const LIVE = developerTurn();
const IDENTITY = '"provider_id":"claude-code","provider_session_id":"session-a"';
const MESSAGE_CALL = {
  name: ACTION_TOOL.SEND_SESSION_MESSAGE,
  argumentsJson: `{${IDENTITY},"text":"go ahead"}`,
};
const REMEMBER_CALL = {
  name: ACTION_TOOL.REMEMBER_FACT,
  argumentsJson: '{"words":"prefers concise answers"}',
};
const SETTING_CALL = {
  name: ACTION_TOOL.CHANGE_APP_SETTING,
  argumentsJson: '{"setting_id":"voice_captions","value":"on"}',
};
/** The one action whose admission reads the saved creation defaults as well as the roster. */
const CREATE_CALL = {
  name: ACTION_TOOL.CREATE_WORKSPACE,
  argumentsJson: '{"provider_id":"conductor","project_id":"luke"}',
};
const LISTED_PROJECT: ObservedWorkspaceProject = {
  providerId: "conductor",
  providerName: "Conductor",
  providerProjectId: "luke",
  repository: "luke",
  taskSupport: WORKSPACE_TASK_SUPPORT.OPTIONAL,
};

const STOP_CONTROL = {
  kind: ACTION_KIND.CONTROL,
  id: "stop",
  label: "Stop",
  controlKind: SESSION_CONTROL_KIND.STOP,
} as const;
const observed = normalizeSession(
  { id: "claude-code", displayName: "Claude Code" },
  {
    providerSessionId: "session-a",
    title: "Fix the flaky test",
    status: SESSION_STATUS.WAITING,
    lastActivityAt: NOW,
    agent: { id: "cursor", displayName: "Cursor" },
    advertises: [{ kind: ACTION_KIND.MESSAGE }, STOP_CONTROL],
  },
);
const CONTROL_CALL = {
  name: ACTION_TOOL.RUN_SESSION_CONTROL,
  argumentsJson: `{${IDENTITY},"control_id":"stop"}`,
};

/** Polls a condition on Effect's own fiber scheduler rather than a fixed wall-clock wait. */
function waitFor(condition: () => boolean, rounds = 300): Effect.Effect<void> {
  return Effect.gen(function* () {
    for (let round = 0; round < rounds; round += 1) {
      if (condition()) return;
      for (let tick = 0; tick < 100; tick += 1) yield* Effect.yieldNow();
    }
    assert.ok(condition(), "the condition did not hold in time");
  });
}

/** The one performer fake, answering every carried action with the result the test chose. */
function performer(
  overrides: Partial<BrainActionPerformerDependencies> = {},
  answer: (action: CarriedSessionAction) => CarriedActionResult = () => ({
    status: ACTION_RESULT_STATUS.ACCEPTED,
  }),
) {
  const performed: CarriedSessionAction[] = [];
  const recorded: ConversationEntry[] = [];
  const appActions: BrainAppActionRequest["action"][] = [];
  let facts: readonly RememberedFact[] = [];
  const dependencies: BrainActionPerformerDependencies = {
    sessionActions: {
      perform: (action) =>
        Effect.sync(() => {
          performed.push(action);
          return answer(action);
        }),
      openSession: () => Effect.succeed({ status: ACTION_RESULT_STATUS.ACCEPTED }),
      openSessionApplication: () => Effect.succeed({ status: ACTION_RESULT_STATUS.ACCEPTED }),
      openSessionChange: () => Effect.succeed({ status: ACTION_RESULT_STATUS.ACCEPTED }),
    },
    sessions: (): readonly Session[] => [observed],
    refreshSessions: () => Effect.void,
    workspaceProjects: () => [],
    workspaceDefaults: async () => ({}),
    appGuide: () => EMPTY_APP_GUIDE,
    rememberedFacts: () => facts,
    // A notebook fake with the worker's own rules: one line per words, a replaced entry gone first.
    notebook: {
      remember: async (ask) => {
        const retained = facts.filter((fact) => fact.id !== ask.replaces);
        if (ask.replaces !== undefined && retained.length === facts.length) return false;
        facts = retained.some((fact) => fact.words === ask.words)
          ? retained
          : [...retained, { id: ask.id, words: ask.words }];
        return true;
      },
      forget: async (id) => {
        if (!facts.some((fact) => fact.id === id)) return false;
        facts = facts.filter((fact) => fact.id !== id);
        return true;
      },
    },
    performAppAction: async (action) => {
      appActions.push(action);
      return { status: ACTION_RESULT_STATUS.ACCEPTED };
    },
    recordConversationEntry: (entry) => {
      recorded.push(entry);
    },
    ...overrides,
  };
  return {
    actions: createBrainActionPerformer(dependencies),
    performed,
    recorded,
    appActions,
    facts: () => facts,
  };
}

test("a session action reaches the performer only for a session the roster holds", async () => {
  const { actions, performed, recorded } = performer();
  const identity = '"provider_id":"claude-code","provider_session_id":"session-a"';

  const landed = await Effect.runPromise(
    performCall(
      actions,
      {
        name: ACTION_TOOL.SEND_SESSION_MESSAGE,
        argumentsJson: `{${identity},"text":"go ahead"}`,
      },
      LIVE,
    ),
  );
  assert.equal(landed.status, ACTION_RESULT_STATUS.ACCEPTED);
  assert.equal(performed.length, 1);
  assert.equal(performed[0]?.kind, "message");
  // The ask is recorded as the developer's, before the outcome is known.
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0]?.kind, "action");

  const stranger = await Effect.runPromise(
    performCall(
      actions,
      {
        name: ACTION_TOOL.SEND_SESSION_MESSAGE,
        argumentsJson: '{"provider_id":"claude-code","provider_session_id":"ghost","text":"hi"}',
      },
      LIVE,
    ),
  );
  assert.equal(stranger.status, ACTION_OUTPUT_STATUS.REFUSED);
  assert.equal(performed.length, 1);

  const unknown = await Effect.runPromise(
    performCall(actions, { name: "delete_everything", argumentsJson: "{}" }, LIVE),
  );
  assert.deepEqual(unknown, {
    status: ACTION_OUTPUT_STATUS.REFUSED,
    reason: ACTION_REFUSAL.NO_TOOL,
  });
});

test("every answer is the envelope: a session action's target as the roster held it, and the created session a creation named", async () => {
  const { actions } = performer({ workspaceProjects: () => [LISTED_PROJECT] }, (action) =>
    action.kind === ACTION_KIND.CREATE_WORKSPACE
      ? {
          status: ACTION_RESULT_STATUS.ACCEPTED,
          createdSession: { providerId: "conductor", providerSessionId: "workspace-9" },
        }
      : { status: ACTION_RESULT_STATUS.ACCEPTED },
  );

  const sent = await Effect.runPromise(performCall(actions, MESSAGE_CALL, LIVE));
  assert.deepEqual(sent, {
    status: ACTION_OUTPUT_STATUS.ACCEPTED,
    target: {
      providerId: "claude-code",
      providerSessionId: "session-a",
      title: "Fix the flaky test",
      agentId: "cursor",
    },
  });

  const stopped = await Effect.runPromise(performCall(actions, CONTROL_CALL, LIVE));
  assert.deepEqual(stopped, {
    status: ACTION_OUTPUT_STATUS.ACCEPTED,
    target: {
      providerId: "claude-code",
      providerSessionId: "session-a",
      title: "Fix the flaky test",
      agentId: "cursor",
      controlKind: SESSION_CONTROL_KIND.STOP,
      controlLabel: "Stop",
    },
  });

  const created = await Effect.runPromise(performCall(actions, CREATE_CALL, LIVE));
  assert.deepEqual(created, {
    status: ACTION_OUTPUT_STATUS.ACCEPTED,
    target: { providerId: "conductor" },
    createdSession: { providerId: "conductor", providerSessionId: "workspace-9" },
  });

  for (const envelope of [sent, stopped, created]) {
    assert.deepEqual(Either.getOrUndefined(readEither(ACTION_OUTPUT)(envelope)), envelope);
  }
});

test("a carried action's refusal and lost answer keep their words apart: refused folds the adapter's two words, unknown stays unknown", async () => {
  const outcomes: CarriedActionResult[] = [
    { status: ACTION_RESULT_STATUS.REJECTED, reason: "the provider said no" },
    { status: ACTION_RESULT_STATUS.UNSUPPORTED, reason: "no documented way in" },
    { status: UNKNOWN_ACTION_STATUS, reason: "the node went away" },
  ];
  const { actions } = performer({}, () => {
    const next = outcomes.shift();
    assert.ok(next);
    return next;
  });
  const target = {
    providerId: "claude-code",
    providerSessionId: "session-a",
    title: "Fix the flaky test",
    agentId: "cursor",
  };
  assert.deepEqual(await Effect.runPromise(performCall(actions, MESSAGE_CALL, LIVE)), {
    status: ACTION_OUTPUT_STATUS.REFUSED,
    reason: "the provider said no",
    target,
  });
  assert.deepEqual(await Effect.runPromise(performCall(actions, MESSAGE_CALL, LIVE)), {
    status: ACTION_OUTPUT_STATUS.REFUSED,
    reason: "no documented way in",
    target,
  });
  assert.deepEqual(await Effect.runPromise(performCall(actions, MESSAGE_CALL, LIVE)), {
    status: ACTION_OUTPUT_STATUS.UNKNOWN,
    reason: "the node went away",
    target,
  });
});

test("a panel's answer is read in its own dialect: an acceptance keeps its note and drops the rest, a lost answer stays unknown, and an unreadable shape is a refusal", async () => {
  const answers: WireRecord[] = [
    { status: ACTION_RESULT_STATUS.ACCEPTED, tab: "settings", kind: "setting" },
    { status: ACTION_RESULT_STATUS.ACCEPTED, note: "The ask is drafted in the composer." },
    { status: ACTION_RESULT_STATUS.ACCEPTED, outcome: "Up to date." },
    { status: UNKNOWN_ACTION_STATUS, reason: "the panel went away" },
    { status: ACTION_RESULT_STATUS.REJECTED },
    { outcome: "fine" },
  ];
  const { actions } = performer({
    appGuide: () => CAPTIONS_GUIDE,
    performAppAction: async () => answers.shift() ?? {},
  });
  const outcomes = [];
  while (answers.length > 0)
    outcomes.push(await Effect.runPromise(performCall(actions, SETTING_CALL, LIVE)));
  const unreadable = {
    status: ACTION_OUTPUT_STATUS.REFUSED,
    reason: "The panel answered in a shape this build cannot read.",
  };
  assert.deepEqual(outcomes, [
    { status: ACTION_OUTPUT_STATUS.ACCEPTED },
    { status: ACTION_OUTPUT_STATUS.ACCEPTED, note: "The ask is drafted in the composer." },
    { status: ACTION_OUTPUT_STATUS.ACCEPTED, note: "Up to date." },
    { status: ACTION_OUTPUT_STATUS.UNKNOWN, reason: "the panel went away" },
    unreadable,
    unreadable,
  ]);
});

test("memory actions are the main process's own, and the store's answer is the report", async () => {
  const { actions, facts, appActions } = performer();

  const saved = await Effect.runPromise(
    performCall(
      actions,
      {
        name: ACTION_TOOL.REMEMBER_FACT,
        argumentsJson: '{"words":"prefers concise answers"}',
      },
      LIVE,
    ),
  );
  assert.equal(saved.status, ACTION_RESULT_STATUS.ACCEPTED);
  assert.equal(facts().length, 1);
  const id = facts()[0]?.id;
  assert.ok(id);

  const forgotten = await Effect.runPromise(
    performCall(
      actions,
      {
        name: ACTION_TOOL.FORGET_FACT,
        argumentsJson: JSON.stringify({ id }),
      },
      LIVE,
    ),
  );
  assert.equal(forgotten.status, ACTION_RESULT_STATUS.ACCEPTED);
  assert.equal(facts().length, 0);
  // Nothing about memory ever crosses to a renderer.
  assert.equal(appActions.length, 0);
});

it.effect(
  "two conversations remembering at once both land: each write is one whole request to the notebook",
  () =>
    Effect.gen(function* () {
      let facts: readonly RememberedFact[] = [];
      const { actions } = performer({
        rememberedFacts: () => facts,
        notebook: {
          remember: async (ask) => {
            // The worker answers one request at a time; a beat's delay here shows
            // the performer never reads the list, computes, and writes it back.
            await new Promise<void>((resolve) => setImmediate(resolve));
            facts = [...facts, { id: ask.id, words: ask.words }];
            return true;
          },
          forget: async () => false,
        },
      });
      const [first, second] = yield* Effect.all(
        [
          performCall(
            actions,
            { name: ACTION_TOOL.REMEMBER_FACT, argumentsJson: '{"words":"from thread one"}' },
            LIVE,
          ),
          performCall(
            actions,
            { name: ACTION_TOOL.REMEMBER_FACT, argumentsJson: '{"words":"from thread two"}' },
            LIVE,
          ),
        ],
        { concurrency: "unbounded" },
      );
      assert.equal(first.status, ACTION_RESULT_STATUS.ACCEPTED);
      assert.equal(second.status, ACTION_RESULT_STATUS.ACCEPTED);
      assert.deepEqual(facts.map((fact) => fact.words).toSorted(), [
        "from thread one",
        "from thread two",
      ]);
    }),
);

test("an app action is validated against the reported guide before a renderer carries it", async () => {
  const guide = {
    facts: [],
    settings: [
      {
        id: "voice_captions",
        label: "Captions",
        description: "Luke's words on screen.",
        kind: APP_SETTING_KIND.TOGGLE,
        value: "off",
        defaultValue: "off",
        adjustable: true,
        manual: "the Voice page",
      },
    ],
  };
  const { actions, appActions } = performer({ appGuide: () => guide });

  const changed = await Effect.runPromise(
    performCall(
      actions,
      {
        name: ACTION_TOOL.CHANGE_APP_SETTING,
        argumentsJson: '{"setting_id":"voice_captions","value":"on"}',
      },
      LIVE,
    ),
  );
  assert.equal(changed.status, ACTION_RESULT_STATUS.ACCEPTED);
  assert.equal(appActions.length, 1);
  assert.equal(appActions[0]?.kind, "setting");

  const unlisted = await Effect.runPromise(
    performCall(
      actions,
      {
        name: ACTION_TOOL.CHANGE_APP_SETTING,
        argumentsJson: '{"setting_id":"launch_codes","value":"on"}',
      },
      LIVE,
    ),
  );
  assert.equal(unlisted.status, ACTION_OUTPUT_STATUS.REFUSED);
  assert.equal(appActions.length, 1);
});

test("an action in a turn Luke opened himself runs under the same validators and is recorded as his own", async () => {
  const { actions, performed, recorded } = performer();
  const outcome = await Effect.runPromise(performCall(actions, MESSAGE_CALL, observationTurn()));
  assert.equal(outcome.status, ACTION_RESULT_STATUS.ACCEPTED);
  assert.equal(performed.length, 1);
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0]?.kind, "own-action");
});

test("an admitted action with no turn standing is refused at the carrier, the host's last gate, before any effect", async () => {
  const { actions, performed, recorded, appActions, facts } = performer({
    appGuide: () => CAPTIONS_GUIDE,
  });
  const standing = {
    origin: RUN_ORIGIN.USER,
    roster: { read: () => Effect.succeed([observed]) },
    guide: CAPTIONS_GUIDE,
    rememberedFacts: [],
  };
  const admitted: readonly ValidatedAction[] = await Effect.runPromise(
    Effect.all([
      admitEffect(
        {
          kind: ACTION_KIND.MESSAGE,
          fields: {
            provider_id: "claude-code",
            provider_session_id: "session-a",
            text: "go ahead",
          },
        },
        standing,
      ),
      admitEffect(
        { kind: ACTION_KIND.REMEMBER, fields: { words: "prefers concise answers" } },
        standing,
      ),
      admitEffect(
        { kind: ACTION_KIND.SETTING, fields: { setting_id: "voice_captions", value: "on" } },
        standing,
      ),
    ]),
  );
  assert.equal(admitted.length, 3);
  // SAFETY: the carrier is the last gate before an effect and reads its
  // context as untrusted; these are the shapes a broken caller could hand it.
  const malformed = [
    undefined,
    null,
    {},
    {
      runId: "run-1",
      origin: "root",
      isRevoked: () => false,
      signal: new AbortController().signal,
    },
    { runId: "run-1", origin: RUN_ORIGIN.USER, signal: new AbortController().signal },
    {
      runId: "run-1",
      origin: RUN_ORIGIN.USER,
      isRevoked: true,
      signal: new AbortController().signal,
    },
    { origin: RUN_ORIGIN.USER, isRevoked: () => false, signal: new AbortController().signal },
  ] as unknown as BrainActionExecution[];
  for (const execution of malformed) {
    for (const action of admitted) {
      const refused = await Effect.runPromise(actions.carry(action, execution));
      assert.equal(refused.status, ACTION_OUTPUT_STATUS.REFUSED);
    }
  }
  assert.deepEqual(performed, []);
  assert.deepEqual(recorded, []);
  assert.deepEqual(appActions, []);
  assert.deepEqual(facts(), []);
});

test("a turn revoked while the roster refreshed is refused before the effect, and nothing is recorded", async () => {
  let revoked = false;
  const { actions, performed, recorded } = performer({
    refreshSessions: () =>
      Effect.sync(() => {
        revoked = true;
      }),
  });
  const refused = await Effect.runPromise(
    performCall(
      actions,
      MESSAGE_CALL,
      developerTurn(() => revoked),
    ),
  );
  assert.equal(refused.status, ACTION_OUTPUT_STATUS.REFUSED);
  assert.equal(refused.reason, ACTION_REFUSAL.TURN_OVER);
  assert.deepEqual(performed, []);
  assert.deepEqual(recorded, []);
});

test("a turn revoked while the creation defaults were read is refused before the effect", async () => {
  let revoked = false;
  const { actions, performed, recorded } = performer({
    workspaceProjects: () => [LISTED_PROJECT],
    workspaceDefaults: async () => {
      revoked = true;
      return {};
    },
  });
  const refused = await Effect.runPromise(
    performCall(
      actions,
      CREATE_CALL,
      developerTurn(() => revoked),
    ),
  );
  assert.equal(refused.status, ACTION_OUTPUT_STATUS.REFUSED);
  assert.deepEqual(performed, []);
  assert.deepEqual(recorded, []);
});

test("a revoked turn reaches no memory write and no renderer action", async () => {
  const { actions, facts, appActions } = performer({ appGuide: () => CAPTIONS_GUIDE });
  const over = developerTurn(() => true);
  const notSaved = await Effect.runPromise(performCall(actions, REMEMBER_CALL, over));
  assert.equal(notSaved.status, ACTION_OUTPUT_STATUS.REFUSED);
  assert.deepEqual(facts(), []);
  const notChanged = await Effect.runPromise(performCall(actions, SETTING_CALL, over));
  assert.equal(notChanged.status, ACTION_OUTPUT_STATUS.REFUSED);
  assert.deepEqual(appActions, []);
});

test("an action is validated against the roster as refreshed inside the turn, not as it stood before", async () => {
  let sessions: readonly Session[] = [observed];
  const { actions, performed } = performer({
    sessions: () => sessions,
    refreshSessions: () =>
      Effect.sync(() => {
        // The session is gone by the time the action is validated.
        sessions = [];
      }),
  });
  const refused = await Effect.runPromise(performCall(actions, MESSAGE_CALL, LIVE));
  assert.equal(refused.status, ACTION_OUTPUT_STATUS.REFUSED);
  assert.deepEqual(performed, []);
});

test("a creation is admitted against the projects the same pass reported, and the pass runs once", async () => {
  let projects: readonly ObservedWorkspaceProject[] = [];
  let passes = 0;
  const { actions, performed } = performer({
    workspaceProjects: () => projects,
    refreshSessions: () =>
      Effect.sync(() => {
        passes += 1;
        // The project is only offered once an observation pass has run.
        projects = [LISTED_PROJECT];
      }),
  });
  const created = await Effect.runPromise(performCall(actions, CREATE_CALL, LIVE));
  assert.equal(created.status, ACTION_RESULT_STATUS.ACCEPTED);
  assert.equal(passes, 1);
  assert.deepEqual(
    performed.map((performedAction) => performedAction.kind),
    [ACTION_KIND.CREATE_WORKSPACE],
  );
});

it.effect(
  "a cancel while the pass is out leaves the pass running: the wait ends, the observation does not",
  () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      let interrupted = false;
      let finished = false;
      const h = performer({
        refreshSessions: () =>
          Deferred.succeed(started, undefined).pipe(
            Effect.zipRight(Deferred.await(release)),
            Effect.zipRight(
              Effect.sync(() => {
                finished = true;
              }),
            ),
            Effect.onInterrupt(() =>
              Effect.sync(() => {
                interrupted = true;
              }),
            ),
          ),
      });
      const controller = new AbortController();
      const execution: BrainActionExecution = {
        conversationId: MAIN_SESSION_KEY,
        turnId: "run-1",
        runId: "run-1",
        origin: RUN_ORIGIN.USER,
        isRevoked: () => controller.signal.aborted,
        signal: controller.signal,
      };
      const pending = yield* Effect.fork(performCall(h.actions, MESSAGE_CALL, execution));
      yield* Deferred.await(started);
      controller.abort();
      const outcome = yield* Fiber.join(pending);
      assert.equal(outcome.status, ACTION_OUTPUT_STATUS.REFUSED);
      assert.equal(outcome.reason, ACTION_REFUSAL.TURN_OVER);
      assert.equal(interrupted, false);
      yield* Deferred.succeed(release, undefined);
      yield* waitFor(() => finished);
      assert.deepEqual(h.performed, []);
      assert.deepEqual(h.recorded, []);
    }),
);

it.effect(
  "a cancel during the roster refresh or the defaults read settles the action, and the late read dispatches nothing",
  () =>
    Effect.gen(function* () {
      for (const held of ["refreshSessions", "workspaceDefaults"] as const) {
        let release: (() => void) | undefined;
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        let invoked = false;
        let finished = false;
        const waits = async () => {
          invoked = true;
          await gate;
          finished = true;
        };
        const h = performer({
          workspaceProjects: () => [LISTED_PROJECT],
          ...(held === "refreshSessions"
            ? { refreshSessions: () => Effect.promise(waits) }
            : {
                workspaceDefaults: async () => {
                  await waits();
                  return {};
                },
              }),
        });
        const controller = new AbortController();
        const execution: BrainActionExecution = {
          conversationId: MAIN_SESSION_KEY,
          turnId: "run-1",
          runId: "run-1",
          origin: RUN_ORIGIN.USER,
          isRevoked: () => controller.signal.aborted,
          signal: controller.signal,
        };
        // Only a creation reads the defaults, so each held read is exercised by the
        // act that actually waits on it.
        const pending = yield* Effect.fork(
          performCall(
            h.actions,
            held === "refreshSessions" ? MESSAGE_CALL : CREATE_CALL,
            execution,
          ),
        );
        yield* waitFor(() => invoked);
        assert.equal(Option.isNone(yield* pending.poll), true);
        controller.abort();
        const outcome = yield* Fiber.join(pending);
        assert.equal(outcome.status, ACTION_OUTPUT_STATUS.REFUSED);
        assert.deepEqual(h.performed, []);
        release?.();
        yield* waitFor(() => finished);
        assert.deepEqual(h.performed, [], `${held}: the late read dispatched nothing`);
        assert.deepEqual(h.recorded, []);
      }
    }),
);
