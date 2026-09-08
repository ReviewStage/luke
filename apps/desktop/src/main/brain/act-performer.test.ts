import assert from "node:assert/strict";
import test from "node:test";
import {
  type CarriedIssueAction,
  type CarriedSessionAction,
  REALTIME_TOOL,
  type RememberedFact,
} from "@sidecar/acts";
import type { BrainActExecution } from "@sidecar/brain";
import { APP_SETTING_KIND, EMPTY_APP_GUIDE } from "@sidecar/guide";
import type { ConversationEntry } from "@sidecar/realtime";
import { RUN_ORIGIN } from "@sidecar/runtime-contracts";
import { normalizeSession, SESSION_STATUS, type Session } from "@sidecar/session";
import { ACT_RESULT_STATUS } from "@sidecar/wire";
import type { BrainAppActRequest } from "#shared/contracts";
import { type BrainActPerformerDependencies, createBrainActPerformer } from "./act-performer";

const NOW = 1_800_000_000_000;

/** A developer-opened turn still standing, or one revoked from the moment `revoked()` first says so. */
function developerTurn(revoked: () => boolean = () => false): BrainActExecution {
  return {
    runId: "run-1",
    origin: RUN_ORIGIN.USER,
    isRevoked: revoked,
    signal: new AbortController().signal,
  };
}

/** An observation turn's standing: the same shape, attributed to Luke's own judgment. */
function observationTurn(): BrainActExecution {
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

const observed = normalizeSession(
  { id: "claude-code", displayName: "Claude Code" },
  {
    providerSessionId: "session-a",
    title: "Fix the flaky test",
    status: SESSION_STATUS.WAITING,
    lastActivityAt: NOW,
    canReceiveMessage: true,
  },
);

function performer(overrides: Partial<BrainActPerformerDependencies> = {}) {
  const performed: (CarriedSessionAction | CarriedIssueAction)[] = [];
  const recorded: ConversationEntry[] = [];
  const appActs: BrainAppActRequest["action"][] = [];
  let facts: readonly RememberedFact[] = [];
  const dependencies: BrainActPerformerDependencies = {
    sessionActs: {
      perform: async (action) => {
        performed.push(action);
        return { status: ACT_RESULT_STATUS.ACCEPTED };
      },
      openSession: async () => ({ status: ACT_RESULT_STATUS.ACCEPTED }),
      openSessionApplication: async () => ({ status: ACT_RESULT_STATUS.ACCEPTED }),
      openSessionChange: async () => ({ status: ACT_RESULT_STATUS.ACCEPTED }),
    },
    sessions: (): readonly Session[] => [observed],
    refreshSessions: async () => {},
    workspaceProjects: () => [],
    workspaceDefaults: async () => ({}),
    trackedIssues: () => undefined,
    appGuide: () => EMPTY_APP_GUIDE,
    rememberedFacts: () => facts,
    mutateRememberedFacts: (work) =>
      work(facts, (next) => {
        facts = next;
        return true;
      }),
    performAppAct: async (action) => {
      appActs.push(action);
      return { status: ACT_RESULT_STATUS.ACCEPTED };
    },
    recordConversationEntry: (entry) => {
      recorded.push(entry);
    },
    ...overrides,
  };
  return {
    acts: createBrainActPerformer(dependencies),
    performed,
    recorded,
    appActs,
    facts: () => facts,
  };
}

test("a session act reaches the performer only for a session the roster holds", async () => {
  const { acts, performed, recorded } = performer();
  const identity = '"provider_id":"claude-code","provider_session_id":"session-a"';

  const landed = await acts.perform(
    {
      name: REALTIME_TOOL.SEND_SESSION_MESSAGE,
      argumentsJson: `{${identity},"text":"go ahead"}`,
    },
    LIVE,
  );
  assert.equal(landed.status, ACT_RESULT_STATUS.ACCEPTED);
  assert.equal(performed.length, 1);
  assert.equal(performed[0]?.kind, "message");
  // The ask is recorded as the developer's, before the outcome is known.
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0]?.kind, "act");

  const stranger = await acts.perform(
    {
      name: REALTIME_TOOL.SEND_SESSION_MESSAGE,
      argumentsJson: '{"provider_id":"claude-code","provider_session_id":"ghost","text":"hi"}',
    },
    LIVE,
  );
  assert.equal(stranger.status, ACT_RESULT_STATUS.REJECTED);
  assert.equal(performed.length, 1);

  const unknown = await acts.perform({ name: "delete_everything", argumentsJson: "{}" }, LIVE);
  assert.deepEqual(unknown, { status: ACT_RESULT_STATUS.REJECTED, reason: "No such tool exists." });
});

