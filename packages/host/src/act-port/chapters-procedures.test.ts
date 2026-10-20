import assert from "node:assert/strict";
import { afterEach, it } from "@effect/vitest";
import { CHAPTERS_MODEL } from "@luke/features/chapters-model-choice";
import { CHAPTER_KIND, CHAPTER_RISK } from "@luke/features/pull-request-chapters";
import {
  PULL_REQUEST_CHAPTERS_CALL_FAILURE,
  type PullRequestChaptersAnswerView,
  type PullRequestChaptersParams,
} from "@luke/features/pull-request-chapters-view";
import { PULL_REQUEST_CHAPTERS_STATE } from "@luke/features/pull-request-chapters-wire";
import { Effect } from "effect";
import { type ActPortClient, CHAPTERS_ACT_KIND } from "../contract/index.js";
import type { ActSender } from "./base.js";
import { chaptersProcedures } from "./chapters-procedures.js";
import { settledAct, type TestActPort, testActPort } from "./testing.js";

/**
 * The Pull request tab's chapters acts, through the act port as a window
 * calls them: a panel's read and Generate reach the host with the pull
 * request the tab names, and the panel hears the chapters or why there are
 * none; Settings' read and write of the chapters model reach it the same
 * way, a model outside the set refused at the port; the voice and call windows, and a frame this build does not trust,
 * are refused in each kind's own words before the host is asked; and an
 * answer the kind's schema does not admit is refused rather than handed to
 * the tab. Synthetic ids and words.
 */

// The platform's handle on the window that asked, which no procedure here reads.
const SENDER = Symbol("window");

const PANEL: ActSender = { sender: SENDER, panel: true, voice: false, call: false };
const VOICE: ActSender = { ...PANEL, panel: false, voice: true };
const CALL: ActSender = { ...PANEL, panel: false, call: true };

const AGENT_ID = "6b1f3c2e-9d4a-4f1b-8c7d-2e3f4a5b6c7d";

const READ_REFUSAL = "Could not read the pull request's chapters on this system.";
const GENERATE_REFUSAL = "Could not generate the pull request's chapters on this system.";
const MODEL_READ_REFUSAL = "Could not read the chapters model on this system.";
const MODEL_WRITE_REFUSAL = "Could not change the chapters model on this system.";

/** Chapters made for the pull request's head. */
const READY: PullRequestChaptersAnswerView = {
  pullRequest: {
    number: 11,
    headSha: "c0ffee1",
    generatable: true,
    chapters: {
      status: PULL_REQUEST_CHAPTERS_STATE.READY,
      headSha: "c0ffee1",
      baseSha: "ba5e000",
      model: "claude-haiku-5-5",
      chapters: [
        {
          kind: CHAPTER_KIND.STORY,
          title: "Expire invitations after a week",
          summary: "Invitations now expire.",
          hunkRefs: [{ path: "src/invite.ts", oldStart: 1 }],
          keyChanges: [],
          risk: CHAPTER_RISK.LOW,
          riskReasons: [],
        },
      ],
    },
  },
};

const ports: TestActPort<unknown>[] = [];

afterEach(() => {
  for (const port of ports.splice(0)) port.close();
});

