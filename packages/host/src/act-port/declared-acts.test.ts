import assert from "node:assert/strict";
import { afterEach, it } from "@effect/vitest";
import { ACCOUNT_PROVIDER, ACCOUNT_STATUS } from "@repo/credentials/snapshot";
import {
  AGENT_CALL_FAILURE,
  dictationTranscribeAnswerViewSchema,
  dictationTranscribeParamsSchema,
} from "@repo/features/agent-view";
import {
  PROVIDER_KEY_KIND,
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_STATUS,
} from "@repo/features/provider-key-wire";
import { ACT } from "@repo/sync";
import type { WireBoundaryInput } from "@repo/wire";
import { Effect } from "effect";
import {
  ACCOUNT_ASK_ACT_KIND,
  ACCOUNT_ASK_ACTS,
  declaredActs,
  hostAct,
} from "../contract/index.js";
import { ActRefused } from "../host-acts.js";
import { hostActPort } from "../testing/host-act-port.js";
import type { ActSender } from "./base.js";
import { declaredActProcedures } from "./declared-acts.js";
import { type TestActPort, testActPort } from "./testing.js";

/**
 * A declared act, through the act port as a window calls it, over the host
 * that answers it: only a panel of this build's own renderer asks the
 * account's asks; any other window, and a frame this build does not trust,
 * are refused in each ask's own words before the service is asked; a payload
 * its schema does not take is refused the same way; a panel's ask reaches
 * the service once and hears what it answered, a provider key crossing once
 * and never coming back; and an ask whose handler fails, dies, or answers
 * what the act cannot carry is drawn as the act declares.
 */

const PANEL: ActSender = { sender: Symbol("panel"), panel: true };
const OTHER_WINDOW: ActSender = { sender: Symbol("takeover"), panel: false };

/** The account the host stands signed in to, so an ask reaches the service. */
const SIGNED_IN = {
  status: ACCOUNT_STATUS.SIGNED_IN,
  id: "user-dana",
  email: "dana@example.com",
  provider: ACCOUNT_PROVIDER.GITHUB,
} as const;

/** A synthetic provider key, as Settings carries it once. */
const PROVIDER_KEY = "sk-proj-synthetic-00000000000000000000abcd";

/** The key as the service keeps it: its hint alone. */
const KEPT = {
  provider: PROVIDER_KEY_PROVIDER.OPENAI,
  hint: "sk-proj-…abcd",
  addedAt: 1,
  status: PROVIDER_KEY_STATUS.VERIFIED,
  statusAt: 1,
};

/** Each ask's refusal, as the window drew it before the asks were declared. */
const REFUSAL = {
  [ACCOUNT_ASK_ACT_KIND.PROVIDER_KEYS_SAVE]: "Couldn't save your API key on this system.",
  [ACCOUNT_ASK_ACT_KIND.PROVIDER_KEYS_REMOVE]: "Couldn't remove your API key on this system.",
  [ACCOUNT_ASK_ACT_KIND.PROVIDER_KEYS_FOR_AGENTS]:
    "Couldn't change your plan's default on this system.",
  [ACCOUNT_ASK_ACT_KIND.CHATGPT_DEVICE_START]: "Couldn't start connecting Codex on this system.",
  [ACCOUNT_ASK_ACT_KIND.CHATGPT_DEVICE_WAIT]: "Couldn't wait for Codex on this system.",
  [ACCOUNT_ASK_ACT_KIND.CHATGPT_DEVICE_CANCEL]: "Couldn't stop connecting Codex on this system.",
  [ACCOUNT_ASK_ACT_KIND.GITHUB_TOKEN_SAVE]: "Could not save your GitHub token on this system.",
  [ACCOUNT_ASK_ACT_KIND.GITHUB_TOKEN_REMOVE]: "Could not remove your GitHub token on this system.",
  [ACCOUNT_ASK_ACT_KIND.MEMORIES_FORGET]: "Could not forget that memory on this system.",
  [ACCOUNT_ASK_ACT_KIND.DICTATION_TRANSCRIBE]: "Could not transcribe the recording on this system.",
} as const;