test("an issue act is refused outright while no tracker is connected", async () => {
  const { acts, performed } = performer();
  const refused = await acts.perform(
    {
      name: REALTIME_TOOL.UPDATE_ISSUE_STATE,
      argumentsJson: '{"tracker_id":"linear","issue_id":"LUKE-1","state":"Done"}',
    },
    LIVE,
  );
  assert.equal(refused.status, ACT_RESULT_STATUS.REJECTED);
  assert.equal(performed.length, 0);
});

test("memory acts are the main process's own, and the store's answer is the report", async () => {
  const { acts, facts, appActs } = performer();

  const saved = await acts.perform(
    {
      name: REALTIME_TOOL.REMEMBER_FACT,
      argumentsJson: '{"words":"prefers concise answers"}',
    },
    LIVE,
  );
  assert.equal(saved.status, ACT_RESULT_STATUS.ACCEPTED);
  assert.equal(facts().length, 1);
  const id = facts()[0]?.id;
  assert.ok(id);

  const forgotten = await acts.perform(
    {
      name: REALTIME_TOOL.FORGET_FACT,
      argumentsJson: JSON.stringify({ id }),
    },
    LIVE,
  );
  assert.equal(forgotten.status, ACT_RESULT_STATUS.ACCEPTED);
  assert.equal(facts().length, 0);
  // Nothing about memory ever crosses to a renderer.
  assert.equal(appActs.length, 0);
});

test("two conversations remembering at once both land when the host serializes the mutations", async () => {
  let facts: readonly RememberedFact[] = [];
  let mutations: Promise<unknown> = Promise.resolve();
  const slowWrite = async (next: readonly RememberedFact[]) => {
    // A store that answers a beat later, so an unserialized second read would still see the old list.
    await new Promise((resolve) => setImmediate(resolve));
    facts = next;
    return true;
  };
  const { acts } = performer({
    rememberedFacts: () => facts,
    mutateRememberedFacts: (work) => {
      const mutation = mutations.then(
        () => work(facts, slowWrite),
        () => work(facts, slowWrite),
      );
      mutations = mutation.catch(() => undefined);
      return mutation;
    },
  });
  const [first, second] = await Promise.all([
    acts.perform(
      { name: REALTIME_TOOL.REMEMBER_FACT, argumentsJson: '{"words":"from thread one"}' },
      LIVE,
    ),
    acts.perform(
      { name: REALTIME_TOOL.REMEMBER_FACT, argumentsJson: '{"words":"from thread two"}' },
      LIVE,
    ),
  ]);
  assert.equal(first.status, ACT_RESULT_STATUS.ACCEPTED);
  assert.equal(second.status, ACT_RESULT_STATUS.ACCEPTED);
  assert.deepEqual(facts.map((fact) => fact.words).toSorted(), [
    "from thread one",
    "from thread two",
  ]);
});

test("an app act is validated against the reported guide before a renderer carries it", async () => {
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
  const { acts, appActs } = performer({ appGuide: () => guide });

  const changed = await acts.perform(
    {
      name: REALTIME_TOOL.CHANGE_APP_SETTING,
      argumentsJson: '{"setting_id":"voice_captions","value":"on"}',
    },
    LIVE,
  );
  assert.equal(changed.status, ACT_RESULT_STATUS.ACCEPTED);
  assert.equal(appActs.length, 1);
  assert.equal(appActs[0]?.kind, "setting");

  const unlisted = await acts.perform(
    {
      name: REALTIME_TOOL.CHANGE_APP_SETTING,
      argumentsJson: '{"setting_id":"launch_codes","value":"on"}',
    },
    LIVE,
  );
  assert.equal(unlisted.status, ACT_RESULT_STATUS.REJECTED);
  assert.equal(appActs.length, 1);
});

