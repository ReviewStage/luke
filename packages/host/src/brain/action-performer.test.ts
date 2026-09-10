import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTION_REFUSAL,
  type CarriedIssueAction,
  type CarriedSessionAction,
  REALTIME_TOOL,
  type RememberedFact,
} from "@sidecar/actions";
import type { BrainActionExecution } from "@sidecar/brain";
import type { BrainAppActionRequest } from "@sidecar/brain/requests-wire";
import { APP_SETTING_KIND, EMPTY_APP_GUIDE } from "@sidecar/guide";
import { drainMicrotasks } from "@sidecar/runtime/testing";
import { RUN_ORIGIN } from "@sidecar/runtime/vocabulary";
import type { ConversationEntry } from "@sidecar/session";
import {
  ACTION_KIND,
  normalizeSession,
  type ObservedWorkspaceProject,
  SESSION_STATUS,
  type Session,
  WORKSPACE_TASK_SUPPORT,
} from "@sidecar/session";
import { ACTION_RESULT_STATUS, UNKNOWN_ACTION_STATUS } from "@sidecar/wire";
import {
  type BrainActionPerformerDependencies,
  createBrainActionPerformer,
} from "./action-performer.js";

const NOW = 1_800_000_000_000;

/** A developer-opened turn still standing, or one revoked from the moment `revoked()` first says so. */
function developerTurn(revoked: () => boolean = () => false): BrainActionExecution {
  return {
    runId: "run-1",
    origin: RUN_ORIGIN.USER,
    isRevoked: revoked,
    signal: new AbortController().signal,
  };
}

/** An observation turn's standing: the same shape, attributed to Luke's own judgment. */
function observationTurn(): BrainActionExecution {
  return {
    runId: "wake-1",
    origin: RUN_ORIGIN.OBSERVATION,
    isRevoked: () => false,
    signal: new AbortController().signal,
  };
}

const LIVE = developerTurn();
const IDENTITY = '"provider_id":"claude-code","provider_session_id":"session-a"';
const MESSAGE_CALL = {
  name: REALTIME_TOOL.SEND_SESSION_MESSAGE,
  argumentsJson: `{${IDENTITY},"text":"go ahead"}`,
};
const REMEMBER_CALL = {
  name: REALTIME_TOOL.REMEMBER_FACT,
  argumentsJson: '{"words":"prefers concise answers"}',
};
const CAPTIONS_GUIDE = {
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
const SETTING_CALL = {
  name: REALTIME_TOOL.CHANGE_APP_SETTING,
  argumentsJson: '{"setting_id":"voice_captions","value":"on"}',
};
/** The one action whose admission reads the saved creation defaults as well as the roster. */
const CREATE_CALL = {
  name: REALTIME_TOOL.CREATE_WORKSPACE,
  argumentsJson: '{"provider_id":"conductor","project_id":"luke"}',
};
const LISTED_PROJECT: ObservedWorkspaceProject = {
  providerId: "conductor",
  providerName: "Conductor",
  providerProjectId: "luke",
  repository: "luke",
  taskSupport: WORKSPACE_TASK_SUPPORT.OPTIONAL,
};

const observed = normalizeSession(
  { id: "claude-code", displayName: "Claude Code" },
  {
    providerSessionId: "session-a",
    title: "Fix the flaky test",
    status: SESSION_STATUS.WAITING,
    lastActivityAt: NOW,
    advertises: [{ kind: ACTION_KIND.MESSAGE }],
  },
);

function performer(overrides: Partial<BrainActionPerformerDependencies> = {}) {
  const performed: (CarriedSessionAction | CarriedIssueAction)[] = [];
  const recorded: ConversationEntry[] = [];
  const appActions: BrainAppActionRequest["action"][] = [];
  let facts: readonly RememberedFact[] = [];
  const dependencies: BrainActionPerformerDependencies = {
    sessionActions: {
      perform: async (action) => {
        performed.push(action);
        return { status: ACTION_RESULT_STATUS.ACCEPTED };
      },
      openSession: async () => ({ status: ACTION_RESULT_STATUS.ACCEPTED }),
      openSessionApplication: async () => ({ status: ACTION_RESULT_STATUS.ACCEPTED }),
      openSessionChange: async () => ({ status: ACTION_RESULT_STATUS.ACCEPTED }),
    },
    sessions: (): readonly Session[] => [observed],
    refreshSessions: async () => {},
    workspaceProjects: () => [],
    workspaceDefaults: async () => ({}),
    trackedIssues: () => undefined,
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

  const landed = await actions.perform(
    {
      name: REALTIME_TOOL.SEND_SESSION_MESSAGE,
      argumentsJson: `{${identity},"text":"go ahead"}`,
    },
    LIVE,
  );
  assert.equal(landed.status, ACTION_RESULT_STATUS.ACCEPTED);
  assert.equal(performed.length, 1);
  assert.equal(performed[0]?.kind, "message");
  // The act is recorded as the developer's once the provider accepted it, and
  // names the run that carried it, so the panel can fold the turn's actions.
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0]?.kind, "action");
  assert.deepEqual(recorded[0]?.action, {
    kind: "message",
    runId: LIVE.runId,
    text: "go ahead",
    title: "Fix the flaky test",
  });

  const stranger = await actions.perform(
    {
      name: REALTIME_TOOL.SEND_SESSION_MESSAGE,
      argumentsJson: '{"provider_id":"claude-code","provider_session_id":"ghost","text":"hi"}',
    },
    LIVE,
  );
  assert.equal(stranger.status, ACTION_RESULT_STATUS.REJECTED);
  assert.equal(performed.length, 1);

  const unknown = await actions.perform({ name: "delete_everything", argumentsJson: "{}" }, LIVE);
  assert.deepEqual(unknown, {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: "No such tool exists.",
  });
});

