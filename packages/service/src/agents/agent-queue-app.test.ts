import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import type { DatabaseServices } from "@repo/database/core/query";
import {
  claimQueueHead,
  type QueuedMessageRow,
  readAgentQueue,
} from "@repo/database/models/agent-queue-store";
import { readAgent } from "@repo/database/models/agent-store";
import { sentLineStands } from "@repo/database/models/message-reads";
import { storeWriter } from "@repo/database/models/writer";
import { CONVERSATION_RUNTIME, MESSAGE_SENDER } from "@repo/database/storage-vocabulary";
import { getTestDB, joinWorkspace } from "@repo/database/testing";
import { QUEUE_PAUSE } from "@repo/features/agent-queue-wire";
import { LINE_GRACE_MILLIS } from "@repo/features/agent-status";
import {
  AGENT_ATTACHMENT_TYPE,
  AGENT_KIND,
  AGENT_MACHINE,
  agentMessagesAnswerSchema,
  agentQueueAnswerSchema,
  QUEUE_CHANGE,
} from "@repo/features/agent-wire";
import type { WireBoundaryInput } from "@repo/wire";
import { sentLineId } from "@repo/wire/host-ids";
import { noNetwork } from "@repo/wire/testing";
import { Duration, Effect, Layer, Option } from "effect";
import { TestClock } from "effect/testing";
import {
  RUN_EVENT,
  RUN_STATUS,
  RUN_TURN_ORIGIN,
  sessionKey,
  TURN_ORIGIN,
  TURN_TRIGGER,
} from "../core.js";
import { SERVER_EVENT } from "../events/server-events.js";
import { keptAfterResponse } from "../http/after-response.js";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import {
  AGENT_MESSAGES,
  AGENT_PICTURE,
  AGENT_STOP,
  type Answer,
  countedWith,
  fakeAgentSessions,
  messagedAgent,
  readAnswer,
  receiptOf,
  request,
  SIZED_PNG,
  SNAPSHOT,
  sessionCookieOf,
} from "../testing/agents-app-support.js";
import { queueAtTurnEnd, sendQueued, sweepAgentQueues } from "./coder-host/agent-queue.js";
import { steerAgentWritten } from "./coder-host/steer.js";
import { canceledTurn } from "./coder-host/stop.js";
import { CODER_TOOL_SET } from "./coder-host/tool-set.js";
import { SESSION_SEND_OUTCOME } from "./sessions/agent-sessions.js";

/**
 * An agent's queue over the agents routes: a message queued while a turn
 * runs waits for the turn's end and opens the next turn, one at a time; a
 * member's change (add, edit, hold, reorder, delete, steer, resume) moves the
 * queue's revision and is answered with the queue; Stop and every other
 * cancel pause it; a refused hand-off keeps the message and pauses with why;
 * and only the agent's starter may change it. Over the harness the agents
 * routes' tests share (`testing/agents-app.ts`). Synthetic accounts, tasks,
 * and words throughout.
 */

