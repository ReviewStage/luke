import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTION_OUTPUT,
  ACTION_OUTPUT_STATUS,
  ACTION_REFUSAL,
  type CarriedActionResult,
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
  SESSION_CONTROL_KIND,
  SESSION_STATUS,
  type Session,
  WORKSPACE_TASK_SUPPORT,
} from "@sidecar/session";
import { ACTION_RESULT_STATUS, UNKNOWN_ACTION_STATUS, type WireRecord } from "@sidecar/wire";
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
  name: REALTIME_TOOL.RUN_SESSION_CONTROL,
  argumentsJson: `{${IDENTITY},"control_id":"stop"}`,
};

/** The one performer fake, answering every carried action with the result the test chose. */
function performer(
  overrides: Partial<BrainActionPerformerDependencies> = {},
  answer: (action: CarriedSessionAction | CarriedIssueAction) => CarriedActionResult = () => ({
    status: ACTION_RESULT_STATUS.ACCEPTED,
  }),
) {
  const performed: (CarriedSessionAction | CarriedIssueAction)[] = [];
  const recorded: ConversationEntry[] = [];
  const appActions: BrainAppActionRequest["action"][] = [];
  let facts: readonly RememberedFact[] = [];
  const dependencies: BrainActionPerformerDependencies = {
    sessionActions: {
      perform: async (action) => {
        performed.push(action);
        return answer(action);
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
  // The ask is recorded as the developer's, before the outcome is known.
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0]?.kind, "action");

  const stranger = await actions.perform(
    {
      name: REALTIME_TOOL.SEND_SESSION_MESSAGE,
      argumentsJson: '{"provider_id":"claude-code","provider_session_id":"ghost","text":"hi"}',
    },
    LIVE,
  );
  assert.equal(stranger.status, ACTION_OUTPUT_STATUS.REFUSED);
  assert.equal(performed.length, 1);

  const unknown = await actions.perform({ name: "delete_everything", argumentsJson: "{}" }, LIVE);
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

  const sent = await actions.perform(MESSAGE_CALL, LIVE);
  assert.deepEqual(sent, {
    status: ACTION_OUTPUT_STATUS.ACCEPTED,
    target: {
      providerId: "claude-code",
      providerSessionId: "session-a",
      title: "Fix the flaky test",
      agentId: "cursor",
    },
  });

  const stopped = await actions.perform(CONTROL_CALL, LIVE);
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

  const created = await actions.perform(CREATE_CALL, LIVE);
  assert.deepEqual(created, {
    status: ACTION_OUTPUT_STATUS.ACCEPTED,
    target: { providerId: "conductor" },
    createdSession: { providerId: "conductor", providerSessionId: "workspace-9" },
  });

  for (const envelope of [sent, stopped, created]) {
    assert.deepEqual(ACTION_OUTPUT.parse(envelope), envelope);
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
  assert.deepEqual(await actions.perform(MESSAGE_CALL, LIVE), {
    status: ACTION_OUTPUT_STATUS.REFUSED,
    reason: "the provider said no",
    target,
  });
  assert.deepEqual(await actions.perform(MESSAGE_CALL, LIVE), {
    status: ACTION_OUTPUT_STATUS.REFUSED,
    reason: "no documented way in",
    target,
  });
  assert.deepEqual(await actions.perform(MESSAGE_CALL, LIVE), {
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
  while (answers.length > 0) outcomes.push(await actions.perform(SETTING_CALL, LIVE));
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

test("an issue action is refused outright while no tracker is connected", async () => {
  const { actions, performed } = performer();
  const refused = await actions.perform(
    {
      name: REALTIME_TOOL.UPDATE_ISSUE_STATE,
      argumentsJson: '{"tracker_id":"linear","issue_id":"LUKE-1","state":"Done"}',
    },
    LIVE,
  );
  assert.equal(refused.status, ACTION_OUTPUT_STATUS.REFUSED);
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
  assert.equal(unlisted.status, ACTION_OUTPUT_STATUS.REFUSED);
  assert.equal(appActions.length, 1);
});

test("an action in a turn Luke opened himself runs under the same validators and is recorded as his own", async () => {
  const { actions, performed, recorded } = performer();
  const outcome = await actions.perform(MESSAGE_CALL, observationTurn());
  assert.equal(outcome.status, ACTION_RESULT_STATUS.ACCEPTED);
  assert.equal(performed.length, 1);
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0]?.kind, "own-action");
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
    refreshSessions: async () => {
      revoked = true;
    },
  });
  const refused = await actions.perform(
    MESSAGE_CALL,
    developerTurn(() => revoked),
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
  const refused = await actions.perform(
    CREATE_CALL,
    developerTurn(() => revoked),
  );
  assert.equal(refused.status, ACTION_OUTPUT_STATUS.REFUSED);
  assert.deepEqual(performed, []);
  assert.deepEqual(recorded, []);
});

test("a revoked turn reaches no memory write and no renderer action", async () => {
  const { actions, facts, appActions } = performer({ appGuide: () => CAPTIONS_GUIDE });
  const over = developerTurn(() => true);
  const notSaved = await actions.perform(REMEMBER_CALL, over);
  assert.equal(notSaved.status, ACTION_OUTPUT_STATUS.REFUSED);
  assert.deepEqual(facts(), []);
  const notChanged = await actions.perform(SETTING_CALL, over);
  assert.equal(notChanged.status, ACTION_OUTPUT_STATUS.REFUSED);
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
  assert.equal(refused.status, ACTION_OUTPUT_STATUS.REFUSED);
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
  assert.equal(refused.status, ACTION_OUTPUT_STATUS.REFUSED);
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
    assert.equal(outcome.status, ACTION_OUTPUT_STATUS.REFUSED);
    assert.deepEqual(h.performed, []);
    release?.();
    await drainMicrotasks(1);
    assert.deepEqual(h.performed, [], `${held}: the late read dispatched nothing`);
    assert.deepEqual(h.recorded, []);
  }
});