/** Every account ask, each with a payload its schema takes. */
const ASKS: readonly {
  readonly kind: keyof typeof REFUSAL;
  readonly payload: WireBoundaryInput;
}[] = [
  {
    kind: ACCOUNT_ASK_ACT_KIND.PROVIDER_KEYS_SAVE,
    payload: { provider: PROVIDER_KEY_PROVIDER.OPENAI, key: PROVIDER_KEY },
  },
  {
    kind: ACCOUNT_ASK_ACT_KIND.PROVIDER_KEYS_REMOVE,
    payload: { provider: PROVIDER_KEY_PROVIDER.OPENAI, kind: PROVIDER_KEY_KIND.CHATGPT_OAUTH },
  },
  {
    kind: ACCOUNT_ASK_ACT_KIND.PROVIDER_KEYS_FOR_AGENTS,
    payload: {
      provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
      kind: PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN,
      forAgents: false,
    },
  },
  { kind: ACCOUNT_ASK_ACT_KIND.CHATGPT_DEVICE_START, payload: undefined },
  {
    kind: ACCOUNT_ASK_ACT_KIND.CHATGPT_DEVICE_WAIT,
    payload: { loginId: "login-1", intervalSeconds: 5 },
  },
  { kind: ACCOUNT_ASK_ACT_KIND.CHATGPT_DEVICE_CANCEL, payload: { loginId: "login-1" } },
  {
    kind: ACCOUNT_ASK_ACT_KIND.GITHUB_TOKEN_SAVE,
    payload: { token: "synthetic-classic-token-0000000000wxyz" },
  },
  { kind: ACCOUNT_ASK_ACT_KIND.GITHUB_TOKEN_REMOVE, payload: undefined },
  {
    kind: ACCOUNT_ASK_ACT_KIND.MEMORIES_FORGET,
    payload: { workspaceId: "workspace-1", id: "8a1f2c3d-4e5f-4a6b-9c7d-8e9f0a1b2c3d" },
  },
  {
    kind: ACCOUNT_ASK_ACT_KIND.DICTATION_TRANSCRIBE,
    payload: { audio: "GkXfow==", durationMs: 1200, keywords: ["Vespin"] },
  },
];

/** What the host sent the service on an ask's behalf: every request but the reads it opens on its own, which only read. */
function asksSent<Request extends { readonly method: string }>(requests: readonly Request[]) {
  return requests.filter((request) => request.method !== "GET");
}

const ports: TestActPort<unknown>[] = [];

afterEach(() => {
  for (const port of ports.splice(0)) port.close();
});

it.effect(
  "a window that is not a panel, and a frame this build does not trust, are refused every account ask in the ask's own words, a provider key among them, and the service is not asked",
  () =>
    Effect.gen(function* () {
      const { port, requests } = yield* hostActPort({ account: SIGNED_IN });
      const refused = [];
      for (const ask of ASKS) {
        refused.push(yield* port.perform(ask, OTHER_WINDOW));
        refused.push(yield* port.perform(ask, PANEL, { trusted: false }));
      }

      assert.deepEqual(
        refused,
        ASKS.flatMap((ask) => [{ refused: REFUSAL[ask.kind] }, { refused: REFUSAL[ask.kind] }]),
      );
      assert.ok(!JSON.stringify(refused).includes(PROVIDER_KEY));
      assert.deepEqual(asksSent(requests), []);
    }),
);

it.effect(
  "a payload its ask's schema refuses, one carrying a key the schema does not name, and one sent to an ask that carries none, are refused in the ask's own words that hold no provider key, and the service is not asked",
  () =>
    Effect.gen(function* () {
      const { port, requests } = yield* hostActPort({ account: SIGNED_IN });
      const sent = [
        {
          kind: ACCOUNT_ASK_ACT_KIND.PROVIDER_KEYS_SAVE,
          payload: { provider: "google", key: PROVIDER_KEY },
        },
        {
          kind: ACCOUNT_ASK_ACT_KIND.MEMORIES_FORGET,
          payload: {
            workspaceId: "workspace-1",
            id: "8a1f2c3d-4e5f-4a6b-9c7d-8e9f0a1b2c3d",
            stray: true,
          },
        },
        {
          kind: ACCOUNT_ASK_ACT_KIND.CHATGPT_DEVICE_START,
          payload: { provider: PROVIDER_KEY_PROVIDER.OPENAI },
        },
      ] as const;
      const refused = [];
      for (const ask of sent) refused.push(yield* port.perform(ask, PANEL));

      assert.deepEqual(
        refused,
        sent.map((ask) => ({ refused: REFUSAL[ask.kind] })),
      );
      assert.ok(!JSON.stringify(refused).includes(PROVIDER_KEY));
      assert.deepEqual(asksSent(requests), []);
    }),
);

it.effect(
  "a panel's ask reaches the service once with its payload, and the panel hears what the service answered, the key never coming back",
  () =>
    Effect.gen(function* () {
      const { port, requests } = yield* hostActPort({
        account: SIGNED_IN,
        respond: () => Response.json({ keys: [KEPT] }),
      });

      const saved = yield* port.perform(
        {
          kind: ACCOUNT_ASK_ACT_KIND.PROVIDER_KEYS_SAVE,
          payload: { provider: PROVIDER_KEY_PROVIDER.OPENAI, key: PROVIDER_KEY },
        },
        PANEL,
      );

      assert.deepEqual(saved, { answer: { keys: [KEPT] } });
      assert.deepEqual(
        asksSent(requests).map((request) => [request.method, request.body]),
        [["PUT", JSON.stringify({ provider: PROVIDER_KEY_PROVIDER.OPENAI, key: PROVIDER_KEY })]],
      );
    }),
);