it.layer(getTestDB())("an agent's queue", (it) => {
  /** Where a change to an agent's queue lands. */
  const AGENT_QUEUE = "/api/agents/queue";

  /** One change to the agent's queue as its owner asks it, and the queue it answers. */
  const queueChanged = (
    ask: (request: Request) => Effect.Effect<Answer>,
    owner: string,
    agentId: string,
    change: WireBoundaryInput,
  ) =>
    Effect.map(
      ask(request(AGENT_QUEUE, owner, { method: "POST", id: agentId, body: change })),
      (answered) => readAnswer(agentQueueAnswerSchema, HOSTED_HTTP_STATUS.OK, answered).queue,
    );

  it.effect(
    "messages queued behind the running turn wait there, edited, held, and put in order, none of them sent, and read on the agent's transcript",
    () =>
      Effect.gen(function* () {
        const agentSessions = fakeAgentSessions();
        const { agent, ask, owner } = yield* messagedAgent(agentSessions, { running: true });
        const sentBefore = agentSessions.sent.length;
        for (const text of ["First", "Second", "Third"]) {
          yield* queueChanged(ask, owner, agent.id, {
            change: QUEUE_CHANGE.ADD,
            text,
            id: randomUUID(),
          });
        }
        const [first, second, third] = (yield* queueChanged(ask, owner, agent.id, {
          change: QUEUE_CHANGE.RESUME,
        })).messages;
        assert.ok(first !== undefined && second !== undefined && third !== undefined);
        yield* queueChanged(ask, owner, agent.id, {
          change: QUEUE_CHANGE.EDIT,
          messageId: second.id,
          text: "Second, reworded",
        });
        yield* queueChanged(ask, owner, agent.id, {
          change: QUEUE_CHANGE.REORDER,
          order: [third.id, first.id, second.id],
        });
        yield* queueChanged(ask, owner, agent.id, {
          change: QUEUE_CHANGE.HOLD,
          messageId: first.id,
          held: true,
        });

        assert.equal(agentSessions.sent.length, sentBefore, "nothing goes while the turn runs");
        const page = readAnswer(
          agentMessagesAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(AGENT_MESSAGES, owner, { id: agent.id })),
        );
        assert.deepEqual(
          page.queue?.messages.map((message) => [message.text, message.editing ?? false]),
          [
            ["Third", false],
            ["First", true],
            ["Second, reworded", false],
          ],
        );
      }),
  );

  /** An image and a PDF a queued message may carry. */
  const SHOT = {
    name: "flow.png",
    mediaType: AGENT_ATTACHMENT_TYPE.PNG,
    data: Buffer.from(SIZED_PNG).toString("base64"),
  };
  const SPEC = {
    name: "spec.pdf",
    mediaType: AGENT_ATTACHMENT_TYPE.PDF,
    data: Buffer.from("%PDF-1.4").toString("base64"),
  };

  /** The names of the files the harness was last handed, in order. */
  const handedFiles = (agentSessions: ReturnType<typeof fakeAgentSessions>) =>
    receiptOf(agentSessions.sent.at(-1)?.message.message).flatMap((part) =>
      part.type === "file" ? [part.filename] : [],
    );

  /** A message queued with an image behind the running turn, and held for an edit. */
  const heldWithImage = (agentSessions: ReturnType<typeof fakeAgentSessions>) =>
    Effect.gen(function* () {
      const started = yield* messagedAgent(agentSessions, { running: true });
      const { agent, ask, owner } = started;
      const [message] = (yield* queueChanged(ask, owner, agent.id, {
        change: QUEUE_CHANGE.ADD,
        text: "Match this.",
        id: randomUUID(),
        attachments: [SHOT],
      })).messages;
      assert.ok(message !== undefined);
      yield* queueChanged(ask, owner, agent.id, {
        change: QUEUE_CHANGE.HOLD,
        messageId: message.id,
        held: true,
      });
      return { ...started, message };
    });

  it.effect(
    "a queued image is read by its id as a picture of the agent, by whoever reads the agent alone; an edit saved with other files replaces it, words and all, and the turn's end hands the agent the saved files",
    () =>
      Effect.gen(function* () {
        const agentSessions = fakeAgentSessions();
        const { agent, ask, fetch, owner, other, message, target, writer, turnId, github } =
          yield* heldWithImage(agentSessions);
        const fileId = message.files?.[0]?.id;
        assert.ok(fileId !== undefined, "the queue names the file by an id");
        const read = (bearer: string) =>
          fetch(request(AGENT_PICTURE, bearer, { id: agent.id, picture: fileId }));
        const served = yield* read(owner);
        assert.equal(served.status, HOSTED_HTTP_STATUS.OK);
        assert.deepEqual(
          new Uint8Array(yield* Effect.promise(() => served.arrayBuffer())),
          SIZED_PNG,
        );
        assert.equal(
          (yield* read(other)).status,
          HOSTED_HTTP_STATUS.NOT_FOUND,
          "an account that cannot read the agent reads none of its queue's files",
        );

        const saved = yield* queueChanged(ask, owner, agent.id, {
          change: QUEUE_CHANGE.EDIT,
          messageId: message.id,
          text: "",
          attachments: [SPEC],
        });
        assert.deepEqual(
          saved.messages.map((each) => [each.text, each.files?.map((file) => file.name)]),
          [["", ["spec.pdf"]]],
        );
        yield* writer.consume(target, {
          kind: RUN_EVENT.TURN_ENDED,
          conversationId: sessionKey(target.conversationId),
          turnId,
          sequence: 2,
          status: RUN_STATUS.SUCCEEDED,
          responseIds: [],
          at: 0,
        });
        const stored = Option.getOrThrow(yield* readAgent(owner, agent.id));
        yield* queueAtTurnEnd(
          (account) => Effect.succeed(agentSessions.agentSessions(`deployment:${account}`)),
          stored,
        ).pipe(Effect.provide(Layer.mergeAll(github.layer, noNetwork)));

        assert.deepEqual(handedFiles(agentSessions), ["spec.pdf"]);
      }),
  );

  it.effect(
    "an edit steered goes now with the edit's words and files in place of the message's",
    () =>
      Effect.gen(function* () {
        const agentSessions = fakeAgentSessions();
        const { agent, ask, owner, message } = yield* heldWithImage(agentSessions);

        const queue = yield* queueChanged(ask, owner, agent.id, {
          change: QUEUE_CHANGE.STEER,
          messageId: message.id,
          text: "Use the spec instead.",
          attachments: [SPEC],
        });

        assert.deepEqual(queue.messages, []);
        assert.deepEqual(handedFiles(agentSessions), ["spec.pdf"]);
        assert.ok(
          JSON.stringify(agentSessions.sent.at(-1)?.message.message).includes(
            "Use the spec instead.",
          ),
        );
      }),
  );

  it.effect(
    "a message queued while the agent stands idle goes at once as its member's own message, under its own key, and leaves the queue",
    () =>
      Effect.gen(function* () {
        const agentSessions = fakeAgentSessions();
        const { agent, ask, owner, target } = yield* messagedAgent(agentSessions, {
          running: false,
        });
        const id = randomUUID();
        const queue = yield* queueChanged(ask, owner, agent.id, {
          change: QUEUE_CHANGE.ADD,
          text: "Now the dark variant.",
          id,
        });

        assert.deepEqual(queue.messages, []);
        assert.ok(
          JSON.stringify(agentSessions.sent.at(-1)?.message.message).includes(
            "Now the dark variant.",
          ),
        );
        assert.equal(yield* sentLineStands(owner, target.conversationId, sentLineId(id)), true);
      }),
  );

  it.effect(
    "every change to the queue moves its revision on, and the page still carries the queue once it stands empty",
    () =>
      Effect.gen(function* () {
        const agentSessions = fakeAgentSessions();
        const { agent, ask, owner } = yield* messagedAgent(agentSessions, { running: true });
        const revisions: number[] = [];
        const changed = (change: WireBoundaryInput) =>
          Effect.tap(queueChanged(ask, owner, agent.id, change), (queue) =>
            Effect.sync(() => revisions.push(queue.revision)),
          );
        const [queued] = (yield* changed({
          change: QUEUE_CHANGE.ADD,
          text: "Run tests",
          id: randomUUID(),
        })).messages;
        assert.ok(queued !== undefined);
        yield* changed({ change: QUEUE_CHANGE.EDIT, messageId: queued.id, text: "Run the tests" });
        yield* changed({ change: QUEUE_CHANGE.REORDER, order: [queued.id] });
        // Held, so the Resume after the Stop hands nothing on.
        yield* changed({ change: QUEUE_CHANGE.HOLD, messageId: queued.id, held: true });
        yield* ask(request(AGENT_STOP, owner, { method: "POST", id: agent.id }));
        yield* changed({ change: QUEUE_CHANGE.RESUME });
        yield* changed({ change: QUEUE_CHANGE.DELETE, messageId: queued.id });

        for (const [at, revision] of revisions.entries()) {
          assert.ok(
            at === 0 || revision > (revisions[at - 1] ?? 0),
            `change ${at} moved the revision on`,
          );
        }
        assert.ok(
          (revisions[4] ?? 0) > (revisions[3] ?? 0) + 1,
          "the Stop's pause moved it on too",
        );
        const page = readAnswer(
          agentMessagesAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(AGENT_MESSAGES, owner, { id: agent.id })),
        );
        assert.deepEqual(page.queue, { messages: [], revision: revisions.at(-1) });
      }),
  );

  it.effect(
    "an edited message steered goes once with its new words, never its old ones, and leaves the queue",
    () =>
      Effect.gen(function* () {
        const agentSessions = fakeAgentSessions();
        const { agent, ask, owner } = yield* messagedAgent(agentSessions, { running: true });
        const [queued] = (yield* queueChanged(ask, owner, agent.id, {
          change: QUEUE_CHANGE.ADD,
          text: "Run tests",
          id: randomUUID(),
        })).messages;
        assert.ok(queued !== undefined);
        yield* queueChanged(ask, owner, agent.id, {
          change: QUEUE_CHANGE.HOLD,
          messageId: queued.id,
          held: true,
        });

        const queue = yield* queueChanged(ask, owner, agent.id, {
          change: QUEUE_CHANGE.STEER,
          messageId: queued.id,
          text: "Run tests and fix failures",
        });

        assert.deepEqual(queue.messages, []);
        const said = agentSessions.sent.map((each) => JSON.stringify(each.message.message));
        assert.equal(
          said.filter((words) => words.includes("Run tests and fix failures")).length,
          1,
        );
        assert.equal(
          said.filter((words) => words.includes("Run tests") && !words.includes("fix failures"))
            .length,
          0,
          "the words the edit replaced never went",
        );
      }),
  );

  it.effect("a queued message steered goes into the running turn now and leaves the queue", () =>
    Effect.gen(function* () {
      const agentSessions = fakeAgentSessions();
      const { agent, ask, owner, target } = yield* messagedAgent(agentSessions, { running: true });
      const countedBefore = countedWith(owner, SERVER_EVENT.MESSAGE_SEND).length;
      const id = randomUUID();
      const [queued] = (yield* queueChanged(ask, owner, agent.id, {
        change: QUEUE_CHANGE.ADD,
        text: "Also the emails.",
        id,
      })).messages;
      assert.ok(queued !== undefined);
      const queue = yield* queueChanged(ask, owner, agent.id, {
        change: QUEUE_CHANGE.STEER,
        messageId: queued.id,
      });

      assert.deepEqual(queue.messages, []);
      assert.equal(yield* sentLineStands(owner, target.conversationId, sentLineId(id)), true);
      // Counted once, as it went, and as a message that waited in the queue.
      assert.deepEqual(countedWith(owner, SERVER_EVENT.MESSAGE_SEND).slice(countedBefore), [
        {
          runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
          machine: AGENT_MACHINE.VERCEL,
          agent_kind: AGENT_KIND.CODER,
          turn_running: true,
          queued: true,
        },
      ]);
    }),
  );

  /**
   * An agent whose turn ran while the owner queued `texts`, then ended: the
   * queue at that end as the runner's events route hands it on (with GitHub
   * and no network), and the queue as the owner reads it on the transcript.
   */
  const queuedBehindEndedTurn = (
    agentSessions: ReturnType<typeof fakeAgentSessions>,
    texts: readonly string[],
    ending: typeof RUN_STATUS.SUCCEEDED | typeof RUN_STATUS.FAILED = RUN_STATUS.SUCCEEDED,
  ) =>
    Effect.gen(function* () {
      const { agent, ask, owner, target, writer, turnId, github } = yield* messagedAgent(
        agentSessions,
        {
          running: true,
        },
      );
      for (const text of texts) {
        yield* queueChanged(ask, owner, agent.id, {
          change: QUEUE_CHANGE.ADD,
          text,
          id: randomUUID(),
        });
      }
      yield* writer.consume(target, {
        kind: RUN_EVENT.TURN_ENDED,
        conversationId: sessionKey(target.conversationId),
        turnId,
        sequence: 2,
        status: ending,
        responseIds: [],
        at: 0,
      });
      const stored = Option.getOrThrow(yield* readAgent(owner, agent.id));
      const sessionsFor = (account: string) =>
        Effect.succeed(agentSessions.agentSessions(`deployment:${account}`));
      const reach = Layer.mergeAll(github.layer, noNetwork);
      const turnEnded = queueAtTurnEnd(sessionsFor, stored).pipe(Effect.provide(reach));
      /** One queued message handed on, as a hand-off does once it read the queue's head. */
      const handedOn = (message: QueuedMessageRow) =>
        sendQueued(sessionsFor, stored, message).pipe(Effect.provide(reach));
      // Note that the read at once says whether it would have held, and when the clock alone moves it, which the page itself does not carry.
      const queued = Effect.map(
        ask(request(AGENT_MESSAGES, owner, { id: agent.id, wait: "none" })),
        (answered) => {
          // SAFETY: the route answers a page as a JSON object.
          const {
            holds: _holds,
            wakeIn: _wakeIn,
            ...page
          } = answered.body as Record<string, WireBoundaryInput>;
          return readAnswer(agentMessagesAnswerSchema, HOSTED_HTTP_STATUS.OK, {
            status: answered.status,
            body: page,
          }).queue;
        },
      );
      /** One queued message sent as a hand-off sends it, the hand-off cut off before the message left the queue. */
      const sentAlone = (message: QueuedMessageRow) =>
        Effect.flatMap(sessionsFor(message.userId), (agentSessionsAs) =>
          steerAgentWritten(
            agentSessionsAs,
            storeWriter({ tools: CODER_TOOL_SET }),
            message.userId,
            stored,
            {
              text: message.text,
              clientKey: message.id,
              sender: { kind: MESSAGE_SENDER.MEMBER, userId: message.userId },
            },
          ),
        ).pipe(Effect.provide(reach));
      /** The maintenance sweep's pass over the queues standing unpaused. */
      const swept = sweepAgentQueues(sessionsFor).pipe(Effect.provide(reach));
      return { agent, ask, owner, turnEnded, handedOn, sentAlone, swept, queued, stored };
    });

  /** How many times the harness was handed words holding `text`. */
  const handedCount = (agentSessions: ReturnType<typeof fakeAgentSessions>, text: string) =>
    agentSessions.sent.filter((each) => JSON.stringify(each.message.message).includes(text)).length;

  it.effect(
    "at the turn's end the queue hands on its first message alone, and nothing more while that one awaits its turn",
    () =>
      Effect.gen(function* () {
        const agentSessions = fakeAgentSessions();
        const { turnEnded, queued } = yield* queuedBehindEndedTurn(agentSessions, [
          "First",
          "Second",
        ]);

        yield* turnEnded;
        yield* turnEnded;
        assert.deepEqual(
          (yield* queued)?.messages.map((message) => message.text),
          ["Second"],
        );
        assert.equal(handedCount(agentSessions, "First"), 1);
        assert.equal(handedCount(agentSessions, "Second"), 0);
      }),
  );

  it.effect(
    "the turn's end stops at a message being edited, sending nothing past it, and Cancel lets the queue go on with it",
    () =>
      Effect.gen(function* () {
        const agentSessions = fakeAgentSessions();
        const { agent, ask, owner, turnEnded, queued } = yield* queuedBehindEndedTurn(
          agentSessions,
          ["Edited", "After"],
        );
        const [edited] = (yield* queued)?.messages ?? [];
        assert.ok(edited !== undefined);
        const marked = (editing: boolean) =>
          queueChanged(ask, owner, agent.id, {
            change: QUEUE_CHANGE.HOLD,
            messageId: edited.id,
            held: editing,
          });

        yield* marked(true);
        yield* turnEnded;
        assert.deepEqual(
          [handedCount(agentSessions, "Edited"), handedCount(agentSessions, "After")],
          [0, 0],
          "nothing past a message being edited goes",
        );

        yield* marked(false);
        assert.deepEqual(
          [handedCount(agentSessions, "Edited"), handedCount(agentSessions, "After")],
          [1, 0],
        );
      }),
  );

  it.effect(
    "a hand-off cut off after its message went, its claim still standing, is finished by the sweep once the claim lapses, the message sent once",
    () =>
      Effect.gen(function* () {
        const agentSessions = fakeAgentSessions();
        const { swept, queued, stored, sentAlone } = yield* queuedBehindEndedTurn(agentSessions, [
          "Cut off",
        ]);
        const head = Option.getOrThrow(yield* claimQueueHead(stored.id));
        yield* sentAlone(head);
        assert.deepEqual(
          (yield* queued)?.messages ?? [],
          [],
          "no window lists a message on its way",
        );

        yield* swept;
        assert.equal(
          handedCount(agentSessions, "Cut off"),
          1,
          "a standing claim is not handed on again",
        );
        yield* TestClock.adjust(Duration.millis(LINE_GRACE_MILLIS + 1));
        yield* swept;
        assert.equal(
          handedCount(agentSessions, "Cut off"),
          1,
          "the repeat under its key sends nothing",
        );
        assert.deepEqual(
          Option.getOrThrow(yield* readAgentQueue(stored.userId, stored.id)).messages,
          [],
          "the message left the queue rather than standing claimed",
        );
      }),
  );

  it.effect(
    "a turn that ended failed pauses the queue rather than handing on, keeping its messages",
    () =>
      Effect.gen(function* () {
        const agentSessions = fakeAgentSessions();
        const { turnEnded, queued } = yield* queuedBehindEndedTurn(
          agentSessions,
          ["First"],
          RUN_STATUS.FAILED,
        );

        yield* turnEnded;

        assert.equal(handedCount(agentSessions, "First"), 0);
        const queue = yield* queued;
        assert.deepEqual(
          queue?.messages.map((message) => message.text),
          ["First"],
        );
        assert.deepEqual(queue?.paused, { because: QUEUE_PAUSE.TURN_FAILED });
      }),
  );

  it.effect(
    "two hand-offs that read the same head at one turn's end, its IDLE's and its END's, send that message once",
    () =>
      Effect.gen(function* () {
        const agentSessions = fakeAgentSessions();
        const { handedOn, queued, stored } = yield* queuedBehindEndedTurn(agentSessions, [
          "First",
          "Second",
        ]);
        // Both hand-offs read the head before either sent it, as two racing at one end do.
        const head = Option.getOrThrow(yield* claimQueueHead(stored.id));

        yield* handedOn(head);
        yield* handedOn(head);

        assert.equal(handedCount(agentSessions, "First"), 1);
        const queue = yield* queued;
        assert.deepEqual(
          queue?.messages.map((message) => message.text),
          ["Second"],
        );
        assert.equal(queue?.paused, undefined, "the hand-off that lost the race pauses nothing");
      }),
  );

  it.effect(
    "a hand-off the harness refuses keeps the message in its place and pauses the queue under the refusal",
    () =>
      Effect.gen(function* () {
        const agentSessions = fakeAgentSessions({ sends: SESSION_SEND_OUTCOME.FAILED });
        const { turnEnded, queued } = yield* queuedBehindEndedTurn(agentSessions, [
          "First",
          "Second",
        ]);
        const before = (yield* queued)?.revision ?? 0;

        yield* turnEnded;

        const queue = yield* queued;
        assert.ok(
          (queue?.revision ?? 0) > before,
          "the refusal's pause moved the queue on, which wakes its readers",
        );
        assert.deepEqual(
          queue?.messages.map((message) => message.text),
          ["First", "Second"],
        );
        assert.equal(queue?.paused?.because, QUEUE_PAUSE.REFUSED);
        assert.notEqual(queue?.paused?.refusal, undefined);
      }),
  );

  it.effect(
    "a message queued while the agent starts waits behind its first turn and goes once that turn ends",
    () =>
      Effect.gen(function* () {
        const agentSessions = fakeAgentSessions();
        const { agent, ask, owner, target, writer, github } = yield* messagedAgent(
          agentSessions,
          undefined,
        );
        const sentBefore = agentSessions.sent.length;
        const queue = yield* queueChanged(ask, owner, agent.id, {
          change: QUEUE_CHANGE.ADD,
          text: "Then open the pull request.",
          id: randomUUID(),
        });
        assert.deepEqual(
          queue.messages.map((message) => message.text),
          ["Then open the pull request."],
        );
        assert.equal(agentSessions.sent.length, sentBefore, "nothing goes while the agent starts");

        // The first turn opens, takes the Start's line, and ends.
        const turnId = randomUUID();
        yield* writer.enqueueTurn(target, {
          turnId,
          origin: TURN_ORIGIN.TYPED,
          runtimeTurnId: "turn_0",
        });
        yield* writer.consume(target, {
          kind: RUN_EVENT.TURN_STARTED,
          conversationId: sessionKey(target.conversationId),
          turnId,
          sequence: 1,
          origin: RUN_TURN_ORIGIN.TYPED,
          trigger: TURN_TRIGGER.ASK,
          at: 0,
        });
        yield* writer.takeAwaitingLine(target, { text: SNAPSHOT, turnId });
        yield* writer.consume(target, {
          kind: RUN_EVENT.TURN_ENDED,
          conversationId: sessionKey(target.conversationId),
          turnId,
          sequence: 2,
          status: RUN_STATUS.SUCCEEDED,
          responseIds: [],
          at: 0,
        });
        const stored = Option.getOrThrow(yield* readAgent(owner, agent.id));
        const sessionsFor = (account: string) =>
          Effect.succeed(agentSessions.agentSessions(`deployment:${account}`));
        yield* queueAtTurnEnd(sessionsFor, stored).pipe(
          Effect.provide(Layer.mergeAll(github.layer, noNetwork)),
        );

        assert.equal(handedCount(agentSessions, "Then open the pull request."), 1);
      }),
  );

  it.effect(
    "Resume answers before its hand-off runs, and the answer already leaves out the message it is sending",
    () =>
      Effect.gen(function* () {
        const agentSessions = fakeAgentSessions();
        const kept = keptAfterResponse();
        const { agent, ask, owner } = yield* messagedAgent(
          agentSessions,
          { running: true },
          undefined,
          kept.layer,
        );
        yield* queueChanged(ask, owner, agent.id, {
          change: QUEUE_CHANGE.ADD,
          text: "Open the pull request.",
          id: randomUUID(),
        });
        yield* ask(request(AGENT_STOP, owner, { method: "POST", id: agent.id }));
        yield* kept.run;
        const sentBefore = agentSessions.sent.length;

        const resumed = yield* queueChanged(ask, owner, agent.id, {
          change: QUEUE_CHANGE.RESUME,
        });

        assert.deepEqual(resumed.messages, [], "the message about to go is not listed");
        assert.equal(resumed.paused, undefined);
        assert.equal(agentSessions.sent.length, sentBefore, "the answer is out before the send");
        yield* kept.run;
        assert.equal(handedCount(agentSessions, "Open the pull request."), 1);
      }),
  );

  it.effect(
    "a Resume between the Stop and the stopped turn's end stands: the turn's end pauses nothing again",
    () =>
      Effect.gen(function* () {
        const agentSessions = fakeAgentSessions();
        const { agent, ask, owner, target, writer, turnId, github } = yield* messagedAgent(
          agentSessions,
          {
            running: true,
          },
        );
        const [queued] = (yield* queueChanged(ask, owner, agent.id, {
          change: QUEUE_CHANGE.ADD,
          text: "Open the pull request.",
          id: randomUUID(),
        })).messages;
        assert.ok(queued !== undefined);
        // Held by an edit, so the Resume hands nothing on and the queue's pause alone is at stake.
        yield* queueChanged(ask, owner, agent.id, {
          change: QUEUE_CHANGE.HOLD,
          messageId: queued.id,
          held: true,
        });
        yield* ask(request(AGENT_STOP, owner, { method: "POST", id: agent.id }));
        yield* queueChanged(ask, owner, agent.id, { change: QUEUE_CHANGE.RESUME });

        yield* writer.consume(target, {
          kind: RUN_EVENT.TURN_ENDED,
          conversationId: sessionKey(target.conversationId),
          turnId,
          sequence: 2,
          status: RUN_STATUS.CANCELED,
          responseIds: [],
          at: 0,
        });
        const stored = Option.getOrThrow(yield* readAgent(owner, agent.id));
        const sessionsFor = (account: string) =>
          Effect.succeed(agentSessions.agentSessions(`deployment:${account}`));
        yield* queueAtTurnEnd(sessionsFor, stored).pipe(
          Effect.provide(Layer.mergeAll(github.layer, noNetwork)),
        );

        const page = readAnswer(
          agentMessagesAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(AGENT_MESSAGES, owner, { id: agent.id })),
        );
        assert.equal(page.queue?.paused, undefined);
      }),
  );

  it.effect("a message being sent is no member's to delete, and deleting it says so", () =>
    Effect.gen(function* () {
      const agentSessions = fakeAgentSessions();
      const { agent, ask, owner } = yield* messagedAgent(agentSessions, { running: true });
      const [queued] = (yield* queueChanged(ask, owner, agent.id, {
        change: QUEUE_CHANGE.ADD,
        text: "Open the pull request.",
        id: randomUUID(),
      })).messages;
      assert.ok(queued !== undefined);
      yield* claimQueueHead(agent.id);

      const deleted = yield* ask(
        request(AGENT_QUEUE, owner, {
          method: "POST",
          id: agent.id,
          body: { change: QUEUE_CHANGE.DELETE, messageId: queued.id },
        }),
      );

      assert.equal(deleted.status, HOSTED_HTTP_STATUS.NOT_FOUND);
    }),
  );

  it.effect(
    "a message queued after the turn's end found nothing to hand on still goes at once",
    () =>
      Effect.gen(function* () {
        const agentSessions = fakeAgentSessions();
        const { agent, ask, owner, turnEnded, queued } = yield* queuedBehindEndedTurn(
          agentSessions,
          [],
        );
        yield* turnEnded;

        yield* queueChanged(ask, owner, agent.id, {
          change: QUEUE_CHANGE.ADD,
          text: "Late",
          id: randomUUID(),
        });

        assert.equal(handedCount(agentSessions, "Late"), 1);
        assert.deepEqual((yield* queued)?.messages ?? [], []);
      }),
  );

  it.effect(
    "a Stop pauses what is queued behind the turn, and Resume lets the queue go again",
    () =>
      Effect.gen(function* () {
        const agentSessions = fakeAgentSessions();
        const { agent, ask, owner } = yield* messagedAgent(agentSessions, { running: true });
        yield* queueChanged(ask, owner, agent.id, {
          change: QUEUE_CHANGE.ADD,
          text: "Then open a pull request.",
          id: randomUUID(),
        });
        yield* ask(request(AGENT_STOP, owner, { method: "POST", id: agent.id }));
        const page = readAnswer(
          agentMessagesAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(AGENT_MESSAGES, owner, { id: agent.id })),
        );
        assert.deepEqual(page.queue?.paused, { because: QUEUE_PAUSE.STOPPED });

        const resumed = yield* queueChanged(ask, owner, agent.id, { change: QUEUE_CHANGE.RESUME });
        assert.equal(resumed.paused, undefined);
      }),
  );

  it.effect(
    "only the agent's starter changes its queue: a teammate who may message the agent reads its queue and changes none of it",
    () =>
      Effect.gen(function* () {
        const opened = yield* messagedAgent(fakeAgentSessions(), { running: true });
        yield* joinWorkspace(opened.task.workspaceId, opened.other);
        const { agent, ask, owner, other } = opened;
        yield* queueChanged(ask, owner, agent.id, {
          change: QUEUE_CHANGE.ADD,
          text: "Open the pull request.",
          id: randomUUID(),
        });

        const changed = yield* ask(
          request(AGENT_QUEUE, undefined, {
            method: "POST",
            id: agent.id,
            cookie: sessionCookieOf(other),
            body: { change: QUEUE_CHANGE.ADD, text: "Also the docs.", id: randomUUID() },
          }),
        );

        assert.equal(changed.status, HOSTED_HTTP_STATUS.FORBIDDEN);
        const read = readAnswer(
          agentMessagesAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(
            request(AGENT_MESSAGES, undefined, { id: agent.id, cookie: sessionCookieOf(other) }),
          ),
        );
        assert.deepEqual(
          read.queue?.messages.map((message) => message.text),
          ["Open the pull request."],
        );
      }),
  );

  it.effect(
    "a turn's end that lands while the Stop's cancel is out finds the queue already paused, and sends nothing",
    () =>
      Effect.gen(function* () {
        let racing: Effect.Effect<void> = Effect.void;
        const agentSessions = fakeAgentSessions({ canceling: Effect.suspend(() => racing) });
        const { agent, ask, owner, target, writer, turnId, github } = yield* messagedAgent(
          agentSessions,
          {
            running: true,
          },
        );
        yield* queueChanged(ask, owner, agent.id, {
          change: QUEUE_CHANGE.ADD,
          text: "Open the pull request.",
          id: randomUUID(),
        });
        const stored = Option.getOrThrow(yield* readAgent(owner, agent.id));
        const sessionsFor = (account: string) =>
          Effect.succeed(agentSessions.agentSessions(`deployment:${account}`));
        // The runner ends the turn as stopped, and its events hand on the queue, before the harness answers the cancel.
        const database = yield* Effect.context<DatabaseServices>();
        racing = Effect.andThen(
          writer.consume(target, {
            kind: RUN_EVENT.TURN_ENDED,
            conversationId: sessionKey(target.conversationId),
            turnId,
            sequence: 2,
            status: RUN_STATUS.CANCELED,
            responseIds: [],
            at: 0,
          }),
          queueAtTurnEnd(sessionsFor, stored).pipe(
            Effect.provide(Layer.mergeAll(github.layer, noNetwork)),
          ),
        ).pipe(Effect.provideContext(database), Effect.orDie);

        yield* ask(request(AGENT_STOP, owner, { method: "POST", id: agent.id }));

        assert.equal(
          handedCount(agentSessions, "Open the pull request."),
          0,
          "nothing went after the Stop",
        );
        const page = readAnswer(
          agentMessagesAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(AGENT_MESSAGES, owner, { id: agent.id })),
        );
        assert.equal(page.queue?.paused?.because, QUEUE_PAUSE.STOPPED);
      }),
  );

  it.effect(
    "a turn canceled other than by the Stop route, as a Continue, another agent's stop_agent, or a rewind cancels it, pauses the queue before the cancel",
    () =>
      Effect.gen(function* () {
        const agentSessions = fakeAgentSessions();
        const { agent, ask, owner, github } = yield* messagedAgent(agentSessions, {
          running: true,
        });
        yield* queueChanged(ask, owner, agent.id, {
          change: QUEUE_CHANGE.ADD,
          text: "Open the pull request.",
          id: randomUUID(),
        });
        const stored = Option.getOrThrow(yield* readAgent(owner, agent.id));

        yield* canceledTurn(
          Effect.succeed(agentSessions.agentSessions(`deployment:${owner}`)),
          storeWriter({ tools: CODER_TOOL_SET }),
          stored,
        ).pipe(Effect.provide(Layer.mergeAll(github.layer, noNetwork)));

        const page = readAnswer(
          agentMessagesAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(AGENT_MESSAGES, owner, { id: agent.id })),
        );
        assert.equal(page.queue?.paused?.because, QUEUE_PAUSE.STOPPED);
        assert.equal(handedCount(agentSessions, "Open the pull request."), 0);
      }),
  );

  it.effect(
    "a Stop pauses what is queued though the turn was already over, so no sweep sends it after the Stop",
    () =>
      Effect.gen(function* () {
        const agentSessions = fakeAgentSessions();
        // The turn ended with a message still queued, which the turn's end has not handed on yet.
        const { agent, ask, owner, queued, swept } = yield* queuedBehindEndedTurn(agentSessions, [
          "Open the pull request.",
        ]);

        yield* ask(request(AGENT_STOP, owner, { method: "POST", id: agent.id }));
        yield* swept;

        assert.equal((yield* queued)?.paused?.because, QUEUE_PAUSE.STOPPED);
        assert.equal(handedCount(agentSessions, "Open the pull request."), 0);
      }),
  );
});