/** A window's act port over a host answering as told, and what it was asked, in order. */
function windowPort(
  actor: ActSender,
  options: { trusted?: boolean; answer?: PullRequestChaptersAnswerView } = {},
) {
  const asked: string[] = [];
  const answering = (kind: string) => (params: PullRequestChaptersParams) =>
    Effect.sync(() => {
      asked.push(
        `${kind}:${params.agentId}${params.number === undefined ? "" : `#${params.number}`}`,
      );
      return options.answer ?? READY;
    });
  const port = testActPort<unknown>(
    chaptersProcedures({
      host: {
        pullRequestChapters: answering("read"),
        pullRequestChaptersGenerate: answering("generate"),
        chaptersModelRead: () =>
          Effect.sync(() => {
            asked.push("model");
            return { model: CHAPTERS_MODEL.HAIKU };
          }),
        chaptersModelWrite: ({ model }) =>
          Effect.sync(() => {
            asked.push(`model-write:${model}`);
            return { model };
          }),
      },
    }),
  );
  ports.push(port);
  const client: ActPortClient = port.as(actor, { trusted: options.trusted ?? true });
  return {
    read: (params: PullRequestChaptersParams) =>
      settledAct(client[CHAPTERS_ACT_KIND.CHAPTERS_READ](params)),
    generate: (params: PullRequestChaptersParams) =>
      settledAct(client[CHAPTERS_ACT_KIND.CHAPTERS_GENERATE](params)),
    readModel: () => settledAct(client[CHAPTERS_ACT_KIND.CHAPTERS_MODEL_READ](undefined)),
    writeModel: (model: string) =>
      // SAFETY: a model is written as a window might send it, one the kind's schema may refuse.
      settledAct(client[CHAPTERS_ACT_KIND.CHAPTERS_MODEL_WRITE]({ model } as never)),
    asked,
  };
}

it("a panel's read and Generate reach the host with the pull request the tab names, and it hears the chapters", async () => {
  const { read, generate, asked } = windowPort(PANEL);

  assert.deepEqual(await read({ agentId: AGENT_ID }), { answer: READY });
  assert.deepEqual(await generate({ agentId: AGENT_ID, number: 11 }), { answer: READY });
  assert.deepEqual(asked, [`read:${AGENT_ID}`, `generate:${AGENT_ID}#11`]);
});

it("the voice and call windows, and a frame this build does not trust, are refused in each kind's own words, and the host is not asked", async () => {
  for (const { actor, trusted } of [
    { actor: VOICE, trusted: true },
    { actor: CALL, trusted: true },
    { actor: PANEL, trusted: false },
  ]) {
    const { read, generate, asked } = windowPort(actor, { trusted });
    assert.deepEqual(await read({ agentId: AGENT_ID }), { refused: READ_REFUSAL });
    assert.deepEqual(await generate({ agentId: AGENT_ID }), { refused: GENERATE_REFUSAL });
    assert.deepEqual(asked, []);
  }
});

it("a failure word crosses as the answer, and an answer the schema does not admit is refused", async () => {
  const unavailable = windowPort(PANEL, {
    answer: { failure: PULL_REQUEST_CHAPTERS_CALL_FAILURE.UNAVAILABLE },
  });
  assert.deepEqual(await unavailable.generate({ agentId: AGENT_ID }), {
    answer: { failure: PULL_REQUEST_CHAPTERS_CALL_FAILURE.UNAVAILABLE },
  });

  // A head no service names, an empty commit, which the kind's schema refuses.
  const broken = windowPort(PANEL, {
    // SAFETY: the answer is off its schema on purpose, to be refused at the port; its type is the one the host's seam declares.
    answer: { pullRequest: { ...READY.pullRequest, headSha: "" } } as PullRequestChaptersAnswerView,
  });
  assert.deepEqual(await broken.read({ agentId: AGENT_ID }), { refused: READ_REFUSAL });
});

it("a panel reads and writes the chapters model, and a model outside the set is refused before the host is asked", async () => {
  const { readModel, writeModel, asked } = windowPort(PANEL);

  assert.deepEqual(await readModel(), { answer: { model: CHAPTERS_MODEL.HAIKU } });
  assert.deepEqual(await writeModel(CHAPTERS_MODEL.OPUS), {
    answer: { model: CHAPTERS_MODEL.OPUS },
  });
  assert.deepEqual(await writeModel("gpt-5.5"), { refused: MODEL_WRITE_REFUSAL });
  assert.deepEqual(asked, ["model", `model-write:${CHAPTERS_MODEL.OPUS}`]);
});

it("the voice window is refused the chapters model in each kind's own words", async () => {
  const { readModel, writeModel, asked } = windowPort(VOICE);
  assert.deepEqual(await readModel(), { refused: MODEL_READ_REFUSAL });
  assert.deepEqual(await writeModel(CHAPTERS_MODEL.OPUS), { refused: MODEL_WRITE_REFUSAL });
  assert.deepEqual(asked, []);
});