test("an act in a turn Luke opened himself runs under the same validators and is recorded as his own", async () => {
  const { acts, performed, recorded } = performer();
  const outcome = await acts.perform(MESSAGE_CALL, observationTurn());
  assert.equal(outcome.status, ACT_RESULT_STATUS.ACCEPTED);
  assert.equal(performed.length, 1);
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0]?.kind, "own-act");
});

test("an act with no turn standing is refused in main before any validator or effect", async () => {
  const { acts, performed, recorded, appActs, facts } = performer({
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
  ] as unknown as BrainActExecution[];
  for (const execution of malformed) {
    for (const call of [MESSAGE_CALL, REMEMBER_CALL, SETTING_CALL]) {
      const refused = await acts.perform(call, execution);
      assert.equal(refused.status, ACT_RESULT_STATUS.REJECTED);
      assert.ok(String(refused.reason).includes("standing of a turn"));
    }
  }
  assert.deepEqual(performed, []);
  assert.deepEqual(recorded, []);
  assert.deepEqual(appActs, []);
  assert.deepEqual(facts(), []);
});

test("a turn revoked while the roster refreshed is refused before the effect, and nothing is recorded", async () => {
  let revoked = false;
  const { acts, performed, recorded } = performer({
    refreshSessions: async () => {
      revoked = true;
    },
  });
  const refused = await acts.perform(
    MESSAGE_CALL,
    developerTurn(() => revoked),
  );
  assert.equal(refused.status, ACT_RESULT_STATUS.REJECTED);
  assert.ok(String(refused.reason).includes("over"));
  assert.deepEqual(performed, []);
  assert.deepEqual(recorded, []);
});

test("a turn revoked while the creation defaults were read is refused before the effect", async () => {
  let revoked = false;
  const { acts, performed, recorded } = performer({
    workspaceDefaults: async () => {
      revoked = true;
      return {};
    },
  });
  const refused = await acts.perform(
    MESSAGE_CALL,
    developerTurn(() => revoked),
  );
  assert.equal(refused.status, ACT_RESULT_STATUS.REJECTED);
  assert.deepEqual(performed, []);
  assert.deepEqual(recorded, []);
});

test("a revoked turn reaches no memory write and no renderer act", async () => {
  const { acts, facts, appActs } = performer({ appGuide: () => CAPTIONS_GUIDE });
  const over = developerTurn(() => true);
  const notSaved = await acts.perform(REMEMBER_CALL, over);
  assert.equal(notSaved.status, ACT_RESULT_STATUS.REJECTED);
  assert.deepEqual(facts(), []);
  const notChanged = await acts.perform(SETTING_CALL, over);
  assert.equal(notChanged.status, ACT_RESULT_STATUS.REJECTED);
  assert.deepEqual(appActs, []);
});

test("an act is validated against the roster as refreshed inside the turn, not as it stood before", async () => {
  let sessions: readonly Session[] = [observed];
  const { acts, performed } = performer({
    sessions: () => sessions,
    refreshSessions: async () => {
      // The session is gone by the time the act is validated.
      sessions = [];
    },
  });
  const refused = await acts.perform(MESSAGE_CALL, LIVE);
  assert.equal(refused.status, ACT_RESULT_STATUS.REJECTED);
  assert.deepEqual(performed, []);
});

test("a cancel during the roster refresh or the defaults read settles the act, and the late read dispatches nothing", async () => {
  for (const held of ["refreshSessions", "workspaceDefaults"] as const) {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const h = performer({
      [held]: async () => {
        await gate;
        return {};
      },
    });
    const controller = new AbortController();
    const execution: BrainActExecution = {
      runId: "run-1",
      origin: RUN_ORIGIN.USER,
      isRevoked: () => controller.signal.aborted,
      signal: controller.signal,
    };
    const pending = h.acts.perform(MESSAGE_CALL, execution);
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(settled, false);
    controller.abort();
    const outcome = await pending;
    assert.equal(outcome.status, ACT_RESULT_STATUS.REJECTED);
    assert.deepEqual(h.performed, []);
    release?.();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(h.performed, [], `${held}: the late read dispatched nothing`);
    assert.deepEqual(h.recorded, []);
  }
});
