import assert from "node:assert/strict";
import test from "node:test";
import {
  type CarriedIssueAction,
  type CarriedSessionAction,
  REALTIME_TOOL,
  type RememberedFact,
} from "@sidecar/acts";
import { APP_SETTING_KIND, EMPTY_APP_GUIDE } from "@sidecar/guide";
import type { ConversationEntry } from "@sidecar/realtime";
import { normalizeSession, SESSION_STATUS, type Session } from "@sidecar/session";
import { ACT_RESULT_STATUS } from "@sidecar/wire";
import type { BrainAppActRequest } from "#shared/contracts";
import { type BrainActPerformerDependencies, createBrainActPerformer } from "./brain-acts";

const NOW = 1_800_000_000_000;

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
    workspaceProjects: () => [],
    workspaceDefaults: async () => ({}),
    trackedIssues: () => undefined,
    appGuide: () => EMPTY_APP_GUIDE,
    rememberedFacts: () => facts,
    writeRememberedFacts: (next) => {
      facts = next;
      return true;
    },
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

  const landed = await acts.perform({
    name: REALTIME_TOOL.SEND_SESSION_MESSAGE,
    argumentsJson: `{${identity},"text":"go ahead"}`,
  });
  assert.equal(landed.status, ACT_RESULT_STATUS.ACCEPTED);
  assert.equal(performed.length, 1);
  assert.equal(performed[0]?.kind, "message");
  // The ask is recorded as the developer's, before the outcome is known.
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0]?.kind, "act");

  const stranger = await acts.perform({
    name: REALTIME_TOOL.SEND_SESSION_MESSAGE,
    argumentsJson: '{"provider_id":"claude-code","provider_session_id":"ghost","text":"hi"}',
  });
  assert.equal(stranger.status, ACT_RESULT_STATUS.REJECTED);
  assert.equal(performed.length, 1);

  const unknown = await acts.perform({ name: "delete_everything", argumentsJson: "{}" });
  assert.deepEqual(unknown, { status: ACT_RESULT_STATUS.REJECTED, reason: "No such tool exists." });
});

test("an issue act is refused outright while no tracker is connected", async () => {
  const { acts, performed } = performer();
  const refused = await acts.perform({
    name: REALTIME_TOOL.UPDATE_ISSUE_STATE,
    argumentsJson: '{"tracker_id":"linear","issue_id":"LUKE-1","state":"Done"}',
  });
  assert.equal(refused.status, ACT_RESULT_STATUS.REJECTED);
  assert.equal(performed.length, 0);
});

test("memory acts are the main process's own, and the store's answer is the report", async () => {
  const { acts, facts, appActs } = performer();

  const saved = await acts.perform({
    name: REALTIME_TOOL.REMEMBER_FACT,
    argumentsJson: '{"words":"prefers concise answers"}',
  });
  assert.equal(saved.status, ACT_RESULT_STATUS.ACCEPTED);
  assert.equal(facts().length, 1);
  const id = facts()[0]?.id;
  assert.ok(id);

  const forgotten = await acts.perform({
    name: REALTIME_TOOL.FORGET_FACT,
    argumentsJson: JSON.stringify({ id }),
  });
  assert.equal(forgotten.status, ACT_RESULT_STATUS.ACCEPTED);
  assert.equal(facts().length, 0);
  // Nothing about memory ever crosses to a renderer.
  assert.equal(appActs.length, 0);
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

  const changed = await acts.perform({
    name: REALTIME_TOOL.CHANGE_APP_SETTING,
    argumentsJson: '{"setting_id":"voice_captions","value":"on"}',
  });
  assert.equal(changed.status, ACT_RESULT_STATUS.ACCEPTED);
  assert.equal(appActs.length, 1);
  assert.equal(appActs[0]?.kind, "setting");

  const unlisted = await acts.perform({
    name: REALTIME_TOOL.CHANGE_APP_SETTING,
    argumentsJson: '{"setting_id":"launch_codes","value":"on"}',
  });
  assert.equal(unlisted.status, ACT_RESULT_STATUS.REJECTED);
  assert.equal(appActs.length, 1);
});
