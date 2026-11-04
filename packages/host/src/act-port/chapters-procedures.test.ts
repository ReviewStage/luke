import assert from "node:assert/strict";
import { afterEach, it } from "@effect/vitest";
import { CHAPTERS_MODEL } from "@repo/features/chapters-model-choice";
import { CHAPTER_KIND, CHAPTER_RISK } from "@repo/features/pull-request-chapters";
import {
  PULL_REQUEST_CHAPTERS_CALL_FAILURE,
  type PullRequestChaptersAnswerView,
  type PullRequestChaptersParams,
  type PullRequestChaptersReadParams,
} from "@repo/features/pull-request-chapters-view";
import { PULL_REQUEST_CHAPTERS_STATE } from "@repo/features/pull-request-chapters-wire";
import { Effect } from "effect";
import { type ActPortClient, CHAPTERS_ACT_KIND } from "../contract/index.js";
import type { ActSender } from "./base.js";
import { chaptersProcedures } from "./chapters-procedures.js";
import { settledAct, type TestActPort, testActPort } from "./testing.js";

/**
 * The Pull request tab's chapters acts, through the act port as a window
 * calls them: a panel's Generate reaches the host with the pull request the
 * tab names, and the panel hears the chapters or why there are none; Settings' write of the chapters model reaches it the same
 * way, a model outside the set refused at the port; any other window, and a frame this build does not trust,
 * are refused in each kind's own words before the host is asked; and an
 * answer the kind's schema does not admit is refused rather than handed to
 * the tab. Synthetic ids and words.
 */

// The platform's handle on the window that asked, which no procedure here reads.
const SENDER = Symbol("window");

const PANEL: ActSender = { sender: SENDER, panel: true };
const OTHER_WINDOW: ActSender = { ...PANEL, panel: false };

const AGENT_ID = "6b1f3c2e-9d4a-4f1b-8c7d-2e3f4a5b6c7d";

const RETRY_REFUSAL = "Could not read the pull request's chapters again on this system.";
const GENERATE_REFUSAL = "Could not generate the pull request's chapters on this system.";
const MODEL_WRITE_REFUSAL = "Could not change the chapters model on this system.";

/** Chapters made for the pull request's head. */
const READY: PullRequestChaptersAnswerView = {
  pullRequest: {
    number: 11,
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
        chaptersFollow: () => Effect.sync(() => asked.push("follow")),
        chaptersUnfollow: () => Effect.sync(() => asked.push("unfollow")),
        chaptersRetry: () => Effect.sync(() => asked.push("retry")),
        pullRequestChaptersGenerate: answering("generate"),
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
    retry: (params: PullRequestChaptersReadParams) =>
      settledAct(client[CHAPTERS_ACT_KIND.CHAPTERS_RETRY](params)),
    generate: (params: PullRequestChaptersParams) =>
      settledAct(client[CHAPTERS_ACT_KIND.CHAPTERS_GENERATE](params)),
    writeModel: (model: string) =>
      // SAFETY: a model is written as a window might send it, one the kind's schema may refuse.
      settledAct(client[CHAPTERS_ACT_KIND.CHAPTERS_MODEL_WRITE]({ model } as never)),
    asked,
  };
}

it("a panel's Generate reaches the host with the pull request the tab names, and it hears the chapters", async () => {
  const { generate, asked } = windowPort(PANEL);

  assert.deepEqual(await generate({ agentId: AGENT_ID, number: 11 }), { answer: READY });
  assert.deepEqual(asked, [`generate:${AGENT_ID}#11`]);
});

it("a window that is not a panel, and a frame this build does not trust, are refused in each kind's own words, and the host is not asked", async () => {
  for (const { actor, trusted } of [
    { actor: OTHER_WINDOW, trusted: true },
    { actor: PANEL, trusted: false },
  ]) {
    const { retry, generate, asked } = windowPort(actor, { trusted });
    assert.deepEqual(await retry({ agentId: AGENT_ID, number: 11 }), { refused: RETRY_REFUSAL });
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
    answer: {
      pullRequest: {
        number: 11,
        generatable: true,
        chapters: {
          status: PULL_REQUEST_CHAPTERS_STATE.GENERATING,
          headSha: "",
          baseSha: "ba5e000",
          startedAt: 1,
        },
      },
    } as PullRequestChaptersAnswerView,
  });
  assert.deepEqual(await broken.generate({ agentId: AGENT_ID, number: 11 }), {
    refused: GENERATE_REFUSAL,
  });
});

it("a panel writes the chapters model, and a model outside the set is refused before the host is asked", async () => {
  const { writeModel, asked } = windowPort(PANEL);

  assert.deepEqual(await writeModel(CHAPTERS_MODEL.OPUS), {
    answer: { model: CHAPTERS_MODEL.OPUS },
  });
  assert.deepEqual(await writeModel("gpt-5.5"), { refused: MODEL_WRITE_REFUSAL });
  assert.deepEqual(asked, [`model-write:${CHAPTERS_MODEL.OPUS}`]);
});

it("a window that is not a panel is refused the chapters model write in the kind's own words", async () => {
  const { writeModel, asked } = windowPort(OTHER_WINDOW);
  assert.deepEqual(await writeModel(CHAPTERS_MODEL.OPUS), { refused: MODEL_WRITE_REFUSAL });
  assert.deepEqual(asked, []);
});