test("a creation's line names the session the provider made, and the model's answer does not", async () => {
  const { actions, recorded } = performer({
    workspaceProjects: () => [LISTED_PROJECT],
    sessionActions: {
      perform: async () => ({
        status: ACTION_RESULT_STATUS.ACCEPTED,
        createdSession: {
          providerId: "conductor",
          providerSessionId: "created-1",
          agentId: "claude",
        },
      }),
      openSession: async () => ({ status: ACTION_RESULT_STATUS.ACCEPTED }),
      openSessionApplication: async () => ({ status: ACTION_RESULT_STATUS.ACCEPTED }),
      openSessionChange: async () => ({ status: ACTION_RESULT_STATUS.ACCEPTED }),
    },
  });
  const answer = await actions.perform(CREATE_CALL, LIVE);
  assert.deepEqual(answer, { status: ACTION_RESULT_STATUS.ACCEPTED });
  assert.equal(recorded.length, 1);
  assert.deepEqual(recorded[0]?.identity, {
    providerId: "conductor",
    providerSessionId: "created-1",
  });
  assert.equal(recorded[0]?.action?.agentId, "claude");
});

test("a session action the provider refused leaves no line, and one whose answer never came back does", async () => {
  const refusing = performer({
    sessionActions: {
      perform: async () => ({ status: ACTION_RESULT_STATUS.REJECTED, reason: "Not now." }),
      openSession: async () => ({ status: ACTION_RESULT_STATUS.ACCEPTED }),
      openSessionApplication: async () => ({ status: ACTION_RESULT_STATUS.ACCEPTED }),
      openSessionChange: async () => ({ status: ACTION_RESULT_STATUS.ACCEPTED }),
    },
  });
  const refused = await refusing.actions.perform(MESSAGE_CALL, LIVE);
  assert.equal(refused.status, ACTION_RESULT_STATUS.REJECTED);
  assert.deepEqual(refusing.recorded, []);

  const uncertain = performer({
    sessionActions: {
      perform: async () => ({ status: UNKNOWN_ACTION_STATUS, reason: "The connection closed." }),
      openSession: async () => ({ status: ACTION_RESULT_STATUS.ACCEPTED }),
      openSessionApplication: async () => ({ status: ACTION_RESULT_STATUS.ACCEPTED }),
      openSessionChange: async () => ({ status: ACTION_RESULT_STATUS.ACCEPTED }),
    },
  });
  const unknown = await uncertain.actions.perform(MESSAGE_CALL, LIVE);
  assert.equal(unknown.status, UNKNOWN_ACTION_STATUS);
  // The act may have landed, so the thread says it was taken; the reply carries the doubt.
  assert.equal(uncertain.recorded.length, 1);
  assert.equal(uncertain.recorded[0]?.kind, "action");
});