it.effect(
  "an ask whose handler fails, dies, or answers what the act cannot carry is drawn as the act's unanswered, and one that declares none is refused in its own words",
  () =>
    Effect.gen(function* () {
      const clip = { audio: "GkXfow==", durationMs: 1200, keywords: ["Vespin"] };
      const transcribe = { kind: ACCOUNT_ASK_ACT_KIND.DICTATION_TRANSCRIBE, payload: clip };
      const portOver = (
        acts: Parameters<typeof declaredActProcedures>[0],
        answer: () => Effect.Effect<unknown, unknown>,
      ) => {
        const port = testActPort(
          declaredActProcedures(acts, {
            // SAFETY: each answer is the failure or the shape the case is about, which the relay reads as any handler's.
            DICTATION_TRANSCRIBE: answer as () => Effect.Effect<never>,
          }),
        );
        ports.push(port);
        return port;
      };
      // The same ask declared with no fallback of its own.
      const unfallen = declaredActs({
        DICTATION_TRANSCRIBE: hostAct({
          input: dictationTranscribeParamsSchema,
          output: dictationTranscribeAnswerViewSchema,
          refusal: REFUSAL[ACCOUNT_ASK_ACT_KIND.DICTATION_TRANSCRIBE],
          panelOnly: true,
          door: ACT.REMOTE_WORK,
        }),
      });
      const answers = [
        () => Effect.fail(new Error("refused")),
        () => Effect.die(new Error("secret detail")),
        () => Effect.succeed({ words: 3 }),
      ];

      const drawn = [];
      for (const answer of answers) {
        drawn.push(yield* portOver(ACCOUNT_ASK_ACTS, answer).perform(transcribe, PANEL));
        drawn.push(yield* portOver(unfallen, answer).perform(transcribe, PANEL));
      }

      const unanswered = { answer: { failure: AGENT_CALL_FAILURE.UNANSWERED } };
      const refused = { refused: REFUSAL[ACCOUNT_ASK_ACT_KIND.DICTATION_TRANSCRIBE] };
      assert.deepEqual(
        drawn,
        answers.flatMap(() => [unanswered, refused]),
      );
    }),
);

it.effect(
  "a handler's own refusal is refused in its sentence, or the act's where it gives none, and never drawn as the act's unanswered",
  () =>
    Effect.gen(function* () {
      const port = testActPort(
        declaredActProcedures(ACCOUNT_ASK_ACTS, {
          PROVIDER_KEYS_REMOVE: () =>
            Effect.fail(new ActRefused({ sentence: "That key is in use." })),
          GITHUB_TOKEN_REMOVE: () => Effect.fail(new ActRefused({})),
        }),
      );
      ports.push(port);

      const removed = [
        yield* port.perform(
          {
            kind: ACCOUNT_ASK_ACT_KIND.PROVIDER_KEYS_REMOVE,
            payload: { provider: PROVIDER_KEY_PROVIDER.OPENAI },
          },
          PANEL,
        ),
        yield* port.perform({ kind: ACCOUNT_ASK_ACT_KIND.GITHUB_TOKEN_REMOVE }, PANEL),
      ];

      assert.deepEqual(removed, [
        { refused: "That key is in use." },
        { refused: REFUSAL[ACCOUNT_ASK_ACT_KIND.GITHUB_TOKEN_REMOVE] },
      ]);
    }),
);

it("an act written by hand is given no relayed procedure, so its own answers the window", () => {
  const acts = declaredActs({
    DICTATION_TRANSCRIBE: hostAct({
      input: dictationTranscribeParamsSchema,
      output: dictationTranscribeAnswerViewSchema,
      refusal: REFUSAL[ACCOUNT_ASK_ACT_KIND.DICTATION_TRANSCRIBE],
      panelOnly: true,
      door: ACT.REMOTE_WORK,
      byHand: true,
    }),
    PROVIDER_KEYS_REMOVE: ACCOUNT_ASK_ACTS.PROVIDER_KEYS_REMOVE,
  });

  const relayed = declaredActProcedures(acts, {
    DICTATION_TRANSCRIBE: () => Effect.succeed({ failure: AGENT_CALL_FAILURE.UNANSWERED }),
    PROVIDER_KEYS_REMOVE: () => Effect.succeed({ keys: [] }),
  });

  assert.deepEqual(Object.keys(relayed), [ACCOUNT_ASK_ACT_KIND.PROVIDER_KEYS_REMOVE]);
});
