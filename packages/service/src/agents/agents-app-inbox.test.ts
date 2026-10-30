/**
 * agents-app-inbox.test.ts -- the developer's inbox through the hosted router, over a fake eve.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import {
  createAutomation,
  recordAutomationRun,
  settleAutomationRun,
} from "@luke/database/models/automation-store";
import { readMessageByClientId } from "@luke/database/models/message-reads";
import { claimRuntimeSession } from "@luke/database/models/recorded-session";
import { savePlanText, updateTask } from "@luke/database/models/task-store";
import { storeWriter } from "@luke/database/models/writer";
import { inboxItem } from "@luke/database/schemas/inbox";
import { conversations } from "@luke/database/schemas/storage";
import { getTestDB, joinWorkspace, startTask } from "@luke/database/testing";
import { HOSTED_API_ERROR } from "@luke/features";
import {
  ACCOUNT_INBOX_ARCHIVED,
  accountInboxAnswerSchema,
} from "@luke/features/account-inbox-wire";
import {
  AGENT_ATTACHMENT_TYPE,
  AGENT_STATUS,
  agentMessagesAnswerSchema,
} from "@luke/features/agent-wire";
import {
  AUTOMATION_ACTION,
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_FIRING,
  AUTOMATION_RUN_REASON,
  AUTOMATION_RUN_STATUS,
  AUTOMATION_TRIGGER,
} from "@luke/features/automation-wire";
import {
  INBOX_ANSWER_LEAD,
  INBOX_APPROVAL_OPTION,
  INBOX_ASK,
  INBOX_ASK_STATUS,
  INBOX_CLOSE_LEAD,
  INBOX_IMAGE_TYPE,
  INBOX_MESSAGE_AUTHOR,
  INBOX_MESSAGE_LEAD,
  INBOX_REPLY,
  INBOX_STATUS,
  type InboxItem,
  inboxAnsweredSchema,
  inboxAnswerSchema,
  inboxMessagedSchema,
  inboxReadAllSchema,
  inboxReadStateSchema,
} from "@luke/features/inbox-wire";
import { TASK_STATUS } from "@luke/features/task-wire";
import type { WireBoundaryInput } from "@luke/wire";
import { sentLineId } from "@luke/wire/host-ids";
import { MockLanguageModelV4 } from "ai/test";
import { eq } from "drizzle-orm";
import { Clock, DateTime, Duration, Effect, Fiber, Option, Result } from "effect";
import { TestClock } from "effect/testing";
import {
  RUN_EVENT,
  RUN_STATUS,
  RUN_TURN_ORIGIN,
  sessionKey,
  TURN_ORIGIN,
  TURN_TRIGGER,
  userMessage,
  userMetadataOf,
} from "../core.js";
import { SERVER_EVENT } from "../events/server-events.js";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import type { InboxTitleModelOf } from "../inbox/inbox-procedures.js";
import { answerInboxAsk, closeInboxItem, postInboxThread } from "../inbox/inbox-store.js";
import {
  ACCOUNT_INBOX,
  AGENT_MESSAGES,
  countedFor,
  countedProperties,
  deploymentFor,
  fakeEve,
  INBOX_ATTACHMENT,
  INBOX_CLOSE,
  INBOX_ITEM,
  INBOX_ITEM_READ,
  INBOX_MESSAGES,
  INBOX_READ,
  openAskOf,
  openTask,
  PNG,
  RELAY_FULL_NAME,
  readAnswer,
  refusal,
  request,
  SAVED,
  SNAPSHOT,
  sessionCookieOf,
  startedAgent,
  TASK_INBOX,
  type ThreadPost,
  userTexts,
} from "../testing/agents-app-support.js";
import { openedPagePolicy, SANDBOXED_PAGE } from "../testing/content-policy.js";
import { CODER } from "./coder-host/bounds.js";
import { CODER_TOOL_SET } from "./coder-host/tool-set.js";
import { EVE_SEND_OUTCOME } from "./eve-host/eve-sessions.js";

it.layer(getTestDB())("the developer's inbox", (it) => {
  /** The owner's task with one agent started on it, its session claimed so a message reaches it, and the inbox as each side sees it. */
  const openInbox = (eve = fakeEve(), titleModel?: InboxTitleModelOf) =>
    Effect.gen(function* () {
      const opened = yield* openTask({
        eve,
        ...(titleModel === undefined ? undefined : { titleModel }),
      });
      const { agent, target } = yield* startedAgent(opened.owner, opened.task.id, opened.ask);
      const sessionId = eve.opened[0]?.sessionId ?? "";
      assert.equal(yield* claimRuntimeSession(target, sessionId, yield* DateTime.nowAsDate), true);
      const owned = { userId: opened.owner, taskId: opened.task.id, agentId: agent.id };
      /** A thread posted for the agent, as its tool posts one, with the pictures its words name read. */
      const post = (value: ThreadPost, pictures?: Parameters<typeof postInboxThread>[2]) =>
        postInboxThread(owned, value, pictures);
      /** The task's inbox as the owner reads it past the cursor. */
      const read = (after?: string) =>
        Effect.map(
          opened.ask(
            request(TASK_INBOX, opened.owner, {
              id: opened.task.id,
              ...(after === undefined ? undefined : { after }),
            }),
          ),
          (answered) => readAnswer(inboxAnswerSchema, HOSTED_HTTP_STATUS.OK, answered),
        );
      /** The owner's nod on a notice, Got it, as the route answers it. */
      const answer = (itemId: string, body: WireBoundaryInput, bearer = opened.owner) =>
        opened.ask(request(INBOX_ITEM, bearer, { method: "POST", id: itemId, body }));
      /** A member's close of an item without an answer, as the route answers it. */
      const close = (itemId: string, body: WireBoundaryInput, bearer = opened.owner) =>
        opened.ask(request(INBOX_CLOSE, bearer, { method: "POST", id: itemId, body }));
      /** What waits across the account, as the bearer reads it past the cursor. */
      const waiting = (after?: string, bearer = opened.owner) =>
        Effect.map(
          opened.ask(request(ACCOUNT_INBOX, bearer, after === undefined ? undefined : { after })),
          (answered) => readAnswer(accountInboxAnswerSchema, HOSTED_HTTP_STATUS.OK, answered),
        );
      /** A member's message on an item's thread, as the route answers it. */
      const message = (itemId: string, body: WireBoundaryInput, bearer = opened.owner) =>
        opened.ask(request(INBOX_MESSAGES, bearer, { method: "POST", id: itemId, body }));
      /** The agent's transcript as the owner reads it: the developer's lines, and where it stands. */
      const transcript = () =>
        Effect.map(
          opened.ask(request(AGENT_MESSAGES, opened.owner, { id: agent.id })),
          (answered) => {
            const page = readAnswer(agentMessagesAnswerSchema, HOSTED_HTTP_STATUS.OK, answered);
            return { lines: userTexts(page), status: page.status };
          },
        );
      return {
        ...opened,
        agent,
        target,
        sessionId,
        post,
        read,
        answer,
        close,
        waiting,
        message,
        transcript,
      };
    });

  const QUESTION = {
    key: "invite-copy",
    title: "What should the invitation email say?",
    body: "The invitation goes out when a teammate is added.",
    ask: { type: INBOX_ASK.ANSWER },
  } as const;

  /** A to-do the agent does not wait to hear done: a `do` of no steps, as a version 4 to-do reads. */
  const TODO = (key: string) =>
    ({
      key,
      title: "Turn on the agent-mail flag in staging",
      body: "It sits under Settings, Flags.",
      ask: { type: INBOX_ASK.DO, steps: [] },
      needsReply: false,
    }) as const;

  it.effect(
    "over a browser's session cookie an answer to an item and a message on its thread reach its agent as the deployment acting for the cookie's account, each line kept as the thread's",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { owner, ask, post, sessionId, target } = yield* openInbox(eve);
        const posted = yield* post(QUESTION);
        assert.ok(Result.isSuccess(posted));
        const cookie = sessionCookieOf(owner);
        const keys = { answer: randomUUID(), message: randomUUID() };

        const answered = yield* ask(
          request(INBOX_MESSAGES, undefined, {
            method: "POST",
            id: posted.success.id,
            cookie,
            body: {
              text: "Keep it short.",
              clientKey: keys.answer,
              answers: { ask: openAskOf(posted.success), reply: INBOX_REPLY.ANSWERED },
            },
          }),
        );
        const messaged = yield* ask(
          request(INBOX_MESSAGES, undefined, {
            method: "POST",
            id: posted.success.id,
            cookie,
            body: { text: "Say when it expires, too.", clientKey: keys.message },
          }),
        );

        assert.equal(answered.status, HOSTED_HTTP_STATUS.OK, JSON.stringify(answered.body));
        assert.equal(messaged.status, HOSTED_HTTP_STATUS.OK, JSON.stringify(messaged.body));
        assert.deepEqual(
          eve.sent.map((each) => [each.authorization, each.sessionId]),
          [
            [deploymentFor(owner), sessionId],
            [deploymentFor(owner), sessionId],
          ],
        );
        const metadataOf = (clientKey: string) =>
          Effect.map(
            readMessageByClientId(owner, target.conversationId, {}, sentLineId(clientKey)),
            (read) => {
              const line = read.ok ? read.value[0]?.message : undefined;
              return line !== undefined && "metadata" in line ? line.metadata : undefined;
            },
          );
        assert.deepEqual(
          [yield* metadataOf(keys.answer), yield* metadataOf(keys.message)],
          [
            { channel: "thread", event: "answer", item_id: posted.success.id },
            {
              channel: "thread",
              event: "message",
              item_id: posted.success.id,
            },
          ],
        );
      }),
  );

  it.effect(
    "the account's inbox answers every open item across its plans with the agent that posted it, a settled plan's among them, and leaves out settled items and another account's",
    () =>
      Effect.gen(function* () {
        const { owner, other, agent, ask, post, waiting } = yield* openInbox();
        const second = yield* startTask(owner, {
          name: "Billing export",
          repository: RELAY_FULL_NAME,
        });
        yield* savePlanText(owner, second.id, SAVED);
        const secondAgent = (yield* startedAgent(owner, second.id, ask)).agent;
        const onSecond = (value: ThreadPost) =>
          postInboxThread({ userId: owner, taskId: second.id, agentId: secondAgent.id }, value);
        yield* post(QUESTION);
        const settled = yield* post({ ...QUESTION, key: "settled", title: "Settled already" });
        assert.ok(Result.isSuccess(settled));
        assert.ok(
          Option.isSome(
            yield* answerInboxAsk(owner, settled.success.id, {
              answers: { ask: openAskOf(settled.success), reply: INBOX_REPLY.ANSWERED },
              text: "Done.",
              clientKey: randomUUID(),
            }),
          ),
        );
        yield* onSecond({ ...QUESTION, key: "export-format", title: "CSV or JSON?" });

        const all = yield* waiting();
        assert.deepEqual(
          all.items.map((item) => [item.title, item.planId, item.agentId, item.agentModel]).sort(),
          [
            [QUESTION.title, agent.planId, agent.id, agent.model],
            ["CSV or JSON?", second.id, secondAgent.id, secondAgent.model],
          ].sort(),
        );
        // Each item names its agent as the agent goes by, its title.
        assert.deepEqual(
          all.items.map((item) => [item.title, item.agentTitle]).sort(),
          [
            [QUESTION.title, agent.title],
            ["CSV or JSON?", secondAgent.title],
          ].sort(),
        );

        // Done, the plan settles its open item; one its agent asks on it after waits like any other.
        yield* updateTask(owner, second.id, { status: TASK_STATUS.DONE });
        assert.deepEqual(
          (yield* waiting()).items.map((item) => item.title),
          [QUESTION.title],
        );
        yield* onSecond({ ...QUESTION, key: "export-format", title: "CSV or JSON?" });
        assert.deepEqual(
          (yield* waiting()).items.map((item) => item.title).sort(),
          [QUESTION.title, "CSV or JSON?"].sort(),
        );
        assert.deepEqual((yield* waiting(undefined, other)).items, []);
        assert.deepEqual(
          yield* ask(request(ACCOUNT_INBOX, undefined)),
          refusal(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN),
        );
      }),
  );

  it.effect(
    "an older build's archive of a plan settles it and puts nothing away: an item asked on it after still waits and takes an answer, and its archived=include on the account's inbox is taken and changes nothing",
    () =>
      Effect.gen(function* () {
        const { owner, task, ask, post, message, waiting } = yield* openInbox();
        const archivedToo = () =>
          Effect.map(
            ask(request(ACCOUNT_INBOX, owner, { archived: ACCOUNT_INBOX_ARCHIVED.INCLUDE })),
            (answered) => readAnswer(accountInboxAnswerSchema, HOSTED_HTTP_STATUS.OK, answered),
          );

        yield* updateTask(owner, task.id, { status: TASK_STATUS.DONE });
        const posted = yield* post(QUESTION);
        assert.ok(Result.isSuccess(posted));
        const standing = yield* waiting();
        assert.deepEqual(
          standing.items.map((item) => [item.id, item.revision]),
          [[posted.success.id, posted.success.revision]],
        );
        assert.deepEqual(
          standing.plans.map((plan) => [plan.planId, plan.items]),
          [[task.id, 1]],
        );
        const included = yield* archivedToo();
        assert.deepEqual(
          { ...included, cursor: standing.cursor, readAt: standing.readAt },
          standing,
        );
        assert.equal(
          (yield* message(posted.success.id, {
            text: "Keep it short.",
            clientKey: randomUUID(),
            answers: { ask: openAskOf(posted.success), reply: INBOX_REPLY.ANSWERED },
          })).status,
          HOSTED_HTTP_STATUS.OK,
        );
        assert.deepEqual((yield* waiting()).items, []);
      }),
  );

  it.effect(
    "a notice waits on the account until Got it settles it, which messages nobody, and a reply with words settles another as it reaches the agent",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { owner, task, agent, answer, message, waiting } = yield* openInbox(eve);
        const owned = { userId: owner, taskId: task.id, agentId: agent.id };
        const notice = (key: string) =>
          postInboxThread(owned, {
            key,
            title: "The preview is up",
            body: "It deploys from main.",
          });
        const nodded = yield* notice("preview-nod");
        const replied = yield* notice("preview-reply");
        assert.ok(Result.isSuccess(nodded) && Result.isSuccess(replied));
        const waitingIds = Effect.map(waiting(), (read) =>
          read.items.map((item) => item.id).sort(),
        );
        assert.deepEqual(yield* waitingIds, [nodded.success.id, replied.success.id].sort());
        const before = eve.sent.length;

        const pressed = readAnswer(
          inboxAnsweredSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* answer(nodded.success.id, {
            revision: nodded.success.revision,
            clientKey: randomUUID(),
            reply: INBOX_REPLY.ACKNOWLEDGED,
          }),
        );
        assert.deepEqual([pressed.taken, pressed.item.status], [true, INBOX_STATUS.ANSWERED]);
        assert.equal(eve.sent.length, before, "Got it messages nobody");

        const sent = readAnswer(
          inboxMessagedSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* message(replied.success.id, {
            text: "Nice work.",
            clientKey: randomUUID(),
            revision: replied.success.revision,
          }),
        );
        assert.equal(sent.item.status, INBOX_STATUS.ANSWERED);
        assert.equal(eve.sent.length, before + 1, "a reply with words reaches the agent");
        assert.ok(JSON.stringify(eve.sent.at(-1)?.message.message).includes("Nice work."));
        assert.deepEqual(yield* waitingIds, []);
      }),
  );

  it.effect(
    "Got it settles a notice at the revision it names, taken once under its key and counted once, a stale revision answering the notice as it stands, an item holding an ask open refused, and an agent that waits on the notice told",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { owner, post, answer, read } = yield* openInbox(eve);
        const notice = (key: string) =>
          Effect.map(
            post({ key, title: "The preview is up", body: "It deploys from main." }),
            Result.getOrThrow,
          );
        const nod = (item: InboxItem, revision = item.revision, clientKey = randomUUID()) =>
          answer(item.id, { revision, clientKey, reply: INBOX_REPLY.ACKNOWLEDGED });
        const quiet = yield* notice("preview-quiet");
        const before = eve.sent.length;

        const stale = readAnswer(
          inboxAnsweredSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* nod(quiet, quiet.revision + 1),
        );
        assert.deepEqual([stale.taken, stale.item.status], [false, INBOX_STATUS.OPEN]);

        const clientKey = randomUUID();
        const taken = readAnswer(
          inboxAnsweredSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* nod(quiet, quiet.revision, clientKey),
        );
        assert.deepEqual(
          [taken.taken, taken.item.status, taken.item.answeredBy?.userId],
          [true, INBOX_STATUS.ANSWERED, owner],
        );
        const again = readAnswer(
          inboxAnsweredSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* nod(quiet, quiet.revision, clientKey),
        );
        assert.deepEqual([again.taken, again.item.status], [true, INBOX_STATUS.ANSWERED]);
        assert.equal(countedFor(owner, SERVER_EVENT.INBOX_ANSWER_SEND), 1, "counted once");
        assert.equal(eve.sent.length, before, "an agent not waiting on the notice is told nothing");

        const asked = yield* post(QUESTION);
        assert.ok(Result.isSuccess(asked));
        assert.deepEqual(
          yield* nod(asked.success),
          refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
          "only an answer to the ask settles an item holding one open",
        );
        const standing = (yield* read()).items.find((each) => each.id === asked.success.id);
        assert.equal(standing?.status, INBOX_STATUS.OPEN);

        // A notice posted before threads may wait to hear the nod, which no post from version 5 writes.
        const waited = yield* notice("preview-waited");
        yield* Database.use((db) =>
          db.update(inboxItem).set({ needsReply: true }).where(eq(inboxItem.id, waited.id)),
        );
        const heardKey = randomUUID();
        const heard = readAnswer(
          inboxAnsweredSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* nod(waited, waited.revision, heardKey),
        );
        assert.deepEqual([heard.taken, heard.item.status], [true, INBOX_STATUS.ANSWERED]);
        assert.equal(eve.sent.length, before + 1, "the waiting agent hears the nod");
        const handed = JSON.stringify(eve.sent.at(-1)?.message.message);
        assert.ok(handed.includes(`${INBOX_ANSWER_LEAD} on`), "it reads as an Inbox answer");
        assert.ok(handed.includes("(key preview-waited)"), "it names the notice's key");
        yield* nod(waited, waited.revision, heardKey);
        assert.equal(eve.sent.length, before + 1, "a nod sent again reaches the agent once");
      }),
  );

  it.effect(
    "an answer carrying a file and no words reaches the agent with the file, even to an ask the agent does not wait to hear back, and the answering message names the file",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { post, message, read } = yield* openInbox(eve);
        const todo = yield* post(TODO("flag-file"));
        assert.ok(Result.isSuccess(todo));
        const before = eve.sent.length;
        const trace = {
          name: "flag-trace.txt",
          mediaType: AGENT_ATTACHMENT_TYPE.TEXT,
          data: Buffer.from("flag on in staging\n").toString("base64"),
        };

        const sent = yield* message(todo.success.id, {
          text: "",
          attachments: [trace],
          clientKey: randomUUID(),
          answers: { ask: openAskOf(todo.success), reply: INBOX_REPLY.DONE, steps: [] },
        });
        assert.equal(sent.status, HOSTED_HTTP_STATUS.OK, JSON.stringify(sent.body));
        const handed = JSON.stringify(eve.sent.slice(before).map((each) => each.message.message));
        assert.ok(handed.includes(INBOX_ANSWER_LEAD), "it reads as an Inbox answer");
        assert.ok(handed.includes("flag on in staging"), "it carries the file");
        const kept = (yield* read()).items.find((item) => item.key === "flag-file");
        assert.deepEqual(
          kept?.thread
            ?.filter((each) => each.answers !== undefined)
            .map((each) => each.files?.map((file) => [file.name, file.mediaType])),
          [[[trace.name, trace.mediaType]]],
        );
      }),
  );

  it.effect("an answer in the developer's own words may be a file alone", () =>
    Effect.gen(function* () {
      const { owner, post, message } = yield* openInbox();
      const asked = yield* post(QUESTION);
      assert.ok(Result.isSuccess(asked));
      const shot = {
        name: "invite.png",
        mediaType: AGENT_ATTACHMENT_TYPE.PNG,
        data: Buffer.from(PNG).toString("base64"),
      };
      const answered = (attachments?: readonly (typeof shot)[]) =>
        message(asked.success.id, {
          text: "",
          clientKey: randomUUID(),
          answers: { ask: openAskOf(asked.success), reply: INBOX_REPLY.ANSWERED },
          ...(attachments === undefined ? undefined : { attachments }),
        });

      assert.deepEqual(
        yield* answered(),
        refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
      );
      const taken = readAnswer(inboxMessagedSchema, HOSTED_HTTP_STATUS.OK, yield* answered([shot]));
      assert.equal(taken.item.status, INBOX_STATUS.ANSWERED);
      assert.deepEqual(
        taken.item.thread
          ?.filter((each) => each.answers !== undefined)
          .map((each) => each.files?.map((file) => file.name)),
        [[shot.name]],
      );
      assert.deepEqual(countedProperties(owner, SERVER_EVENT.THREAD_POST), [
        { answered_ask: true, has_media: true },
      ]);
    }),
  );

  /** The agent's one turn run to its end, as the relay writes a turn that settled: the agent stopped, and waits on nothing. */
  const turnEnded = (target: { readonly userId: string; readonly conversationId: string }) =>
    Effect.gen(function* () {
      const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
      const turnId = randomUUID();
      const turn = { conversationId: sessionKey(target.conversationId), turnId };
      yield* writer.enqueueTurn(target, { turnId, origin: TURN_ORIGIN.TYPED, eveTurnId: "turn_0" });
      yield* writer.consume(target, {
        ...turn,
        kind: RUN_EVENT.TURN_STARTED,
        sequence: 1,
        origin: RUN_TURN_ORIGIN.TYPED,
        trigger: TURN_TRIGGER.ASK,
        at: 0,
      });
      yield* writer.consume(target, {
        ...turn,
        kind: RUN_EVENT.MESSAGE_COMPLETED,
        sequence: 2,
        message: userMessage(randomUUID(), SNAPSHOT, userMetadataOf(TURN_TRIGGER.ASK)),
      });
      yield* writer.consume(target, {
        ...turn,
        kind: RUN_EVENT.TURN_ENDED,
        sequence: 3,
        status: RUN_STATUS.SUCCEEDED,
        responseIds: [],
        at: 0,
      });
    });

  it.effect(
    "a member's message on an answered item wakes the agent that stopped, reaching it under its own lead with its files, and leaves the item answered at its revision, its thread naming the member; a teammate writes as the starter does, a repeat under its key reaches the agent once, and an outsider, no bearer, and an empty message are refused",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { owner, other, task, target, ask, post, read, message, transcript } =
          yield* openInbox(eve);
        const asked = yield* post(TODO("flag-thread"));
        assert.ok(Result.isSuccess(asked));
        const { id, key, title } = asked.success;
        // A bare Done on an ask the agent does not wait to hear reaches nobody, so the turn below is the agent's last.
        const answered = readAnswer(
          inboxMessagedSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* message(id, {
            text: "",
            clientKey: randomUUID(),
            answers: { ask: openAskOf(asked.success), reply: INBOX_REPLY.DONE, steps: [] },
          }),
        ).item;
        /** The members' own messages on a thread, those that answer no ask. */
        const replies = (item: InboxItem | undefined) =>
          (item?.thread ?? []).filter(
            (each) => each.author === INBOX_MESSAGE_AUTHOR.MEMBER && each.answers === undefined,
          );
        yield* turnEnded(target);
        assert.equal((yield* transcript()).status, AGENT_STATUS.COMPLETED);
        const before = eve.sent.length;
        const trace = {
          name: "copy-review.txt",
          mediaType: AGENT_ATTACHMENT_TYPE.TEXT,
          data: Buffer.from("subject line too long\n").toString("base64"),
        };
        const body = {
          text: "One more: drop the emoji.",
          attachments: [trace],
          clientKey: randomUUID(),
        };

        const sent = readAnswer(
          inboxMessagedSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* message(id, body),
        );
        assert.deepEqual(
          [sent.item.status, sent.item.revision, sent.item.answeredBy],
          [INBOX_STATUS.ANSWERED, answered.revision, answered.answeredBy],
        );
        assert.deepEqual(
          replies(sent.item).map((each) => [
            each.member?.userId,
            each.text,
            each.files?.map((file) => file.name),
          ]),
          [[owner, body.text, [trace.name]]],
        );
        const handed = JSON.stringify(eve.sent.slice(before).map((each) => each.message.message));
        assert.ok(handed.includes(`${INBOX_MESSAGE_LEAD} on \\"${title}\\" (key ${key})`));
        assert.ok(handed.includes(body.text), "it carries the words");
        assert.ok(handed.includes("subject line too long"), "it carries the file");
        const woken = yield* transcript();
        assert.equal(woken.status, AGENT_STATUS.RUNNING, "the message woke the agent");
        assert.ok(woken.lines.some((line) => line?.includes(body.text)));

        yield* message(id, body);
        assert.equal(eve.sent.length, before + 1, "a repeat under the key reaches the agent once");
        assert.deepEqual(
          countedProperties(owner, SERVER_EVENT.THREAD_POST),
          [
            { answered_ask: true, has_media: false },
            { answered_ask: false, has_media: true },
          ],
          "the answer and the reply are each a post, and the repeat is not another",
        );
        assert.deepEqual(
          yield* message(id, { ...body, text: "Something else." }),
          refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
          "other words under a key already taken are refused, so the agent never hears what the thread does not show",
        );
        assert.equal(eve.sent.length, before + 1);

        assert.deepEqual(
          yield* message(id, { text: "Before I joined.", clientKey: randomUUID() }, other),
          refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );
        yield* joinWorkspace(task.workspaceId, other);
        yield* TestClock.adjust(Duration.seconds(1));
        readAnswer(
          inboxMessagedSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* message(id, { text: "Agreed.", clientKey: randomUUID() }, other),
        );
        const kept = (yield* read()).items.find((item) => item.id === id);
        assert.deepEqual(
          replies(kept).map((each) => [each.member?.userId, each.text]),
          [
            [owner, body.text],
            [other, "Agreed."],
          ],
        );
        assert.equal(kept?.status, INBOX_STATUS.ANSWERED);

        assert.deepEqual(
          yield* ask(
            request(INBOX_MESSAGES, undefined, {
              method: "POST",
              id,
              body: { text: "Hello.", clientKey: randomUUID() },
            }),
          ),
          refusal(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN),
        );
        assert.deepEqual(
          yield* message(id, { text: "  ", clientKey: randomUUID() }),
          refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
        );
      }),
  );

  it.effect(
    "an Inbox answer is counted once it stands: not where its hand-off failed and was withdrawn, and once however often it is sent again under its key",
    () =>
      Effect.gen(function* () {
        const refused = yield* openInbox(fakeEve({ sends: EVE_SEND_OUTCOME.FAILED }));
        const lost = yield* refused.post(QUESTION);
        assert.ok(Result.isSuccess(lost));
        const withdrawn = yield* refused.message(lost.success.id, {
          text: "Say hello.",
          clientKey: randomUUID(),
          answers: { ask: openAskOf(lost.success), reply: INBOX_REPLY.ANSWERED },
        });
        assert.equal(withdrawn.status, HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE);
        assert.equal(countedFor(refused.owner, SERVER_EVENT.INBOX_ANSWER_SEND), 0);
        assert.equal(countedFor(refused.owner, SERVER_EVENT.THREAD_POST), 0);

        const { owner, post, message } = yield* openInbox();
        const asked = yield* post(QUESTION);
        assert.ok(Result.isSuccess(asked));
        const body = {
          text: "Say hello.",
          clientKey: randomUUID(),
          answers: { ask: openAskOf(asked.success), reply: INBOX_REPLY.ANSWERED },
        };
        assert.equal((yield* message(asked.success.id, body)).status, HOSTED_HTTP_STATUS.OK);
        assert.equal((yield* message(asked.success.id, body)).status, HOSTED_HTTP_STATUS.OK);
        assert.equal(countedFor(owner, SERVER_EVENT.INBOX_ANSWER_SEND), 1);
        assert.deepEqual(countedProperties(owner, SERVER_EVENT.THREAD_POST), [
          { answered_ask: true, has_media: false },
        ]);
      }),
  );

  it.effect(
    "a member closes an item without an answer: an agent waiting to hear back is told under the close's own lead, once however often it is sent under its key, one that asks nothing back is not, and a close of an item the agent changed since is not taken",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { owner, post, close, waiting } = yield* openInbox(eve);
        const asked = yield* post(QUESTION);
        const quiet = yield* post(TODO("flag"));
        assert.ok(Result.isSuccess(asked) && Result.isSuccess(quiet));
        const before = eve.sent.length;

        const stale = yield* close(asked.success.id, {
          revision: asked.success.revision + 1,
          clientKey: randomUUID(),
        });
        const notTaken = readAnswer(inboxAnsweredSchema, HOSTED_HTTP_STATUS.OK, stale);
        assert.equal(notTaken.taken, false);
        assert.equal(notTaken.item.status, INBOX_STATUS.OPEN);

        const body = { revision: asked.success.revision, clientKey: randomUUID() };
        const closed = readAnswer(
          inboxAnsweredSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* close(asked.success.id, body),
        );
        assert.equal(closed.taken, true);
        assert.equal(closed.item.status, INBOX_STATUS.CLOSED);
        assert.equal(closed.item.closedBy?.userId, owner);
        assert.equal(eve.sent.length, before + 1, "the waiting agent is told");
        const handed = JSON.stringify(eve.sent.at(-1)?.message.message);
        assert.ok(handed.includes(`${INBOX_CLOSE_LEAD} on`), "it reads as an Inbox close");
        assert.ok(handed.includes(`(key ${QUESTION.key})`), "it names the item's key");
        const again = readAnswer(
          inboxAnsweredSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* close(asked.success.id, body),
        );
        assert.equal(again.taken, true, "a close sent again under its key is the one taken");
        assert.equal(eve.sent.length, before + 1, "and reaches the agent once");

        const pressed = readAnswer(
          inboxAnsweredSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* close(quiet.success.id, {
            revision: quiet.success.revision,
            clientKey: randomUUID(),
          }),
        );
        assert.equal(pressed.taken, true);
        assert.equal(eve.sent.length, before + 1, "an item that asks nothing back messages nobody");

        const withdrawn = yield* closeInboxItem(
          { userId: owner, agentId: asked.success.agentId },
          QUESTION.key,
          "Found it myself.",
        );
        assert.ok(Option.isNone(withdrawn), "the agent withdraws no ask the member's close did");
        assert.ok(Result.isSuccess(yield* post(QUESTION)), "the agent asks again");
        yield* closeInboxItem(
          { userId: owner, agentId: asked.success.agentId },
          QUESTION.key,
          "Found it myself.",
        );
        const afterAgent = readAnswer(
          inboxAnsweredSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* close(asked.success.id, body),
        );
        assert.equal(
          afterAgent.taken,
          false,
          "a retry never takes the agent's later close for its own",
        );
        assert.equal(eve.sent.length, before + 1, "and tells the agent nothing");
        assert.deepEqual((yield* waiting()).items, [], "nothing waits on the developer");
      }),
  );

  it.effect(
    "a close the agent's session did not take opens the item again, so it never reads closed while the waiting agent was not told",
    () =>
      Effect.gen(function* () {
        const { post, read, close } = yield* openInbox(fakeEve({ sends: EVE_SEND_OUTCOME.FAILED }));
        const asked = yield* post(QUESTION);
        assert.ok(Result.isSuccess(asked));

        const sent = yield* close(asked.success.id, {
          revision: asked.success.revision,
          clientKey: randomUUID(),
        });

        assert.equal(sent.status, HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE);
        const kept = (yield* read()).items.find((item) => item.id === asked.success.id);
        assert.equal(kept?.status, INBOX_STATUS.OPEN);
        assert.equal(kept?.closedBy, undefined);
      }),
  );

  it.effect(
    "a message the agent's session did not take is taken back off the thread, so the thread never shows what the agent was not told",
    () =>
      Effect.gen(function* () {
        const { post, read, message } = yield* openInbox(
          fakeEve({ sends: EVE_SEND_OUTCOME.FAILED }),
        );
        const asked = yield* post(QUESTION);
        assert.ok(Result.isSuccess(asked));

        const sent = yield* message(asked.success.id, {
          text: "Still there?",
          clientKey: randomUUID(),
        });

        assert.equal(sent.status, HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE);
        const kept = (yield* read()).items.find((item) => item.id === asked.success.id);
        assert.deepEqual(
          kept?.thread?.map((each) => [each.author, each.text]),
          [[INBOX_MESSAGE_AUTHOR.AGENT, QUESTION.body]],
        );
      }),
  );

  it.effect(
    "a member starts a thread with an agent that stopped: it stands under a key minted from its subject past the agent's own, their words first, and wakes the agent under the message lead naming that key; the agent's post under the key answers on it, a repeat under the client's key, even after the agent retitled the thread, reaches the agent once and other words under it are refused, one with no subject is titled by its first line, and an outsider, an agent of no workspace of theirs, a blank subject, and no words are refused",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { owner, other, task, agent, target, ask, post, read, transcript } =
          yield* openInbox(eve);
        const theirs = yield* post({ ...QUESTION, key: "annual-plan-copy" });
        assert.ok(Result.isSuccess(theirs));
        yield* turnEnded(target);
        const before = eve.sent.length;
        const start = (body: WireBoundaryInput, bearer = owner) =>
          ask(request(ACCOUNT_INBOX, bearer, { method: "POST", body }));
        const body = {
          agentId: agent.id,
          title: "Annual plan copy",
          text: "Draft the annual plan's line too.",
          clientKey: randomUUID(),
        };

        const started = readAnswer(inboxMessagedSchema, HOSTED_HTTP_STATUS.OK, yield* start(body));
        assert.deepEqual(
          [started.item.key, started.item.title, started.item.status],
          ["annual-plan-copy-2", body.title, INBOX_STATUS.ANSWERED],
        );
        assert.deepEqual(
          started.item.thread?.map((each) => [each.author, each.member?.userId, each.text]),
          [[INBOX_MESSAGE_AUTHOR.MEMBER, owner, body.text]],
        );
        const handed = JSON.stringify(eve.sent.slice(before).map((each) => each.message.message));
        assert.ok(
          handed.includes(`${INBOX_MESSAGE_LEAD} on \\"${body.title}\\" (key annual-plan-copy-2)`),
        );
        assert.ok(handed.includes(body.text), "it carries the words");
        assert.equal((yield* transcript()).status, AGENT_STATUS.RUNNING);

        const again = readAnswer(inboxMessagedSchema, HOSTED_HTTP_STATUS.OK, yield* start(body));
        assert.equal(again.item.id, started.item.id);
        assert.equal(eve.sent.length, before + 1, "a repeat under the key reaches the agent once");
        assert.deepEqual(countedProperties(owner, SERVER_EVENT.THREAD_POST), [
          { answered_ask: false, has_media: false },
        ]);
        assert.deepEqual(
          yield* start({ ...body, text: "Something else." }),
          refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
          "other words under a key taken are refused, so the agent never hears what the thread does not show",
        );
        assert.equal(eve.sent.length, before + 1);
        assert.deepEqual(
          (yield* read()).items
            .filter((item) => item.key.startsWith("annual-plan-copy"))
            .map((item) => [item.key, item.title])
            .sort(),
          [
            ["annual-plan-copy", QUESTION.title],
            ["annual-plan-copy-2", body.title],
          ],
          "the agent's own thread under the subject's key stands as it was",
        );

        yield* TestClock.adjust(Duration.seconds(1));
        const reply = "Two months free, billed yearly.";
        const replied = yield* postInboxThread(
          { userId: owner, taskId: task.id, agentId: agent.id },
          { key: "annual-plan-copy-2", body: reply },
        );
        assert.ok(Result.isSuccess(replied));
        assert.deepEqual(
          replied.success.thread?.map((each) => [each.author, each.text]),
          [
            [INBOX_MESSAGE_AUTHOR.MEMBER, body.text],
            [INBOX_MESSAGE_AUTHOR.AGENT, reply],
          ],
        );
        const retitled = yield* postInboxThread(
          { userId: owner, taskId: task.id, agentId: agent.id },
          { key: "annual-plan-copy-2", title: "Final plan copy", body: "Retitled." },
        );
        assert.ok(Result.isSuccess(retitled));
        const late = readAnswer(inboxMessagedSchema, HOSTED_HTTP_STATUS.OK, yield* start(body));
        assert.deepEqual(
          [late.item.id, late.item.title, eve.sent.length],
          [started.item.id, "Final plan copy", before + 1],
          "a start retried once its agent retitled the thread is the thread it started, heard once",
        );

        assert.deepEqual(
          yield* start({ ...body, clientKey: randomUUID() }, other),
          refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );
        assert.deepEqual(
          yield* start({ ...body, agentId: randomUUID(), clientKey: randomUUID() }),
          refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );
        assert.deepEqual(
          yield* start({ ...body, title: "  ", clientKey: randomUUID() }),
          refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
        );
        const untitled = readAnswer(
          inboxMessagedSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* start({
            agentId: agent.id,
            text: "Ship the monthly toggle too.\n\nIt can wait for the table.",
            clientKey: randomUUID(),
          }),
        );
        assert.deepEqual(
          [untitled.item.title, untitled.item.key],
          ["Ship the monthly toggle too.", "ship-the-monthly-toggle-too"],
          "a thread started with no subject is titled by its message's first line",
        );
        assert.deepEqual(
          yield* start({ ...body, text: "  ", clientKey: randomUUID() }),
          refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
        );
      }),
  );

  it.effect(
    "a thread started with no subject is titled by the agent-title model over its message on the sender's own key, after the answer, its key, its place, and its read state kept; one with a subject, and one whose sender has no key, keep the title they were started under",
    () =>
      Effect.gen(function* () {
        const asked: string[] = [];
        const model = new MockLanguageModelV4({
          doGenerate: async (options) => {
            asked.push(JSON.stringify(options.prompt));
            return {
              content: [{ type: "text", text: "Annual plan pricing copy." }],
              finishReason: { unified: "stop", raw: "stop" },
              usage: {
                inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
                outputTokens: { total: 1, text: 1, reasoning: 0 },
              },
              warnings: [],
            };
          },
        });
        const keyed = new Set<string>();
        const titleModel: InboxTitleModelOf = (userId) =>
          Effect.succeed(keyed.has(userId) ? model : undefined);
        const eve = fakeEve();
        const { owner, agent, target, ask, read } = yield* openInbox(eve, titleModel);
        keyed.add(owner);
        yield* turnEnded(target);
        const start = (body: WireBoundaryInput) =>
          Effect.map(ask(request(ACCOUNT_INBOX, owner, { method: "POST", body })), (answered) =>
            readAnswer(inboxMessagedSchema, HOSTED_HTTP_STATUS.OK, answered),
          );
        const text = "Can you draft the annual plan's line for the pricing table too?";

        const untitled = yield* start({ agentId: agent.id, text, clientKey: randomUUID() });
        const subject = "Pricing table";
        const titled = yield* start({
          agentId: agent.id,
          title: subject,
          text,
          clientKey: randomUUID(),
        });
        keyed.delete(owner);
        const keyless = yield* start({
          agentId: agent.id,
          text: "Ship it tonight.",
          clientKey: randomUUID(),
        });

        const items = new Map((yield* read()).items.map((item) => [item.id, item]));
        const titledNow = items.get(untitled.item.id);
        assert.deepEqual(
          [titledNow?.title, titledNow?.key, titledNow?.updatedAt, titledNow?.unread],
          ["Annual plan pricing copy", untitled.item.key, untitled.item.updatedAt, false],
          "the model's title stands, under the key and at the place it was started at, read for its sender",
        );
        assert.equal(items.get(titled.item.id)?.title, subject);
        assert.equal(items.get(keyless.item.id)?.title, "Ship it tonight.");
        assert.equal(asked.length, 1, "only the untitled thread with a key asks the model");
        assert.ok(asked[0]?.includes("annual plan"), "the model is asked over the message");
      }),
  );

  it.effect(
    "a thread the agent's session did not take is taken back whole, so the Inbox never shows a thread the agent was not told",
    () =>
      Effect.gen(function* () {
        const { owner, agent, ask, read } = yield* openInbox(
          fakeEve({ sends: EVE_SEND_OUTCOME.FAILED }),
        );

        const sent = yield* ask(
          request(ACCOUNT_INBOX, owner, {
            method: "POST",
            body: {
              agentId: agent.id,
              title: "Still there?",
              text: "Ping.",
              clientKey: randomUUID(),
            },
          }),
        );

        assert.equal(sent.status, HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE);
        assert.deepEqual(
          (yield* read()).items.filter((item) => item.title === "Still there?"),
          [],
        );
      }),
  );

  /** A thread that ends with an ask to decide, as the tool from version 5 posts one, waiting to hear the answer back. */
  const DEPLOY = {
    key: "deploy-window",
    title: "Ship the billing fix tonight?",
    body: "The fix is green on staging.",
    ask: { type: INBOX_ASK.DECIDE, options: [{ label: "Ship it" }, { label: "Wait" }] },
  } as const;

  /** The thread posted for the inbox's agent under the key given, and the message whose ask stands open on it. */
  const postAsk = (
    inbox: {
      readonly owner: string;
      readonly task: { readonly id: string };
      readonly agent: { readonly id: string };
    },
    key = DEPLOY.key,
  ) =>
    Effect.gen(function* () {
      const posted = yield* postInboxThread(
        { userId: inbox.owner, taskId: inbox.task.id, agentId: inbox.agent.id },
        { ...DEPLOY, key },
      );
      assert.ok(Result.isSuccess(posted));
      const asking = posted.success.thread?.find(
        (each) => each.ask?.status === INBOX_ASK_STATUS.OPEN,
      );
      assert.ok(asking);
      // A message on the thread comes a moment after the post, so the thread reads in the order written.
      yield* TestClock.adjust(Duration.seconds(1));
      return { item: posted.success, askId: asking.id };
    });

  /** The thread's messages as the reader sees them: who wrote each, its words, where its ask stands, and the answer it carries. */
  const threadOf = (item: InboxItem | undefined) =>
    (item?.thread ?? []).map((each) => [each.author, each.text, each.ask?.status, each.answers]);

  it.effect(
    "a reply that answers the open ask settles it as one message carrying the answer and the words and reaches the agent under the answer's lead; sent again under its key it is taken and heard once, and a second answer is refused",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const inbox = yield* openInbox(eve);
        const { item, askId } = yield* postAsk(inbox);
        const before = eve.sent.length;
        const answers = { ask: askId, reply: INBOX_REPLY.CHOSE, choices: ["Ship it"] };
        const body = {
          text: "Ship it, and watch the error rate.",
          clientKey: randomUUID(),
          answers,
        };

        const sent = readAnswer(
          inboxMessagedSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* inbox.message(item.id, body),
        );

        assert.equal(sent.item.status, INBOX_STATUS.ANSWERED);
        assert.deepEqual(threadOf(sent.item), [
          [INBOX_MESSAGE_AUTHOR.AGENT, DEPLOY.body, INBOX_ASK_STATUS.ANSWERED, undefined],
          [INBOX_MESSAGE_AUTHOR.MEMBER, body.text, undefined, answers],
        ]);
        const handed = eve.sent.slice(before).map((each) => JSON.stringify(each.message.message));
        assert.equal(handed.length, 1, "the answer reaches the agent once");
        assert.ok(handed[0]?.includes(`${INBOX_ANSWER_LEAD} on \\"${DEPLOY.title}\\"`));
        assert.ok(handed[0]?.includes(`Chose \\"Ship it\\".`), "it says what they picked");
        assert.ok(handed[0]?.includes(body.text), "it carries the words");

        const again = readAnswer(
          inboxMessagedSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* inbox.message(item.id, body),
        );
        assert.deepEqual(threadOf(again.item), threadOf(sent.item), "a resend writes nothing");
        assert.equal(eve.sent.length, before + 1, "and reaches the agent once");
        assert.equal(countedFor(inbox.owner, SERVER_EVENT.INBOX_ANSWER_SEND), 1);
        const invalid = refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
        assert.deepEqual(
          yield* inbox.message(item.id, { ...body, text: "Ship it, and tell the team." }),
          invalid,
          "other words under the key it was taken by are refused",
        );
        assert.deepEqual(
          yield* inbox.message(item.id, { ...body, answers: { ...answers, choices: ["Wait"] } }),
          invalid,
          "another answer under that key is refused",
        );
        assert.equal(eve.sent.length, before + 1, "and neither reaches the agent");
        const standing = (yield* inbox.read()).items.find((each) => each.id === item.id);
        assert.deepEqual(threadOf(standing), threadOf(sent.item), "the thread holds what it heard");

        assert.deepEqual(
          yield* inbox.message(item.id, {
            text: "Actually, wait.",
            clientKey: randomUUID(),
            answers: { ...answers, choices: ["Wait"] },
          }),
          invalid,
          "an ask answered already takes no second answer",
        );
        assert.equal(eve.sent.length, before + 1);
      }),
  );

  it.effect(
    "an answer the open ask does not take, or one naming another message, is refused and leaves the ask open; a plain reply while it stands open leaves it open and reaches the agent as an Inbox message",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const inbox = yield* openInbox(eve);
        const { item, askId } = yield* postAsk(inbox);
        const before = eve.sent.length;
        const invalid = refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
        const answering = (answers: WireBoundaryInput) =>
          inbox.message(item.id, { text: "", clientKey: randomUUID(), answers });

        assert.deepEqual(
          yield* answering({ ask: askId, reply: INBOX_REPLY.CHOSE, choices: ["Tomorrow"] }),
          invalid,
          "a pick the ask does not offer",
        );
        assert.deepEqual(
          yield* answering({ ask: askId, reply: INBOX_REPLY.DONE }),
          invalid,
          "an answer a decide does not take",
        );
        assert.deepEqual(
          yield* answering({ ask: randomUUID(), reply: INBOX_REPLY.CHOSE, choices: ["Ship it"] }),
          invalid,
          "an answer to another message",
        );
        assert.deepEqual(
          yield* inbox.message(item.id, { text: "", clientKey: randomUUID() }),
          invalid,
          "a plain reply still needs words or files",
        );

        const words = "What's the rollback plan?";
        const replied = readAnswer(
          inboxMessagedSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* inbox.message(item.id, { text: words, clientKey: randomUUID() }),
        );
        assert.equal(replied.item.status, INBOX_STATUS.OPEN);
        assert.deepEqual(threadOf(replied.item), [
          [INBOX_MESSAGE_AUTHOR.AGENT, DEPLOY.body, INBOX_ASK_STATUS.OPEN, undefined],
          [INBOX_MESSAGE_AUTHOR.MEMBER, words, undefined, undefined],
        ]);
        const handed = eve.sent.slice(before).map((each) => JSON.stringify(each.message.message));
        assert.equal(handed.length, 1, "only the plain reply reached the agent");
        assert.ok(handed[0]?.includes(`${INBOX_MESSAGE_LEAD} on`), "it reads as an Inbox message");
        assert.ok(handed[0]?.includes(words));
      }),
  );

  it.effect(
    "a bare answer by reply to an ask that asks nothing back is kept for the agent to read, and a typed one reaches it",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const inbox = yield* openInbox(eve);
        const owned = { userId: inbox.owner, taskId: inbox.task.id, agentId: inbox.agent.id };
        const todo = (key: string) =>
          Effect.map(
            postInboxThread(owned, {
              key,
              title: "Turn on the agent-mail flag in staging",
              body: "It sits under Settings, Flags.",
              ask: { type: INBOX_ASK.DO, steps: ["Open Flags", "Turn on agent-mail"] },
              needsReply: false,
            }),
            (posted) => {
              assert.ok(Result.isSuccess(posted));
              const asking = posted.success.thread?.find((each) => each.ask !== undefined);
              assert.ok(asking);
              return { id: posted.success.id, ask: asking.id };
            },
          );
        const bare = yield* todo("flag-bare");
        const typed = yield* todo("flag-typed");
        const before = eve.sent.length;
        const done = (ask: string) => ({ ask, reply: INBOX_REPLY.DONE, steps: [0, 1] });

        const kept = readAnswer(
          inboxMessagedSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* inbox.message(bare.id, {
            text: "",
            clientKey: randomUUID(),
            answers: done(bare.ask),
          }),
        );
        assert.equal(kept.item.status, INBOX_STATUS.ANSWERED);
        assert.equal(eve.sent.length, before, "a bare Mark done messages nobody");

        yield* inbox.message(typed.id, {
          text: "Done, and on preview too.",
          clientKey: randomUUID(),
          answers: done(typed.ask),
        });
        assert.equal(eve.sent.length, before + 1, "words reach the agent");
        const handed = JSON.stringify(eve.sent.at(-1)?.message.message);
        assert.ok(handed.includes(`${INBOX_ANSWER_LEAD} on`), "it reads as an Inbox answer");
        assert.ok(handed.includes("Done, and on preview too."));
      }),
  );

  it.effect(
    "an answer by reply the agent's session did not take is taken back: the ask stands open again, the thread holds no answer, and nothing is counted",
    () =>
      Effect.gen(function* () {
        const inbox = yield* openInbox(fakeEve({ sends: EVE_SEND_OUTCOME.FAILED }));
        const { item, askId } = yield* postAsk(inbox);

        const sent = yield* inbox.message(item.id, {
          text: "Ship it.",
          clientKey: randomUUID(),
          answers: { ask: askId, reply: INBOX_REPLY.CHOSE, choices: ["Ship it"] },
        });

        assert.equal(sent.status, HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE);
        const kept = (yield* inbox.read()).items.find((each) => each.id === item.id);
        assert.equal(kept?.status, INBOX_STATUS.OPEN);
        assert.deepEqual(threadOf(kept), [
          [INBOX_MESSAGE_AUTHOR.AGENT, DEPLOY.body, INBOX_ASK_STATUS.OPEN, undefined],
        ]);
        assert.equal(countedFor(inbox.owner, SERVER_EVENT.INBOX_ANSWER_SEND), 0);
      }),
  );

  it.effect(
    "a member marks an item read and unread for themselves alone, or every item of a workspace's Inbox read, and an outsider, another method, and a malformed request are refused",
    () =>
      Effect.gen(function* () {
        const { owner, other, task, ask, post, read, waiting } = yield* openInbox();
        const asked = yield* post(QUESTION);
        assert.ok(Result.isSuccess(asked));
        const { id } = asked.success;
        const unread = () =>
          Effect.map(read(), (page) => page.items.find((item) => item.id === id)?.unread);
        const mark = (method: string, bearer = owner) =>
          ask(request(INBOX_ITEM_READ, bearer, { method, id }));
        assert.equal(yield* unread(), true, "a new item is unread");
        assert.deepEqual(
          (yield* waiting()).items.map((entry) => [entry.id, entry.unread]),
          [[id, true]],
        );

        // Each mark answers the transaction it was written in, which a window following the inbox waits for.
        const { txid: readIn, ...markedRead } = readAnswer(
          inboxReadStateSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* mark("PUT"),
        );
        assert.deepEqual(markedRead, { id, unread: false });
        assert.match(readIn ?? "", /^\d+$/u);
        assert.equal(yield* unread(), false);
        const { txid: unreadIn, ...markedUnread } = readAnswer(
          inboxReadStateSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* mark("DELETE"),
        );
        assert.deepEqual(markedUnread, { id, unread: true });
        assert.match(unreadIn ?? "", /^\d+$/u);
        assert.equal(yield* unread(), true);

        assert.deepEqual(
          yield* mark("PUT", other),
          refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
          "an account outside the workspace reaches no item",
        );
        assert.deepEqual(
          yield* mark("POST"),
          refusal(HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED, HOSTED_API_ERROR.METHOD_NOT_ALLOWED),
        );
        assert.deepEqual(
          yield* ask(request(INBOX_READ, owner, { method: "DELETE", body: {} })),
          refusal(HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED, HOSTED_API_ERROR.METHOD_NOT_ALLOWED),
          "nothing marks every item unread",
        );

        const all = (body: WireBoundaryInput) =>
          ask(request(INBOX_READ, owner, { method: "PUT", body }));
        assert.deepEqual(
          yield* all({ workspaceId: "" }),
          refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
        );
        const marked = readAnswer(
          inboxReadAllSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* all({ workspaceId: task.workspaceId }),
        );
        assert.equal(marked.marked, 1);
        assert.match(marked.txid ?? "", /^\d+$/u);
        assert.equal(yield* unread(), false);
        assert.deepEqual(readAnswer(inboxReadAllSchema, HOSTED_HTTP_STATUS.OK, yield* all({})), {
          marked: 0,
        });
      }),
  );

  /**
   * Held reads driven to their answers a poll at a time, each step taken
   * only after a round trip to the test's database (`drivenWhileStarting`
   * says why), with how long each was held on the test's clock when it was
   * first seen answered. The bound is past any hold, so a read that never
   * lets go fails the test rather than hanging it.
   */
  const drivenToAnswers = (fibers: readonly Fiber.Fiber<unknown, unknown>[]) =>
    Effect.gen(function* () {
      const startedAt = yield* Clock.currentTimeMillis;
      const heldFor: (number | undefined)[] = fibers.map(() => undefined);
      const bound =
        2 * (Duration.toMillis(CODER.MESSAGES_HOLD) / Duration.toMillis(CODER.MESSAGES_POLL));
      for (let step = 0; step < bound && heldFor.includes(undefined); step += 1) {
        yield* Effect.orDie(
          Database.use((db) => db.select({ id: conversations.id }).from(conversations).limit(1)),
        );
        yield* TestClock.adjust(CODER.MESSAGES_POLL);
        yield* Effect.yieldNow;
        const now = yield* Clock.currentTimeMillis;
        fibers.forEach((fiber, index) => {
          if (heldFor[index] === undefined && fiber.pollUnsafe() !== undefined) {
            heldFor[index] = now - startedAt;
          }
        });
      }
      return { heldFor };
    });

  it.effect(
    "a held inbox read answers the moment an item lands past its cursor, a task's and the account's alike",
    () =>
      Effect.gen(function* () {
        const { post, read, waiting } = yield* openInbox();
        const task = yield* read();
        const account = yield* waiting();
        const heldTask = yield* Effect.forkChild(read(task.cursor));
        const heldAccount = yield* Effect.forkChild(waiting(account.cursor));

        const posted = yield* post(QUESTION);
        assert.ok(Result.isSuccess(posted));
        const { heldFor } = yield* drivenToAnswers([heldTask, heldAccount]);
        const movedTask = yield* Fiber.join(heldTask);
        const movedAccount = yield* Fiber.join(heldAccount);

        assert.deepEqual(
          movedTask.items.map((item) => item.id),
          [posted.success.id],
        );
        assert.notEqual(movedTask.cursor, task.cursor);
        assert.deepEqual(
          movedAccount.items.map((entry) => entry.id),
          [posted.success.id],
        );
        assert.notEqual(movedAccount.cursor, account.cursor);
        for (const held of heldFor) {
          assert.ok(
            held !== undefined && held < Duration.toMillis(CODER.MESSAGES_HOLD),
            `answered on the change, before the hold ends (held ${held} ms)`,
          );
        }
      }),
  );

  it.effect(
    "a held inbox read lets go at the hold with the inbox unchanged, a task's and the account's alike, and not a poll before",
    () =>
      Effect.gen(function* () {
        const { post, read, waiting } = yield* openInbox();
        assert.ok(Result.isSuccess(yield* post(QUESTION)));
        const task = yield* read();
        const account = yield* waiting();
        const heldTask = yield* Effect.forkChild(read(task.cursor));
        const heldAccount = yield* Effect.forkChild(waiting(account.cursor));

        const { heldFor } = yield* drivenToAnswers([heldTask, heldAccount]);
        const lapsedTask = yield* Fiber.join(heldTask);
        const lapsedAccount = yield* Fiber.join(heldAccount);

        assert.deepEqual(lapsedTask, task);
        assert.deepEqual(
          [lapsedAccount.items, lapsedAccount.cursor],
          [account.items, account.cursor],
        );
        for (const held of heldFor) {
          assert.ok(
            held !== undefined && held >= Duration.toMillis(CODER.MESSAGES_HOLD),
            `held until the hold ends (held ${held} ms)`,
          );
        }
      }),
  );

  it.effect(
    "the inbox's refusals answer the old groups' bytes through the hosted oRPC route: the caller first, then the body's bound and shape, then the item",
    () =>
      Effect.gen(function* () {
        const { owner, task, fetch, post } = yield* openInbox();
        const posted = yield* post(QUESTION);
        assert.ok(Result.isSuccess(posted));
        const bytes = (sent: Request) =>
          Effect.gen(function* () {
            const response = yield* fetch(sent);
            return {
              status: response.status,
              contentType: response.headers.get("content-type"),
              cacheControl: response.headers.get("cache-control"),
              text: yield* Effect.promise(() => response.text()),
            };
          });
        const refused = (status: number, error: string) => ({
          status,
          contentType: "application/json",
          cacheControl: null,
          text: JSON.stringify({ error }),
        });
        const answering = (bearer: string | undefined, id: string, body: WireBoundaryInput) =>
          request(INBOX_ITEM, bearer, { method: "POST", id, body });

        assert.deepEqual(
          yield* bytes(answering(undefined, posted.success.id, { malformed: true })),
          refused(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN),
          "an unsigned caller is refused before its body is read",
        );
        const oversized = answering(owner, posted.success.id, { malformed: true });
        oversized.headers.set("content-length", String(64 * 1024 * 1024));
        assert.deepEqual(
          yield* bytes(oversized),
          refused(HOSTED_HTTP_STATUS.PAYLOAD_TOO_LARGE, HOSTED_API_ERROR.REQUEST_TOO_LARGE),
        );
        assert.deepEqual(
          yield* bytes(answering(owner, posted.success.id, { malformed: true })),
          refused(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
        );
        const answer = {
          revision: posted.success.revision,
          clientKey: randomUUID(),
          reply: INBOX_REPLY.ACKNOWLEDGED,
        };
        assert.deepEqual(
          yield* bytes(answering(owner, posted.success.id, { ...answer, unknown: 1 })),
          refused(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
          "a key the body does not declare is refused, as the old group refused it",
        );
        assert.deepEqual(
          yield* bytes(answering(owner, randomUUID(), answer)),
          refused(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );
        assert.deepEqual(
          yield* bytes(answering(owner, "not-a-uuid", answer)),
          refused(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );
        assert.deepEqual(
          yield* bytes(request(TASK_INBOX, owner, { id: task.id, after: "" })),
          refused(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
          "a cursor outside its shape is refused",
        );
        assert.deepEqual(
          yield* bytes(request(TASK_INBOX, owner, { id: randomUUID() })),
          refused(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );
      }),
  );

  it.effect(
    "a run of the account's own automation that failed to start rides the account's inbox read and moves its cursor, as no item, and another account's read carries none",
    () =>
      Effect.gen(function* () {
        const { owner, other, task, waiting } = yield* openInbox();
        const automation = Option.getOrThrow(
          yield* createAutomation(owner, {
            organizationId: task.workspaceId,
            repositories: task.repository === null ? [] : [task.repository],
            name: "Nightly flaky-test sweep",
            trigger: { kind: AUTOMATION_TRIGGER.WEBHOOK },
            action: { kind: AUTOMATION_ACTION.AGENT, prompt: "Fix one flaky test." },
            guards: AUTOMATION_DEFAULT_GUARDS,
            nextRunAt: null,
            webhookSecretHash: null,
          }),
        );
        const before = yield* waiting();

        const run = Option.getOrThrow(
          yield* recordAutomationRun(automation, {
            dedupeKey: randomUUID(),
            firing: { kind: AUTOMATION_FIRING.MANUAL },
            firedAt: yield* DateTime.nowAsDate,
          }),
        );
        yield* settleAutomationRun(run.id, {
          status: AUTOMATION_RUN_STATUS.FAILED,
          reason: AUTOMATION_RUN_REASON.REPOSITORY_UNREACHABLE,
        });
        const after = yield* waiting(before.cursor);

        assert.deepEqual(before.failedRuns, []);
        assert.notEqual(after.cursor, before.cursor);
        assert.deepEqual(after.items, before.items);
        assert.deepEqual(
          after.failedRuns?.map((each) => [
            each.id,
            each.automationId,
            each.automationName,
            each.workspaceId,
            each.reason,
          ]),
          [
            [
              run.id,
              automation.id,
              "Nightly flaky-test sweep",
              task.workspaceId,
              AUTOMATION_RUN_REASON.REPOSITORY_UNREACHABLE,
            ],
          ],
        );
        assert.deepEqual((yield* waiting(undefined, other)).failedRuns, []);
      }),
  );

  it.effect(
    "an item's attachment is served as its bytes under the type the service kept, not to be sniffed, not to be cached, and never to run as a page, to the item's account alone: another account, no bearer, another item, and a name that is no attachment are refused",
    () =>
      Effect.gen(function* () {
        const { owner, other, fetch, ask, post, read } = yield* openInbox();
        yield* post(
          {
            key: "landing",
            title: "Does the landing page read right?",
            body: "![The landing page](shots/landing.png)",
            ask: {
              type: INBOX_ASK.DECIDE,
              options: [
                { label: INBOX_APPROVAL_OPTION.APPROVE },
                { label: INBOX_APPROVAL_OPTION.DECLINE },
              ],
            },
          },
          [
            {
              path: "shots/landing.png",
              name: "landing.png",
              contentType: INBOX_IMAGE_TYPE.PNG,
              bytes: PNG,
            },
          ],
        );
        const item = (yield* read()).items.find((each) => each.key === "landing");
        const file = item?.thread?.[0]?.files?.[0];
        assert.ok(item && file);
        const at = (bearer: string | undefined, id = item.id, attachment = file.attachmentId) =>
          request(INBOX_ATTACHMENT, bearer, { id, attachment });

        const served = yield* fetch(at(owner));
        assert.equal(served.status, HOSTED_HTTP_STATUS.OK);
        assert.equal(served.headers.get("content-type"), INBOX_IMAGE_TYPE.PNG);
        assert.equal(served.headers.get("x-content-type-options"), "nosniff");
        assert.equal(served.headers.get("cache-control"), "private, no-store");
        assert.deepEqual(openedPagePolicy(served.headers), SANDBOXED_PAGE);
        assert.deepEqual(new Uint8Array(yield* Effect.promise(() => served.arrayBuffer())), PNG);

        assert.deepEqual(
          yield* ask(at(other)),
          refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );
        assert.deepEqual(
          yield* ask(at(undefined)),
          refusal(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN),
        );
        assert.deepEqual(
          yield* ask(at(owner, randomUUID())),
          refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );
        assert.deepEqual(
          yield* ask(at(owner, item.id, "landing.png")),
          refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );
        assert.deepEqual(
          yield* ask(
            request(INBOX_ATTACHMENT, owner, {
              method: "POST",
              id: item.id,
              attachment: file.attachmentId,
            }),
          ),
          refusal(HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED, HOSTED_API_ERROR.METHOD_NOT_ALLOWED),
        );
      }),
  );
});