test("an issue action is refused outright while no tracker is connected", async () => {
  const { actions, performed } = performer();
  const refused = await actions.perform(
    {
      name: REALTIME_TOOL.UPDATE_ISSUE_STATE,
      argumentsJson: '{"tracker_id":"linear","issue_id":"LUKE-1","state":"Done"}',
    },
    LIVE,
  );
  assert.equal(refused.status, ACTION_RESULT_STATUS.REJECTED);
  assert.equal(performed.length, 0);
});

test("memory actions are the main process's own, and the store's answer is the report", async () => {
  const { actions, facts, appActions } = performer();

  const saved = await actions.perform(
    {
      name: REALTIME_TOOL.REMEMBER_FACT,
      argumentsJson: '{"words":"prefers concise answers"}',
    },
    LIVE,
  );
  assert.equal(saved.status, ACTION_RESULT_STATUS.ACCEPTED);
  assert.equal(facts().length, 1);
  const id = facts()[0]?.id;
  assert.ok(id);

  const forgotten = await actions.perform(
    {
      name: REALTIME_TOOL.FORGET_FACT,
      argumentsJson: JSON.stringify({ id }),
    },
    LIVE,
  );
  assert.equal(forgotten.status, ACTION_RESULT_STATUS.ACCEPTED);
  assert.equal(facts().length, 0);
  // Nothing about memory ever crosses to a renderer.
  assert.equal(appActions.length, 0);
});

test("two conversations remembering at once both land: each write is one whole request to the notebook", async () => {
  let facts: readonly RememberedFact[] = [];
  const { actions } = performer({
    rememberedFacts: () => facts,
    notebook: {
      remember: async (ask) => {
        // The worker answers one request at a time; a beat's delay here shows
        // the performer never reads the list, computes, and writes it back.
        await drainMicrotasks(1);
        facts = [...facts, { id: ask.id, words: ask.words }];
        return true;
      },
      forget: async () => false,
    },
  });
  const [first, second] = await Promise.all([
    actions.perform(
      { name: REALTIME_TOOL.REMEMBER_FACT, argumentsJson: '{"words":"from thread one"}' },
      LIVE,
    ),
    actions.perform(
      { name: REALTIME_TOOL.REMEMBER_FACT, argumentsJson: '{"words":"from thread two"}' },
      LIVE,
    ),
  ]);
  assert.equal(first.status, ACTION_RESULT_STATUS.ACCEPTED);
  assert.equal(second.status, ACTION_RESULT_STATUS.ACCEPTED);
  assert.deepEqual(facts.map((fact) => fact.words).toSorted(), [
    "from thread one",
    "from thread two",
  ]);
});

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

  const changed = await actions.perform(
    {
      name: REALTIME_TOOL.CHANGE_APP_SETTING,
      argumentsJson: '{"setting_id":"voice_captions","value":"on"}',
    },
    LIVE,
  );
  assert.equal(changed.status, ACTION_RESULT_STATUS.ACCEPTED);
  assert.equal(appActions.length, 1);
  assert.equal(appActions[0]?.kind, "setting");

  const unlisted = await actions.perform(
    {
      name: REALTIME_TOOL.CHANGE_APP_SETTING,
      argumentsJson: '{"setting_id":"launch_codes","value":"on"}',
    },
    LIVE,
  );
  assert.equal(unlisted.status, ACTION_RESULT_STATUS.REJECTED);
  assert.equal(appActions.length, 1);
});

test("an action in a turn Luke opened himself runs under the same validators and is recorded as his own", async () => {
  const { actions, performed, recorded } = performer();
  const outcome = await actions.perform(MESSAGE_CALL, observationTurn());
  assert.equal(outcome.status, ACTION_RESULT_STATUS.ACCEPTED);
  assert.equal(performed.length, 1);
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0]?.kind, "own-action");
  assert.deepEqual(recorded[0]?.action, {
    kind: "message",
    runId: "wake-1",
    text: "go ahead",
    title: "Fix the flaky test",
  });
});

