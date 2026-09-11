import assert from "node:assert/strict";
import { buildSystemPrompt, PROMPT_PROFILE, PROMPT_SECTION } from "@sidecar/runtime";
import { test } from "vitest";
import {
  BACKEND_PREAMBLE,
  type BrainPromptVoice,
  brainPromptVoice,
  isSpokenTurn,
} from "./backend-preamble.js";
import { BRAIN_REQUEST_ORIGIN } from "./requests.js";
import { BRAIN_TURN_KIND, BRAIN_TURN_TRIGGER, type BrainTurnDescription } from "./turn.js";
import { BRAIN_IDENTITY_LINE, BRAIN_PERSONA } from "./workspace-seeds.js";

const SPOKEN_ASK: BrainTurnDescription = {
  kind: BRAIN_TURN_KIND.TURN,
  trigger: BRAIN_TURN_TRIGGER.ASK,
  askOrigin: BRAIN_REQUEST_ORIGIN.SPOKEN,
};

const TYPED_ASK: BrainTurnDescription = {
  kind: BRAIN_TURN_KIND.TURN,
  trigger: BRAIN_TURN_TRIGGER.ASK,
  askOrigin: BRAIN_REQUEST_ORIGIN.TYPED,
};

const OTHER_TURNS: readonly BrainTurnDescription[] = [
  TYPED_ASK,
  { kind: BRAIN_TURN_KIND.TURN, trigger: BRAIN_TURN_TRIGGER.ASK },
  {
    kind: BRAIN_TURN_KIND.TURN,
    trigger: BRAIN_TURN_TRIGGER.CHILD_TASK,
    askOrigin: BRAIN_REQUEST_ORIGIN.CHILD,
  },
  { kind: BRAIN_TURN_KIND.TURN, trigger: BRAIN_TURN_TRIGGER.WAKE },
  { kind: BRAIN_TURN_KIND.TURN, trigger: BRAIN_TURN_TRIGGER.ROSTER },
  { kind: BRAIN_TURN_KIND.TURN, trigger: BRAIN_TURN_TRIGGER.HOLD_RELEASED },
  { kind: BRAIN_TURN_KIND.TURN, trigger: BRAIN_TURN_TRIGGER.CHILD_COMPLETION },
  { kind: BRAIN_TURN_KIND.MAINTENANCE },
];

test("only an ask's turn whose ask was spoken is a spoken turn", () => {
  assert.equal(isSpokenTurn(SPOKEN_ASK), true);
  assert.deepEqual(
    OTHER_TURNS.map(isSpokenTurn),
    OTHER_TURNS.map(() => false),
  );
});

test("a spoken turn is voiced by the backend preamble alone, and every other turn by the persona alone", () => {
  const spoken: BrainPromptVoice = { backendPreamble: BACKEND_PREAMBLE };
  const persona: BrainPromptVoice = { persona: BRAIN_PERSONA };
  assert.deepEqual(brainPromptVoice(SPOKEN_ASK), spoken);
  assert.deepEqual(
    OTHER_TURNS.map(brainPromptVoice),
    OTHER_TURNS.map(() => persona),
  );
});

function sectionsFor(turn: BrainTurnDescription) {
  return buildSystemPrompt({
    profile: PROMPT_PROFILE.FULL,
    identity: BRAIN_IDENTITY_LINE,
    ...brainPromptVoice(turn),
    tools: [],
    toolNotes: [],
    runtimeContextMarker: "[context]",
    skills: [],
    workspaceDirectory: "/w",
    bootstrapFiles: [],
    runtime: { agentId: "main", runtimeId: "tool-loop" },
  }).sections;
}

test("the composed prompt opens a spoken turn with the preamble section and carries no persona section", () => {
  const spoken = sectionsFor(SPOKEN_ASK);
  assert.equal(spoken[0]?.id, PROMPT_SECTION.BACKEND_PREAMBLE);
  assert.equal(spoken[0]?.text, BACKEND_PREAMBLE);
  assert.equal(spoken[0]?.stable, true);
  assert.equal(spoken[1]?.id, PROMPT_SECTION.IDENTITY);
  assert.equal(
    spoken.some((section) => section.id === PROMPT_SECTION.PERSONA),
    false,
  );
});

test("the composed prompt of a typed ask opens with the identity, then the persona, and no preamble section", () => {
  const typed = sectionsFor(TYPED_ASK);
  assert.deepEqual(
    typed.slice(0, 2).map((section) => section.id),
    [PROMPT_SECTION.IDENTITY, PROMPT_SECTION.PERSONA],
  );
  assert.equal(
    typed.some((section) => section.id === PROMPT_SECTION.BACKEND_PREAMBLE),
    false,
  );
});
