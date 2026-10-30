import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import type { DatabaseServices } from "@luke/database/core/query";
import {
  claimQueueHead,
  type QueuedMessageRow,
  readAgentQueue,
} from "@luke/database/models/agent-queue-store";
import { readAgent } from "@luke/database/models/agent-store";
import { sentLineStands } from "@luke/database/models/message-reads";
import { storeWriter } from "@luke/database/models/writer";
import { MESSAGE_SENDER } from "@luke/database/storage-vocabulary";
import { getTestDB, joinWorkspace } from "@luke/database/testing";
import { QUEUE_PAUSE } from "@luke/features/agent-queue-wire";
import { LINE_GRACE_MILLIS } from "@luke/features/agent-status";
import {
  AGENT_ATTACHMENT_TYPE,
  agentMessagesAnswerSchema,
  agentQueueAnswerSchema,
  QUEUE_CHANGE,
} from "@luke/features/agent-wire";
import type { WireBoundaryInput } from "@luke/wire";
import { sentLineId } from "@luke/wire/host-ids";
import { noNetwork } from "@luke/wire/testing";
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
import { keptAfterResponse } from "../http/after-response.js";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import {
  AGENT_MESSAGES,
  AGENT_PICTURE,
  AGENT_STOP,
  type Answer,
  fakeEve,
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
import { cancelledTurn } from "./coder-host/stop.js";
import { CODER_TOOL_SET } from "./coder-host/tool-set.js";
import { EVE_SEND_OUTCOME } from "./eve-host/eve-sessions.js";

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
        const eve = fakeEve();
        const { agent, ask, owner } = yield* messagedAgent(eve, { running: true });
        const sentBefore = eve.sent.length;
        for (const text of ["First", "Second", "Third"]) {
          yield* queueChanged(ask, owner, agent.id, {
            change: QUEUE_CHANGE.ADD,
            text,
            clientKey: randomUUID(),
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

        assert.equal(eve.sent.length, sentBefore, "nothing goes while the turn runs");
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

  /** The names of the files eve was last handed, in order. */
  const handedFiles = (eve: ReturnType<typeof fakeEve>) =>
    receiptOf(eve.sent.at(-1)?.message.message).flatMap((part) =>
      part.type === "file" ? [part.filename] : [],
    );

  /** A message queued with an image behind the running turn, and held for an edit. */
  const heldWithImage = (eve: ReturnType<typeof fakeEve>) =>
    Effect.gen(function* () {
      const started = yield* messagedAgent(eve, { running: true });
      const { agent, ask, owner } = started;
      const [message] = (yield* queueChanged(ask, owner, agent.id, {
        change: QUEUE_CHANGE.ADD,
        text: "Match this.",
        clientKey: randomUUID(),
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
        const eve = fakeEve();
        const { agent, ask, fetch, owner, other, message, target, writer, turnId, github } =
          yield* heldWithImage(eve);
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
          (account) => Effect.succeed(eve.eve(`deployment:${account}`)),
          stored,
        ).pipe(Effect.provide(Layer.mergeAll(github.layer, noNetwork)));

        assert.deepEqual(handedFiles(eve), ["spec.pdf"]);
      }),
  );

  it.effect(
    "an edit steered goes now with the edit's words and files in place of the message's",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { agent, ask, owner, message } = yield* heldWithImage(eve);

        const queue = yield* queueChanged(ask, owner, agent.id, {
          change: QUEUE_CHANGE.STEER,
          messageId: message.id,
          text: "Use the spec instead.",
          attachments: [SPEC],
        });

        assert.deepEqual(queue.messages, []);
        assert.deepEqual(handedFiles(eve), ["spec.pdf"]);
        assert.ok(
          JSON.stringify(eve.sent.at(-1)?.message.message).includes("Use the spec instead."),
        );
      }),
  );

  it.effect(
    "a message queued while the agent stands idle goes at once as its member's own message, under its own key, and leaves the queue",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { agent, ask, owner, target } = yield* messagedAgent(eve, { running: false });
        const clientKey = randomUUID();
        const queue = yield* queueChanged(ask, owner, agent.id, {
          change: QUEUE_CHANGE.ADD,
          text: "Now the dark variant.",
          clientKey,
        });

        assert.deepEqual(queue.messages, []);
        assert.ok(
          JSON.stringify(eve.sent.at(-1)?.message.message).includes("Now the dark variant."),
        );
        assert.equal(
          yield* sentLineStands(owner, target.conversationId, sentLineId(clientKey)),
          true,
        );
      }),
  );

  it.effect(
    "every change to the queue moves its revision on, and the page still carries the queue once it stands empty",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { agent, ask, owner } = yield* messagedAgent(eve, { running: true });
        const revisions: number[] = [];
        const changed = (change: WireBoundaryInput) =>
          Effect.tap(queueChanged(ask, owner, agent.id, change), (queue) =>
            Effect.sync(() => revisions.push(queue.revision)),
          );
        const [queued] = (yield* changed({
          change: QUEUE_CHANGE.ADD,
          text: "Run tests",
          clientKey: randomUUID(),
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
        const eve = fakeEve();
        const { agent, ask, owner } = yield* messagedAgent(eve, { running: true });
        const [queued] = (yield* queueChanged(ask, owner, agent.id, {
          change: QUEUE_CHANGE.ADD,
          text: "Run tests",
          clientKey: randomUUID(),
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
        const said = eve.sent.map((each) => JSON.stringify(each.message.message));
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
      const eve = fakeEve();
      const { agent, ask, owner, target } = yield* messagedAgent(eve, { running: true });
      const clientKey = randomUUID();
      const [queued] = (yield* queueChanged(ask, owner, agent.id, {
        change: QUEUE_CHANGE.ADD,
        text: "Also the emails.",
        clientKey,
      })).messages;
      assert.ok(queued !== undefined);
      const queue = yield* queueChanged(ask, owner, agent.id, {
        change: QUEUE_CHANGE.STEER,
        messageId: queued.id,
      });

      assert.deepEqual(queue.messages, []);
      assert.equal(
        yield* sentLineStands(owner, target.conversationId, sentLineId(clientKey)),
        true,
      );
    }),
  );

  /**
   * An agent whose turn ran while the owner queued `texts`, then ended: the
   * queue at that end as the runner's events route hands it on (with GitHub
   * and no network), and the queue as the owner reads it on the transcript.
   */
  const queuedBehindEndedTurn = (
    eve: ReturnType<typeof fakeEve>,
    texts: readonly string[],
    ending: typeof RUN_STATUS.SUCCEEDED | typeof RUN_STATUS.FAILED = RUN_STATUS.SUCCEEDED,
  ) =>
    Effect.gen(function* () {
      const { agent, ask, owner, target, writer, turnId, github } = yield* messagedAgent(eve, {
        running: true,
      });
      for (const text of texts) {
        yield* queueChanged(ask, owner, agent.id, {
          change: QUEUE_CHANGE.ADD,
          text,
          clientKey: randomUUID(),
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
      const eveFor = (account: string) => Effect.succeed(eve.eve(`deployment:${account}`));
      const reach = Layer.mergeAll(github.layer, noNetwork);
      const turnEnded = queueAtTurnEnd(eveFor, stored).pipe(Effect.provide(reach));
      /** One queued message handed on, as a hand-off does once it read the queue's head. */
      const handedOn = (message: QueuedMessageRow) =>
        sendQueued(eveFor, stored, message).pipe(Effect.provide(reach));
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
        Effect.flatMap(eveFor(message.userId), (eveAs) =>
          steerAgentWritten(eveAs, storeWriter({ tools: CODER_TOOL_SET }), message.userId, stored, {
            text: message.text,
            clientKey: message.clientKey,
            sender: { kind: MESSAGE_SENDER.MEMBER, userId: message.userId },
          }),
        ).pipe(Effect.provide(reach));
      /** The maintenance sweep's pass over the queues standing unpaused. */
      const swept = sweepAgentQueues(eveFor).pipe(Effect.provide(reach));
      return { agent, ask, owner, turnEnded, handedOn, sentAlone, swept, queued, stored };
    });

  /** How many times eve was handed words holding `text`. */
  const handedCount = (eve: ReturnType<typeof fakeEve>, text: string) =>
    eve.sent.filter((each) => JSON.stringify(each.message.message).includes(text)).length;

  it.effect(
    "at the turn's end the queue hands on its first message alone, and nothing more while that one awaits its turn",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { turnEnded, queued } = yield* queuedBehindEndedTurn(eve, ["First", "Second"]);

        yield* turnEnded;
        yield* turnEnded;
        assert.deepEqual(
          (yield* queued)?.messages.map((message) => message.text),
          ["Second"],
        );
        assert.equal(handedCount(eve, "First"), 1);
        assert.equal(handedCount(eve, "Second"), 0);
      }),
  );

  it.effect(
    "a message an edit held past its turn's end is passed over, keeps its place, and goes once its hold lapses",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { agent, ask, owner, turnEnded, swept, queued } = yield* queuedBehindEndedTurn(eve, [
          "Edited",
        ]);
        const [edited] = (yield* queued)?.messages ?? [];
        assert.ok(edited !== undefined);
        yield* queueChanged(ask, owner, agent.id, {
          change: QUEUE_CHANGE.HOLD,
          messageId: edited.id,
          held: true,
        });

        yield* turnEnded;
        assert.equal(
          handedCount(eve, "Edited"),
          0,
          "the turn's end passes over a message being edited",
        );

        // The edit's window closed without letting go: its hold lapses, and the sweep hands it on.
        yield* TestClock.adjust(Duration.millis(LINE_GRACE_MILLIS + 1));
        yield* swept;
        yield* swept;
        assert.equal(handedCount(eve, "Edited"), 1);
        assert.deepEqual((yield* queued)?.messages ?? [], []);
      }),
  );

  it.effect(
    "a hand-off cut off after its message went, its claim still standing, is finished by the sweep once the claim lapses, the message sent once",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { swept, queued, stored, sentAlone } = yield* queuedBehindEndedTurn(eve, ["Cut off"]);
        const head = Option.getOrThrow(yield* claimQueueHead(stored.id));
        yield* sentAlone(head);
        assert.deepEqual(
          (yield* queued)?.messages ?? [],
          [],
          "no window lists a message on its way",
        );

        yield* swept;
        assert.equal(handedCount(eve, "Cut off"), 1, "a standing claim is not handed on again");
        yield* TestClock.adjust(Duration.millis(LINE_GRACE_MILLIS + 1));
        yield* swept;
        assert.equal(handedCount(eve, "Cut off"), 1, "the repeat under its key sends nothing");
        assert.deepEqual(
          Option.getOrThrow(yield* readAgentQueue(stored.userId, stored.id)).messages,
          [],
          "the message left the queue rather than standing claimed",
        );
      }),
  );

  it.effect(
    "an idle agent's page names when a queued message's edit lapses, which moves the queue with no row written",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { agent, ask, owner, queued } = yield* queuedBehindEndedTurn(eve, ["Edited"]);
        const [edited] = (yield* queued)?.messages ?? [];
        assert.ok(edited !== undefined);
        yield* queueChanged(ask, owner, agent.id, {
          change: QUEUE_CHANGE.HOLD,
          messageId: edited.id,
          held: true,
        });

        const read = yield* ask(request(AGENT_MESSAGES, owner, { id: agent.id, wait: "none" }));

        // SAFETY: the route answers a page as a JSON object.
        const body = read.body as Record<string, WireBoundaryInput>;
        assert.equal(body.holds, false, "nothing runs, so the read would not hold");
        assert.equal(body.wakeIn, LINE_GRACE_MILLIS);
      }),
  );

  it.effect(
    "a turn that ended failed pauses the queue rather than handing on, keeping its messages",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { turnEnded, queued } = yield* queuedBehindEndedTurn(
          eve,
          ["First"],
          RUN_STATUS.FAILED,
        );

        yield* turnEnded;

        assert.equal(handedCount(eve, "First"), 0);
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
        const eve = fakeEve();
        const { handedOn, queued, stored } = yield* queuedBehindEndedTurn(eve, ["First", "Second"]);
        // Both hand-offs read the head before either sent it, as two racing at one end do.
        const head = Option.getOrThrow(yield* claimQueueHead(stored.id));

        yield* handedOn(head);
        yield* handedOn(head);

        assert.equal(handedCount(eve, "First"), 1);
        const queue = yield* queued;
        assert.deepEqual(
          queue?.messages.map((message) => message.text),
          ["Second"],
        );
        assert.equal(queue?.paused, undefined, "the hand-off that lost the race pauses nothing");
      }),
  );

  it.effect(
    "a hand-off eve refuses keeps the message in its place and pauses the queue under the refusal",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve({ sends: EVE_SEND_OUTCOME.FAILED });
        const { turnEnded, queued } = yield* queuedBehindEndedTurn(eve, ["First", "Second"]);
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
        const eve = fakeEve();
        const { agent, ask, owner, target, writer, github } = yield* messagedAgent(eve, undefined);
        const sentBefore = eve.sent.length;
        const queue = yield* queueChanged(ask, owner, agent.id, {
          change: QUEUE_CHANGE.ADD,
          text: "Then open the pull request.",
          clientKey: randomUUID(),
        });
        assert.deepEqual(
          queue.messages.map((message) => message.text),
          ["Then open the pull request."],
        );
        assert.equal(eve.sent.length, sentBefore, "nothing goes while the agent starts");

        // The first turn opens, takes the Start's line, and ends.
        const turnId = randomUUID();
        yield* writer.enqueueTurn(target, {
          turnId,
          origin: TURN_ORIGIN.TYPED,
          eveTurnId: "turn_0",
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
        const eveFor = (account: string) => Effect.succeed(eve.eve(`deployment:${account}`));
        yield* queueAtTurnEnd(eveFor, stored).pipe(
          Effect.provide(Layer.mergeAll(github.layer, noNetwork)),
        );

        assert.equal(handedCount(eve, "Then open the pull request."), 1);
      }),
  );

  it.effect(
    "Resume answers before its hand-off runs, and the answer already leaves out the message it is sending",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const kept = keptAfterResponse();
        const { agent, ask, owner } = yield* messagedAgent(
          eve,
          { running: true },
          undefined,
          kept.layer,
        );
        yield* queueChanged(ask, owner, agent.id, {
          change: QUEUE_CHANGE.ADD,
          text: "Open the pull request.",
          clientKey: randomUUID(),
        });
        yield* ask(request(AGENT_STOP, owner, { method: "POST", id: agent.id }));
        yield* kept.run;
        const sentBefore = eve.sent.length;

        const resumed = yield* queueChanged(ask, owner, agent.id, {
          change: QUEUE_CHANGE.RESUME,
        });

        assert.deepEqual(resumed.messages, [], "the message about to go is not listed");
        assert.equal(resumed.paused, undefined);
        assert.equal(eve.sent.length, sentBefore, "the answer is out before the send");
        yield* kept.run;
        assert.equal(handedCount(eve, "Open the pull request."), 1);
      }),
  );

  it.effect(
    "a Resume between the Stop and the stopped turn's end stands: the turn's end pauses nothing again",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { agent, ask, owner, target, writer, turnId, github } = yield* messagedAgent(eve, {
          running: true,
        });
        const [queued] = (yield* queueChanged(ask, owner, agent.id, {
          change: QUEUE_CHANGE.ADD,
          text: "Open the pull request.",
          clientKey: randomUUID(),
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
          status: RUN_STATUS.CANCELLED,
          responseIds: [],
          at: 0,
        });
        const stored = Option.getOrThrow(yield* readAgent(owner, agent.id));
        const eveFor = (account: string) => Effect.succeed(eve.eve(`deployment:${account}`));
        yield* queueAtTurnEnd(eveFor, stored).pipe(
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
      const eve = fakeEve();
      const { agent, ask, owner } = yield* messagedAgent(eve, { running: true });
      const [queued] = (yield* queueChanged(ask, owner, agent.id, {
        change: QUEUE_CHANGE.ADD,
        text: "Open the pull request.",
        clientKey: randomUUID(),
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
        const eve = fakeEve();
        const { agent, ask, owner, turnEnded, queued } = yield* queuedBehindEndedTurn(eve, []);
        yield* turnEnded;

        yield* queueChanged(ask, owner, agent.id, {
          change: QUEUE_CHANGE.ADD,
          text: "Late",
          clientKey: randomUUID(),
        });

        assert.equal(handedCount(eve, "Late"), 1);
        assert.deepEqual((yield* queued)?.messages ?? [], []);
      }),
  );

  it.effect(
    "a Stop pauses what is queued behind the turn, and Resume lets the queue go again",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { agent, ask, owner } = yield* messagedAgent(eve, { running: true });
        yield* queueChanged(ask, owner, agent.id, {
          change: QUEUE_CHANGE.ADD,
          text: "Then open a pull request.",
          clientKey: randomUUID(),
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
        const opened = yield* messagedAgent(fakeEve(), { running: true });
        yield* joinWorkspace(opened.task.workspaceId, opened.other);
        const { agent, ask, owner, other } = opened;
        yield* queueChanged(ask, owner, agent.id, {
          change: QUEUE_CHANGE.ADD,
          text: "Open the pull request.",
          clientKey: randomUUID(),
        });

        const changed = yield* ask(
          request(AGENT_QUEUE, undefined, {
            method: "POST",
            id: agent.id,
            cookie: sessionCookieOf(other),
            body: { change: QUEUE_CHANGE.ADD, text: "Also the docs.", clientKey: randomUUID() },
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
        const eve = fakeEve({ cancelling: Effect.suspend(() => racing) });
        const { agent, ask, owner, target, writer, turnId, github } = yield* messagedAgent(eve, {
          running: true,
        });
        yield* queueChanged(ask, owner, agent.id, {
          change: QUEUE_CHANGE.ADD,
          text: "Open the pull request.",
          clientKey: randomUUID(),
        });
        const stored = Option.getOrThrow(yield* readAgent(owner, agent.id));
        const eveFor = (account: string) => Effect.succeed(eve.eve(`deployment:${account}`));
        // The runner ends the turn as stopped, and its events hand on the queue, before eve answers the cancel.
        const database = yield* Effect.context<DatabaseServices>();
        racing = Effect.andThen(
          writer.consume(target, {
            kind: RUN_EVENT.TURN_ENDED,
            conversationId: sessionKey(target.conversationId),
            turnId,
            sequence: 2,
            status: RUN_STATUS.CANCELLED,
            responseIds: [],
            at: 0,
          }),
          queueAtTurnEnd(eveFor, stored).pipe(
            Effect.provide(Layer.mergeAll(github.layer, noNetwork)),
          ),
        ).pipe(Effect.provideContext(database), Effect.orDie);

        yield* ask(request(AGENT_STOP, owner, { method: "POST", id: agent.id }));

        assert.equal(handedCount(eve, "Open the pull request."), 0, "nothing went after the Stop");
        const page = readAnswer(
          agentMessagesAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(AGENT_MESSAGES, owner, { id: agent.id })),
        );
        assert.equal(page.queue?.paused?.because, QUEUE_PAUSE.STOPPED);
      }),
  );

  it.effect(
    "a turn cancelled other than by the Stop route, as a Continue, another agent's stop_agent, or a rewind cancels it, pauses the queue before the cancel",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { agent, ask, owner, github } = yield* messagedAgent(eve, { running: true });
        yield* queueChanged(ask, owner, agent.id, {
          change: QUEUE_CHANGE.ADD,
          text: "Open the pull request.",
          clientKey: randomUUID(),
        });
        const stored = Option.getOrThrow(yield* readAgent(owner, agent.id));

        yield* cancelledTurn(
          Effect.succeed(eve.eve(`deployment:${owner}`)),
          storeWriter({ tools: CODER_TOOL_SET }),
          stored,
        ).pipe(Effect.provide(Layer.mergeAll(github.layer, noNetwork)));

        const page = readAnswer(
          agentMessagesAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(AGENT_MESSAGES, owner, { id: agent.id })),
        );
        assert.equal(page.queue?.paused?.because, QUEUE_PAUSE.STOPPED);
        assert.equal(handedCount(eve, "Open the pull request."), 0);
      }),
  );

  it.effect(
    "a Stop pauses what is queued though the turn was already over, so no sweep sends it after the Stop",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        // The turn ended with a message still queued, which the turn's end has not handed on yet.
        const { agent, ask, owner, queued, swept } = yield* queuedBehindEndedTurn(eve, [
          "Open the pull request.",
        ]);

        yield* ask(request(AGENT_STOP, owner, { method: "POST", id: agent.id }));
        yield* swept;

        assert.equal((yield* queued)?.paused?.because, QUEUE_PAUSE.STOPPED);
        assert.equal(handedCount(eve, "Open the pull request."), 0);
      }),
  );
});