test("an action with no turn standing is refused in main before any validator or effect", async () => {
  const { actions, performed, recorded, appActions, facts } = performer({
    appGuide: () => CAPTIONS_GUIDE,
  });
  // SAFETY: the performer is the last gate before an effect and reads its
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
    for (const call of [MESSAGE_CALL, REMEMBER_CALL, SETTING_CALL]) {
      const refused = await actions.perform(call, execution);
      assert.equal(refused.status, ACTION_RESULT_STATUS.REJECTED);
      assert.ok(String(refused.reason).includes("standing of a turn"));
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
    refreshSessions: async () => {
      revoked = true;
    },
  });
  const refused = await actions.perform(
    MESSAGE_CALL,
    developerTurn(() => revoked),
  );
  assert.equal(refused.status, ACTION_RESULT_STATUS.REJECTED);
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
  const refused = await actions.perform(
    CREATE_CALL,
    developerTurn(() => revoked),
  );
  assert.equal(refused.status, ACTION_RESULT_STATUS.REJECTED);
  assert.deepEqual(performed, []);
  assert.deepEqual(recorded, []);
});

test("a revoked turn reaches no memory write and no renderer action", async () => {
  const { actions, facts, appActions } = performer({ appGuide: () => CAPTIONS_GUIDE });
  const over = developerTurn(() => true);
  const notSaved = await actions.perform(REMEMBER_CALL, over);
  assert.equal(notSaved.status, ACTION_RESULT_STATUS.REJECTED);
  assert.deepEqual(facts(), []);
  const notChanged = await actions.perform(SETTING_CALL, over);
  assert.equal(notChanged.status, ACTION_RESULT_STATUS.REJECTED);
  assert.deepEqual(appActions, []);
});

test("an action is validated against the roster as refreshed inside the turn, not as it stood before", async () => {
  let sessions: readonly Session[] = [observed];
  const { actions, performed } = performer({
    sessions: () => sessions,
    refreshSessions: async () => {
      // The session is gone by the time the action is validated.
      sessions = [];
    },
  });
  const refused = await actions.perform(MESSAGE_CALL, LIVE);
  assert.equal(refused.status, ACTION_RESULT_STATUS.REJECTED);
  assert.deepEqual(performed, []);
});

test("a creation is admitted against the projects the same pass reported, and the pass runs once", async () => {
  let projects: readonly ObservedWorkspaceProject[] = [];
  let passes = 0;
  const { actions, performed } = performer({
    workspaceProjects: () => projects,
    refreshSessions: async () => {
      passes += 1;
      // The project is only offered once an observation pass has run.
      projects = [LISTED_PROJECT];
    },
  });
  const created = await actions.perform(CREATE_CALL, LIVE);
  assert.equal(created.status, ACTION_RESULT_STATUS.ACCEPTED);
  assert.equal(passes, 1);
  assert.deepEqual(
    performed.map((performedAction) => performedAction.kind),
    [ACTION_KIND.CREATE_WORKSPACE],
  );
});

test("an issue act observes nothing: no pass runs for an action the roster cannot answer for", async () => {
  let passes = 0;
  const { actions } = performer({
    refreshSessions: async () => {
      passes += 1;
    },
  });
  const refused = await actions.perform(
    { name: REALTIME_TOOL.COMMENT_ON_ISSUE, argumentsJson: "{}" },
    LIVE,
  );
  assert.equal(refused.status, ACTION_RESULT_STATUS.REJECTED);
  assert.equal(passes, 0);
});

test("a cancel during the roster refresh or the defaults read settles the action, and the late read dispatches nothing", async () => {
  for (const held of ["refreshSessions", "workspaceDefaults"] as const) {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const h = performer({
      workspaceProjects: () => [LISTED_PROJECT],
      [held]: async () => {
        await gate;
        return {};
      },
    });
    const controller = new AbortController();
    const execution: BrainActionExecution = {
      runId: "run-1",
      origin: RUN_ORIGIN.USER,
      isRevoked: () => controller.signal.aborted,
      signal: controller.signal,
    };
    // Only a creation reads the defaults, so each held read is exercised by the
    // act that actually waits on it.
    const pending = h.actions.perform(
      held === "refreshSessions" ? MESSAGE_CALL : CREATE_CALL,
      execution,
    );
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await drainMicrotasks(1);
    assert.equal(settled, false);
    controller.abort();
    const outcome = await pending;
    assert.equal(outcome.status, ACTION_RESULT_STATUS.REJECTED);
    assert.deepEqual(h.performed, []);
    release?.();
    await drainMicrotasks(1);
    assert.deepEqual(h.performed, [], `${held}: the late read dispatched nothing`);
    assert.deepEqual(h.recorded, []);
  }
});
