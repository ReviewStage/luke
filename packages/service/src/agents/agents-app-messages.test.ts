/**
 * agents-app-messages.test.ts -- messaging a coding agent through the hosted router: what a message reaches, queues, refuses, and writes to the transcript, over a fake eve.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database, type DatabaseServices } from "@luke/database/core/query";
import {
  pinAgent,
  readAgent,
  recordAgentPublished,
  takeAgentMentionedServers,
  updateAgentBranch,
} from "@luke/database/models/agent-store";
import { MENTIONED_HEADING } from "@luke/database/models/attached-file-parts";
import { createAutomation } from "@luke/database/models/automation-store";
import { readConversationPicture } from "@luke/database/models/conversation-pictures";
import { sentLineStands } from "@luke/database/models/message-reads";
import { writePage } from "@luke/database/models/plan-pages";
import { claimRuntimeSession } from "@luke/database/models/recorded-session";
import { readTask } from "@luke/database/models/task-store";
import { storeWriter } from "@luke/database/models/writer";
import { agentPin } from "@luke/database/schemas";
import { agentTable } from "@luke/database/schemas/agent";
import { attachment } from "@luke/database/schemas/attachment";
import { user } from "@luke/database/schemas/auth";
import { githubInstallation } from "@luke/database/schemas/github-installation";
import { inboxItem } from "@luke/database/schemas/inbox";
import { conversations } from "@luke/database/schemas/storage";
import { task as taskTable } from "@luke/database/schemas/task";
import { MESSAGE_SENDER } from "@luke/database/storage-vocabulary";
import { getTestDB, joinWorkspace, openWorkspace, startTask } from "@luke/database/testing";
import { HOSTED_API_ERROR } from "@luke/features";
import { AGENT_TOOL } from "@luke/features/agent-tools";
import {
  AGENT_ARCHIVER,
  AGENT_ATTACHMENT_TYPE,
  AGENT_BOUNDS,
  AGENT_KIND,
  AGENT_SENDER,
  AGENT_STATUS,
  agentAnswerSchema,
  agentListAnswerSchema,
  agentMessageAnswerSchema,
  agentMessagesAnswerSchema,
  agentPageAnswerSchema,
  CHECK_SUMMARY,
  PULL_REQUEST_STATE,
} from "@luke/features/agent-wire";
import {
  AUTOMATION_ACTION,
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_FIRING,
  AUTOMATION_SCOPE,
  AUTOMATION_TRIGGER,
  type AutomationFiring,
  GITHUB_TRIGGER_EVENT,
} from "@luke/features/automation-wire";
import { keptPictureIdOf } from "@luke/features/conversation-picture-wire";
import { GITHUB_ACCESS } from "@luke/features/github-repositories-wire";
import { INBOX_ASK, INBOX_CURSOR_START, inboxAnswerSchema } from "@luke/features/inbox-wire";
import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import { lukeToolsAnswerSchema } from "@luke/features/luke-tools-wire";
import { MENTION_KIND, mentionMarkdown } from "@luke/features/mention-link";
import { PAGE_SHOWER, taskPageOwner } from "@luke/features/page-wire";
import { REPOSITORY_UNREACHED } from "@luke/features/repository-reach-wire";
import {
  MERGE_POLICY,
  type MergePolicy,
  TASK_LIST_ARCHIVED,
  TASK_MODE,
  TASK_STATUS,
  taskAnswerSchema,
  taskDeleteAnswerSchema,
  taskListAnswerSchema,
} from "@luke/features/task-wire";
import { sentLineId } from "@luke/wire/host-ids";
import { eq } from "drizzle-orm";
import { Clock, Duration, Effect, Option, Queue, Result } from "effect";
import { SqlClient } from "effect/sql";
import { TestClock } from "effect/testing";
import {
  AssistantMessageBuilder,
  isRecord,
  MESSAGE_ROLE,
  RUN_EVENT,
  RUN_STATUS,
  RUN_TURN_ORIGIN,
  sessionKey,
  TURN_ORIGIN,
  TURN_TRIGGER,
} from "../core.js";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import { postInboxThread } from "../inbox/inbox-store.js";
import { MERGE_POLICY_NOTICE } from "../tasks/merge-policy-notice.js";
import {
  AGENT,
  AGENT_INBOX,
  AGENT_LUKE_TOOLS,
  AGENT_MESSAGES,
  AGENT_PICTURE,
  deploymentFor,
  fakeEve,
  messageAs,
  openTask,
  RELAY_FULL_NAME,
  readAnswer,
  receiptOf,
  refusal,
  request,
  SIZED_PNG,
  SMALL_WINDOW,
  SNAPSHOT,
  SOL,
  sessionCookieOf,
  startAs,
  startedAgentOf,
  TASK,
  TASK_AGENTS,
  TASKS,
  text,
  transcriptRow,
  userTexts,
} from "../testing/agents-app-support.js";
import { scriptedSessionSandboxes } from "../testing/session-sandboxes-fake.js";
import { receivedMessage } from "./attached-files.js";
import { CODER } from "./coder-host/bounds.js";
import { CODER_TOOL_SET } from "./coder-host/tool-set.js";
import { EVE_HOST_TURN } from "./eve-host/bounds.js";
import { EVE_SEND_OUTCOME } from "./eve-host/eve-sessions.js";
import type { SandboxStopReach } from "./session-sandboxes.js";

it.layer(getTestDB())("messaging a coding agent", (it) => {
  /** An agent started on the owner's task, its session claimed, and its first turn where asked. */
  const startedAgent = (
    eve: ReturnType<typeof fakeEve>,
    turn: { readonly running: boolean } | undefined,
    sessionSandboxes?: SandboxStopReach["sessionSandboxes"],
  ) =>
    Effect.flatMap(
      openTask({
        eve,
        ...(sessionSandboxes === undefined ? undefined : { sessionSandboxes }),
      }),
      (opened) => agentStartedOn(opened, eve, turn),
    );

  /** Another agent the owner starts on the task opened, its turn running or ended as `turn` says, as `startedAgent` starts the first. */
  const agentStartedOn = (
    opened: Effect.Success<ReturnType<typeof openTask>>,
    eve: ReturnType<typeof fakeEve>,
    turn: { readonly running: boolean } | undefined,
  ) =>
    Effect.gen(function* () {
      const agent = readAnswer(
        agentAnswerSchema,
        HOSTED_HTTP_STATUS.CREATED,
        yield* opened.ask(startAs(opened.owner, opened.task.id, { idempotencyKey: randomUUID() })),
      ).agent;
      const stored = yield* readAgent(opened.owner, agent.id);
      assert.ok(Option.isSome(stored));
      const target = { userId: opened.owner, conversationId: stored.value.conversationId };
      const sessionId = eve.opened.at(-1)?.sessionId ?? "";
      assert.equal(yield* claimRuntimeSession(target, sessionId, new Date()), true);
      const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
      const turnId = randomUUID();
      if (turn !== undefined) {
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
        // eve's receipt of the Start's first message takes the line the Start wrote into the turn, as the relay does.
        const taken = yield* writer.takeAwaitingLine(target, { text: SNAPSHOT, turnId });
        assert.equal(Result.getOrUndefined(taken)?.length, 1);
        if (!turn.running) {
          yield* writer.consume(target, {
            kind: RUN_EVENT.TURN_ENDED,
            conversationId: sessionKey(target.conversationId),
            turnId,
            sequence: 2,
            status: RUN_STATUS.SUCCEEDED,
            responseIds: [],
            at: 0,
          });
        }
      }
      /** The transcript as the owner reads it now: the developer's lines, and the status. */
      const transcript = () =>
        Effect.map(
          opened.ask(request(AGENT_MESSAGES, opened.owner, { id: agent.id })),
          (answered) => {
            const page = readAnswer(agentMessagesAnswerSchema, HOSTED_HTTP_STATUS.OK, answered);
            return { lines: userTexts(page), status: page.status };
          },
        );
      /** A message of the owner's under the key given, or one minted, answered as the wire declares a message taken. */
      const sent = (text: string, clientKey = randomUUID()) =>
        Effect.map(opened.ask(messageAs(opened.owner, agent.id, { text, clientKey })), (answered) =>
          readAnswer(agentMessageAnswerSchema, HOSTED_HTTP_STATUS.ACCEPTED, answered),
        );
      return { ...opened, agent, target, sessionId, writer, turnId, transcript, sent };
    });

  /** Where an agent's Stop lands. */
  const AGENT_STOP = "/api/agents/stop";

  it.effect(
    "over a browser's session cookie a message reaches the agent as the deployment acting for the cookie's account, and over the bearer as ever over the bearer",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { owner, agent, ask, sessionId } = yield* startedAgent(eve, { running: false });
        const message = (text: string) => ({ text, clientKey: randomUUID() });

        const overCookie = yield* ask(
          request(AGENT_MESSAGES, undefined, {
            method: "POST",
            id: agent.id,
            cookie: sessionCookieOf(owner),
            body: message("Use the new table."),
          }),
        );
        const overBearer = yield* ask(messageAs(owner, agent.id, message("And drop the old one.")));

        assert.equal(
          overCookie.status,
          HOSTED_HTTP_STATUS.ACCEPTED,
          JSON.stringify(overCookie.body),
        );
        assert.equal(
          overBearer.status,
          HOSTED_HTTP_STATUS.ACCEPTED,
          JSON.stringify(overBearer.body),
        );
        assert.deepEqual(
          eve.sent.map((each) => [each.authorization, each.sessionId, each.message.message]),
          [
            [deploymentFor(owner), sessionId, "Use the new table."],
            [`Bearer ${owner}`, sessionId, "And drop the old one."],
          ],
        );
      }),
  );

  it.effect(
    "an image sent to an agent is kept once beside its conversation and handed to eve with a line naming its id, which reads back as the image and by which eve's receipt takes the line; a repeat under its key hands eve nothing, and the same image in a later message is named by the same row",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { owner, agent, ask, target, writer, turnId } = yield* startedAgent(eve, {
          running: true,
        });
        const shot = {
          name: "flow.png",
          mediaType: AGENT_ATTACHMENT_TYPE.PNG,
          data: Buffer.from(SIZED_PNG).toString("base64"),
        };
        const body = { text: "Match this.", attachments: [shot], clientKey: randomUUID() };
        const kept = Database.use((db) =>
          db
            .select({ id: attachment.id })
            .from(attachment)
            .where(eq(attachment.conversationId, target.conversationId)),
        );

        const sent = yield* ask(messageAs(owner, agent.id, body));
        assert.equal(sent.status, HOSTED_HTTP_STATUS.ACCEPTED, JSON.stringify(sent.body));
        const [row, ...more] = yield* kept;
        assert.ok(row !== undefined && more.length === 0, "one picture is kept");
        const handed = receiptOf(eve.sent.at(-1)?.message.message);
        assert.deepEqual(
          handed.map((part) => (part.type === "text" ? part.text : part.filename)),
          ["Match this.", "flow.png", `Image flow.png is attachment ${row.id}`],
        );
        const picture = Option.getOrThrow(
          yield* readConversationPicture(target.conversationId, row.id),
        );
        assert.equal(picture.contentType, AGENT_ATTACHMENT_TYPE.PNG);
        assert.deepEqual(new Uint8Array(picture.bytes), SIZED_PNG);
        // eve's receipt of the message, its image staged by name with no bytes, takes the line it was sent as.
        const taken = yield* writer.takeAwaitingLine(target, {
          text: receivedMessage({ message: "", parts: handed }).text,
          turnId,
        });
        assert.ok(Result.isSuccess(taken));
        assert.equal(taken.success.length, 1, "the receipt takes the one line awaiting it");

        const sends = eve.sent.length;
        assert.equal(
          (yield* ask(messageAs(owner, agent.id, body))).status,
          HOSTED_HTTP_STATUS.ACCEPTED,
        );
        assert.equal(eve.sent.length, sends, "a repeat reaches eve no second time");
        yield* ask(
          messageAs(owner, agent.id, { ...body, text: "Again.", clientKey: randomUUID() }),
        );
        assert.deepEqual(receiptOf(eve.sent.at(-1)?.message.message).at(-1), {
          type: "text",
          text: `Image flow.png is attachment ${row.id}`,
        });
        assert.deepEqual(yield* kept, [row]);
      }),
  );

  it.effect(
    "an image sent to an agent is kept on its row by the picture's id with no bytes, which the transcript read answers and the agent's picture route serves, a PDF beside it keeps its bytes, and eve's receipt still takes the line",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { owner, agent, ask, fetch, target, writer, turnId } = yield* startedAgent(eve, {
          running: true,
        });
        const data = Buffer.from(SIZED_PNG).toString("base64");
        const pdf = Buffer.from("%PDF-1.4").toString("base64");
        const sent = yield* ask(
          messageAs(owner, agent.id, {
            text: "Match this.",
            attachments: [
              { name: "flow.png", mediaType: AGENT_ATTACHMENT_TYPE.PNG, data },
              { name: "spec.pdf", mediaType: AGENT_ATTACHMENT_TYPE.PDF, data: pdf },
            ],
            clientKey: randomUUID(),
          }),
        );
        assert.equal(sent.status, HOSTED_HTTP_STATUS.ACCEPTED, JSON.stringify(sent.body));

        const page = readAnswer(
          agentMessagesAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(AGENT_MESSAGES, owner, { id: agent.id })),
        );
        const files = page.messages.flatMap((message) =>
          message.parts.filter((part) => isRecord(part) && part.type === "file"),
        );
        const [image, spec, ...more] = files;
        assert.ok(isRecord(image) && isRecord(spec) && more.length === 0, JSON.stringify(files));
        assert.equal(image.url, "", "the row carries no bytes of the image");
        assert.doesNotMatch(JSON.stringify(page.messages), /data:image\//u);
        assert.equal(spec.url, `data:${AGENT_ATTACHMENT_TYPE.PDF};base64,${pdf}`);
        const pictureId = keptPictureIdOf(image.providerMetadata);
        assert.ok(pictureId !== undefined, "the row names the kept picture");

        const served = yield* fetch(
          request(AGENT_PICTURE, owner, { id: agent.id, picture: pictureId }),
        );
        assert.equal(served.status, HOSTED_HTTP_STATUS.OK);
        assert.deepEqual(
          new Uint8Array(yield* Effect.promise(() => served.arrayBuffer())),
          SIZED_PNG,
        );
        const taken = yield* writer.takeAwaitingLine(target, {
          text: receivedMessage({ message: "", parts: receiptOf(eve.sent.at(-1)?.message.message) })
            .text,
          turnId,
        });
        assert.ok(Result.isSuccess(taken));
        assert.equal(taken.success.length, 1, "the receipt takes the line its row names by id");
      }),
  );

  it.effect(
    "over a browser's session cookie a Stop, an Archive, and the task's archive each cancel the turn under way as the deployment acting for the cookie's account",
    () =>
      Effect.gen(function* () {
        const stopped = yield* startedAgent(fakeEve(), { running: true });
        const archived = yield* startedAgent(fakeEve(), { running: true });
        const withTask = yield* startedAgent(fakeEve(), { running: true });

        const stop = yield* stopped.ask(
          request(AGENT_STOP, undefined, {
            method: "POST",
            id: stopped.agent.id,
            cookie: sessionCookieOf(stopped.owner),
          }),
        );
        const archive = yield* archived.ask(
          request(AGENT, undefined, {
            method: "PATCH",
            id: archived.agent.id,
            cookie: sessionCookieOf(archived.owner),
            body: { archived: true },
          }),
        );
        const taskArchive = yield* withTask.ask(
          request(TASK(withTask.task.id), undefined, {
            method: "PATCH",
            cookie: sessionCookieOf(withTask.owner),
            body: { archived: true },
          }),
        );

        assert.deepEqual(
          [stop.status, archive.status, taskArchive.status],
          [HOSTED_HTTP_STATUS.OK, HOSTED_HTTP_STATUS.OK, HOSTED_HTTP_STATUS.OK],
        );
        for (const { eve, owner, sessionId } of [stopped, archived, withTask]) {
          assert.deepEqual(eve.cancelled, [[sessionId, "turn_0"]]);
          assert.deepEqual(eve.cancelledAs, [deploymentFor(owner)]);
        }
        assert.notEqual(
          Option.getOrThrow(yield* readAgent(archived.owner, archived.agent.id)).archivedAt,
          null,
        );
      }),
  );

  it.effect(
    "a task's archive, as an older build asks it, archives none of its agents, so it stops no sandbox: an unarchived agent's resumes as it did",
    () =>
      Effect.gen(function* () {
        const sandboxes = yield* scriptedSessionSandboxes();
        const { owner, task, ask } = yield* startedAgent(
          fakeEve(),
          { running: false },
          sandboxes.layer,
        );

        const archived = yield* ask(
          request(TASK(task.id), owner, { method: "PATCH", body: { archived: true } }),
        );

        assert.equal(archived.status, HOSTED_HTTP_STATUS.OK);
        assert.deepEqual(yield* Queue.poll(sandboxes.stops), Option.none());
      }),
  );

  it.effect(
    "a merge-policy switch is refused on a task that is no pilot tree's top, and on a top pilot task is written and told to its pilot in the member's words, once per move",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { owner, task, agent, sessionId, ask } = yield* startedAgent(eve, {
          running: false,
        });
        const switched = (mergePolicy: MergePolicy) =>
          ask(request(TASK(task.id), owner, { method: "PATCH", body: { mergePolicy } }));
        assert.equal((yield* switched(MERGE_POLICY.HOLD)).status, HOSTED_HTTP_STATUS.BAD_REQUEST);
        yield* Database.use((db) =>
          db.update(taskTable).set({ mode: TASK_MODE.PILOT }).where(eq(taskTable.id, task.id)),
        );
        yield* Database.use((db) =>
          db.update(agentTable).set({ kind: AGENT_KIND.PILOT }).where(eq(agentTable.id, agent.id)),
        );
        const sends = eve.sent.length;

        const held = yield* switched(MERGE_POLICY.HOLD);
        assert.equal(held.status, HOSTED_HTTP_STATUS.OK, JSON.stringify(held.body));
        assert.equal(
          readAnswer(taskAnswerSchema, HOSTED_HTTP_STATUS.OK, held).plan.mergePolicy,
          MERGE_POLICY.HOLD,
        );
        assert.deepEqual(
          eve.sent
            .slice(sends)
            .map((each) => [each.authorization, each.sessionId, each.message.message]),
          [[`Bearer ${owner}`, sessionId, MERGE_POLICY_NOTICE[MERGE_POLICY.HOLD]]],
        );
        // The same switch again moves nothing, so the pilot hears nothing more.
        yield* switched(MERGE_POLICY.HOLD);
        assert.equal(eve.sent.length, sends + 1);
      }),
  );

  it.effect(
    "over a browser's session cookie a task's delete stops its agent and retires the agent's session as the deployment acting for the cookie's account, before the task goes",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { owner, task, ask, sessionId } = yield* startedAgent(eve, { running: true });

        const deleted = yield* ask(
          request(TASK(task.id), undefined, {
            method: "DELETE",
            cookie: sessionCookieOf(owner),
          }),
        );

        assert.equal(
          readAnswer(taskDeleteAnswerSchema, HOSTED_HTTP_STATUS.OK, deleted).deleted,
          true,
        );
        assert.deepEqual(eve.cancelled, [[sessionId, "turn_0"]]);
        assert.deepEqual(eve.cancelledAs, [deploymentFor(owner)]);
        assert.deepEqual(eve.reset, [sessionId]);
        assert.deepEqual(eve.resetAs, [deploymentFor(owner)]);
        assert.ok(Option.isNone(yield* readTask(owner, task.id)));
      }),
  );

  it.effect(
    "a task's delete retires its agent's session with no transaction open, so no lock waits on eve",
    () =>
      Effect.gen(function* () {
        const services = yield* Effect.context<DatabaseServices>();
        // Two statements in a row share a transaction's id where one stands open around them.
        const alone = Effect.flatMap(SqlClient.SqlClient, (sql) =>
          Effect.gen(function* () {
            const xid = sql<{ readonly xid: string }>`select txid_current()::text as xid`;
            const [first] = yield* xid;
            const [second] = yield* xid;
            return first !== undefined && second !== undefined && first.xid !== second.xid;
          }),
        ).pipe(Effect.provide(services), Effect.orDie);
        const eve = fakeEve({ resetSees: alone });
        const { owner, task, ask, sessionId } = yield* startedAgent(eve, { running: true });

        const deleted = yield* ask(request(TASK(task.id), owner, { method: "DELETE" }));

        assert.equal(
          readAnswer(taskDeleteAnswerSchema, HOSTED_HTTP_STATUS.OK, deleted).deleted,
          true,
        );
        assert.deepEqual(eve.reset, [sessionId]);
        assert.deepEqual(eve.resetSaw, [true]);
        assert.ok(Option.isNone(yield* readTask(owner, task.id)));
      }),
  );

  it.effect(
    "a task's delete stops its running agents at once, eve answering no cancel until both have asked",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve({ cancelsTogether: 2 });
        const first = yield* startedAgent(eve, { running: true });
        const second = yield* agentStartedOn(first, eve, { running: true });

        const deleted = yield* first.ask(
          request(TASK(first.task.id), first.owner, { method: "DELETE" }),
        );

        assert.equal(
          readAnswer(taskDeleteAnswerSchema, HOSTED_HTTP_STATUS.OK, deleted).deleted,
          true,
        );
        assert.deepEqual(
          eve.cancelled.toSorted(([one], [other]) => one.localeCompare(other)),
          [
            [first.sessionId, "turn_0"],
            [second.sessionId, "turn_0"],
          ].toSorted(([one], [other]) => (one ?? "").localeCompare(other ?? "")),
        );
      }),
  );

  it.effect(
    "a teammate's session cookie messages and stops the owner's agent and deletes its task, each as the deployment acting for the teammate and never for the owner the rows name",
    () =>
      Effect.gen(function* () {
        // An idle agent of the owner's, which the teammate messages.
        const messaged = yield* startedAgent(fakeEve(), { running: false });
        yield* joinWorkspace(messaged.task.workspaceId, messaged.other);
        // A running agent of the owner's, which the teammate stops, and then deletes its task.
        const stopped = yield* startedAgent(fakeEve(), { running: true });
        yield* joinWorkspace(stopped.task.workspaceId, stopped.other);
        const teammate = sessionCookieOf(stopped.other);

        const sent = yield* messaged.ask(
          request(AGENT_MESSAGES, undefined, {
            method: "POST",
            id: messaged.agent.id,
            cookie: sessionCookieOf(messaged.other),
            body: { text: "Use the new table.", clientKey: randomUUID() },
          }),
        );
        const agentStop = yield* stopped.ask(
          request(AGENT_STOP, undefined, {
            method: "POST",
            id: stopped.agent.id,
            cookie: teammate,
          }),
        );
        const deleted = yield* stopped.ask(
          request(TASK(stopped.task.id), undefined, { method: "DELETE", cookie: teammate }),
        );

        assert.equal(sent.status, HOSTED_HTTP_STATUS.ACCEPTED, JSON.stringify(sent.body));
        assert.deepEqual(
          messaged.eve.sent.map((each) => [each.authorization, each.sessionId]),
          [[deploymentFor(messaged.other), messaged.sessionId]],
        );
        assert.equal(agentStop.status, HOSTED_HTTP_STATUS.OK);
        assert.equal(
          readAnswer(taskDeleteAnswerSchema, HOSTED_HTTP_STATUS.OK, deleted).deleted,
          true,
        );
        assert.deepEqual(stopped.eve.cancelled, [[stopped.sessionId, "turn_0"]]);
        assert.deepEqual(stopped.eve.cancelledAs, [deploymentFor(stopped.other)]);
        assert.deepEqual(stopped.eve.reset, [stopped.sessionId]);
        assert.deepEqual(stopped.eve.resetAs, [deploymentFor(stopped.other)]);
      }),
  );

  it.effect(
    "another account's session cookie reaches none of an agent's or its task's controls, which answer as nothing there and ask eve nothing",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { owner, other, task, agent, ask } = yield* startedAgent(eve, { running: true });
        const cookie = sessionCookieOf(other);
        const notFound = refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND);

        for (const asked of [
          request(AGENT_MESSAGES, undefined, {
            method: "POST",
            id: agent.id,
            cookie,
            body: { text: "Push to main.", clientKey: randomUUID() },
          }),
          request(AGENT_STOP, undefined, { method: "POST", id: agent.id, cookie }),
          request(AGENT, undefined, {
            method: "PATCH",
            id: agent.id,
            cookie,
            body: { archived: true },
          }),
          request(TASK(task.id), undefined, {
            method: "PATCH",
            cookie,
            body: { archived: true },
          }),
          request(TASK(task.id), undefined, { method: "DELETE", cookie }),
        ]) {
          const { pathname } = new URL(asked.url);
          assert.deepEqual(yield* ask(asked), notFound, `${asked.method} ${pathname}`);
        }
        assert.deepEqual(
          [eve.sent, eve.cancelled, eve.reset],
          [[], [], []],
          "the owner's Start is all eve heard",
        );
        assert.ok(Option.isSome(yield* readTask(owner, task.id)));
      }),
  );

  it.effect(
    "a teammate's delete of a running agent stops it, retires its session, and takes it with its pins and its inbox, stamping its conversation deleted",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { owner, other, task, agent, target, sessionId, ask } = yield* startedAgent(eve, {
          running: true,
        });
        yield* joinWorkspace(task.workspaceId, other);
        // An agent with no task, so it holds a pin of its own.
        yield* Database.use((db) =>
          db
            .update(agentTable)
            .set({ taskId: null, organizationId: task.workspaceId })
            .where(eq(agentTable.id, agent.id)),
        );
        assert.ok(Option.isSome(yield* pinAgent(owner, agent.id, true)));
        const posted = yield* postInboxThread(
          { userId: owner, taskId: null, agentId: agent.id },
          {
            key: "which-queue",
            title: "Which queue?",
            body: "Which queue should the jobs run on?",
            ask: { type: INBOX_ASK.ANSWER },
          },
        );
        assert.ok(Result.isSuccess(posted));
        const deleted = yield* ask(request(AGENT, other, { method: "DELETE", id: agent.id }));

        assert.equal(deleted.status, HOSTED_HTTP_STATUS.OK, JSON.stringify(deleted.body));
        assert.match(JSON.stringify(deleted.body), /^\{"deleted":true,"txid":"\d+"\}$/u);
        assert.deepEqual(eve.cancelled, [[sessionId, "turn_0"]]);
        assert.deepEqual(eve.reset, [sessionId]);
        assert.ok(Option.isNone(yield* readAgent(owner, agent.id)));
        const db = yield* Database;
        const [conversation] = yield* db
          .select({ deletedAt: conversations.deletedAt })
          .from(conversations)
          .where(eq(conversations.id, target.conversationId));
        assert.ok(conversation !== undefined && conversation.deletedAt !== null);
        assert.deepEqual(
          [
            yield* db
              .select({ userId: agentPin.userId })
              .from(agentPin)
              .where(eq(agentPin.agentId, agent.id)),
            yield* db
              .select({ id: inboxItem.id })
              .from(inboxItem)
              .where(eq(inboxItem.id, posted.success.id)),
          ],
          [[], []],
          "nothing of the agent's stays",
        );
      }),
  );

  it.effect(
    "an account outside the workspace reaches no agent to delete and asks eve nothing; the owner's delete of an idle agent on a task leaves the task, and a second delete finds nothing",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { owner, other, task, agent, sessionId, ask } = yield* startedAgent(eve, {
          running: false,
        });
        const notFound = refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND);

        const outside = yield* ask(request(AGENT, other, { method: "DELETE", id: agent.id }));
        assert.deepEqual(outside, notFound);
        assert.deepEqual([eve.cancelled, eve.reset], [[], []]);
        assert.ok(Option.isSome(yield* readAgent(owner, agent.id)));

        const deleted = yield* ask(request(AGENT, owner, { method: "DELETE", id: agent.id }));
        const again = yield* ask(request(AGENT, owner, { method: "DELETE", id: agent.id }));

        assert.equal(deleted.status, HOSTED_HTTP_STATUS.OK, JSON.stringify(deleted.body));
        assert.deepEqual(again, notFound);
        assert.deepEqual([eve.cancelled, eve.reset], [[], [sessionId]]);
        assert.ok(Option.isSome(yield* readTask(owner, task.id)));
      }),
  );

  it.effect(
    "an agent still starting, with no turn a Stop can name, is refused as not ready and stands, its session unretired",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { owner, agent, ask } = yield* startedAgent(eve, undefined);

        const refused = yield* ask(request(AGENT, owner, { method: "DELETE", id: agent.id }));

        assert.deepEqual(
          refused,
          refusal(HOSTED_HTTP_STATUS.CONFLICT, HOSTED_API_ERROR.AGENT_NOT_READY),
        );
        assert.deepEqual(eve.reset, []);
        assert.ok(Option.isSome(yield* readAgent(owner, agent.id)));
      }),
  );

  it.effect(
    "a task's archive naming an assignee who is no member is refused before any of its agents is stopped",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { owner, other, task, ask } = yield* startedAgent(eve, { running: true });

        const refused = yield* ask(
          request(TASK(task.id), owner, {
            method: "PATCH",
            body: { archived: true, assigneeId: other },
          }),
        );

        assert.deepEqual(
          refused,
          refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
        );
        assert.deepEqual(eve.cancelled, [], "no agent's turn was stopped");
        const standing = Option.getOrUndefined(yield* readTask(owner, task.id))?.task;
        // The agent's Start by hand assigned its starter, which the refused change leaves standing.
        assert.equal(standing?.assignee?.userId, owner);
      }),
  );

  it.effect(
    "a model change of a Claude Code agent is refused another provider's model or a context window, and takes a Claude model, its summary naming its runtime, while an eve agent's takes any as before",
    () =>
      Effect.gen(function* () {
        const onEve = yield* startedAgent(fakeEve(), undefined);
        const onClaudeCode = yield* startedAgent(fakeEve(), undefined);
        const stored = Option.getOrThrow(
          yield* readAgent(onClaudeCode.owner, onClaudeCode.agent.id),
        );
        yield* Database.use((db) =>
          db
            .update(conversations)
            .set({ runtime: "claude_code" })
            .where(eq(conversations.id, stored.conversationId)),
        );
        const change = (
          started: typeof onEve,
          body: { model: string; effort: string; contextWindow?: string },
        ) =>
          started.ask(
            request(AGENT, started.owner, { method: "PATCH", id: started.agent.id, body }),
          );

        const refused = [
          yield* change(onClaudeCode, { model: SOL, effort: "low" }),
          yield* change(onClaudeCode, {
            model: SMALL_WINDOW.model,
            effort: "low",
            contextWindow: "standard",
          }),
        ];
        const taken = readAnswer(
          agentAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* change(onClaudeCode, { model: SMALL_WINDOW.model, effort: "low" }),
        ).agent;
        const onEveTaken = readAnswer(
          agentAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* change(onEve, { model: SOL, effort: "low" }),
        ).agent;

        for (const answered of refused) {
          assert.deepEqual(
            answered,
            refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
          );
        }
        assert.deepEqual(
          [taken.model, taken.effort, taken.runtime],
          [SMALL_WINDOW.model, "low", "claude_code"],
        );
        assert.deepEqual([onEveTaken.model, onEveTaken.runtime], [SOL, undefined]);
      }),
  );

  it.effect(
    "a member's Archive of a teammate's agent records the member on it, which its summary names, and an Unarchive clears it",
    () =>
      Effect.gen(function* () {
        const { other, task, agent, ask } = yield* startedAgent(fakeEve(), { running: false });
        yield* joinWorkspace(task.workspaceId, other);
        const changed = (archived: boolean) =>
          Effect.map(
            ask(request(AGENT, other, { method: "PATCH", id: agent.id, body: { archived } })),
            (answered) => readAnswer(agentAnswerSchema, HOSTED_HTTP_STATUS.OK, answered).agent,
          );

        const archived = yield* changed(true);
        assert.ok(archived.archivedAt !== undefined);
        assert.equal(archived.archivedBy?.by, AGENT_ARCHIVER.MEMBER);
        assert.equal(archived.archivedBy?.member?.userId, other);
        assert.equal(archived.archivedBy?.agent, undefined);
        const back = yield* changed(false);
        assert.deepEqual([back.archivedAt, back.archivedBy], [undefined, undefined]);
      }),
  );

  it.effect(
    "a member's archive of a plan, as an older build asks it, stops its running agent first and settles the plan instead, Canceled with no merged pull request and Done with one, stamping no archive, and its unarchive puts the plan back to work",
    () =>
      Effect.gen(function* () {
        const { owner, other, task, agent, ask, eve, sessionId } = yield* startedAgent(fakeEve(), {
          running: true,
        });
        yield* joinWorkspace(task.workspaceId, other);
        const marked = (body: { archived?: boolean; status?: string }) =>
          Effect.map(
            ask(request(TASK(task.id), other, { method: "PATCH", body })),
            (answered) => answered.status,
          );
        const standing = () =>
          Effect.map(readTask(owner, task.id), (read) => {
            const { status, completedAt } = Option.getOrThrow(read).task;
            return { status, finished: completedAt !== undefined };
          });

        assert.equal(yield* marked({ archived: true }), HOSTED_HTTP_STATUS.OK);
        assert.deepEqual(eve.cancelled, [[sessionId, "turn_0"]]);
        assert.deepEqual(yield* standing(), {
          status: TASK_STATUS.CANCELED,
          finished: true,
        });
        assert.equal(
          Option.getOrThrow(yield* readAgent(owner, agent.id)).archivedAt,
          null,
          "the agent is stopped, not archived",
        );

        assert.equal(yield* marked({ archived: false }), HOSTED_HTTP_STATUS.OK);
        assert.deepEqual(yield* standing(), {
          status: TASK_STATUS.IN_PROGRESS,
          finished: false,
        });

        yield* recordAgentPublished(owner, agent.id, {
          number: 7,
          title: "Invite teammates",
          url: "https://github.com/acme/relay/pull/7",
          state: PULL_REQUEST_STATE.MERGED,
          checks: CHECK_SUMMARY.PASSING,
          additions: 1,
          deletions: 0,
          changedFiles: 1,
          mergedAt: Date.parse("2026-10-20T12:00:00.000Z"),
        });
        assert.equal(yield* marked({ archived: true }), HOSTED_HTTP_STATUS.OK);
        assert.equal((yield* standing()).status, TASK_STATUS.DONE);
        // A status named beside the archive is the one written.
        assert.equal(
          yield* marked({ archived: true, status: TASK_STATUS.BACKLOG }),
          HOSTED_HTTP_STATUS.OK,
        );
        assert.equal((yield* standing()).status, TASK_STATUS.BACKLOG);
        assert.equal(
          (yield* ask(messageAs(owner, agent.id, { text: "Carry on.", clientKey: randomUUID() })))
            .status,
          HOSTED_HTTP_STATUS.ACCEPTED,
          "the plan stands, so a message still reaches its agent",
        );
      }),
  );

  it.effect(
    "a plan's archive is refused as not ready while one of its agents holds a message awaiting its turn, which no Stop can name yet, before any Stop is sent, and leaves the plan and the agent standing",
    () =>
      Effect.gen(function* () {
        const { owner, task, agent, ask, sent, eve } = yield* startedAgent(fakeEve(), {
          running: true,
        });
        yield* sent("Rename the subject line too.");

        assert.deepEqual(
          yield* ask(request(TASK(task.id), owner, { method: "PATCH", body: { archived: true } })),
          refusal(HOSTED_HTTP_STATUS.CONFLICT, HOSTED_API_ERROR.AGENT_NOT_READY),
        );
        assert.equal(Option.getOrThrow(yield* readAgent(owner, agent.id)).archivedAt, null);
        assert.deepEqual(eve.cancelled, []);
      }),
  );

  it.effect(
    "a message the running turn took in after its second step reads as arriving after that step of the turn's journal, which closes behind it, while the line that opened the turn names no place",
    () =>
      Effect.gen(function* () {
        const { agent, ask, owner, target, writer, turnId, sent } = yield* startedAgent(fakeEve(), {
          running: true,
        });
        const turn = { conversationId: sessionKey(target.conversationId), turnId };
        /** The turn's step begun, as the relay tells the step's start. */
        const stepBegun = (step: number) =>
          writer.consume(target, {
            ...turn,
            kind: RUN_EVENT.STEP_STARTED,
            sequence: step + 2,
            step,
          });
        yield* stepBegun(1);
        yield* stepBegun(2);
        yield* sent("Rename the subject line too.");
        yield* writer.takeAwaitingLine(target, { text: "Rename the subject line too.", turnId });
        yield* stepBegun(3);
        const answer = new AssistantMessageBuilder();
        for (const _step of [1, 2, 3]) answer.stepStart();
        answer.text("Renamed it.");
        yield* writer.consume(target, {
          ...turn,
          kind: RUN_EVENT.MESSAGE_COMPLETED,
          sequence: 6,
          message: answer.finish(randomUUID()),
        });

        const page = readAnswer(
          agentMessagesAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(AGENT_MESSAGES, owner, { id: agent.id })),
        );
        const journal = page.messages.find((each) => each.role === MESSAGE_ROLE.ASSISTANT);
        assert.ok(journal);
        // The closed journal stands behind the line it took, so the order alone would draw the line ahead of the turn.
        assert.deepEqual(
          page.messages.map((each) => [each.role, each.arrivedIn]),
          [
            [MESSAGE_ROLE.USER, undefined],
            [MESSAGE_ROLE.USER, { journalId: journal.id, afterStep: 2 }],
            [MESSAGE_ROLE.ASSISTANT, undefined],
          ],
        );
      }),
  );

  it.effect(
    "a member of the plan's workspace lists, reads, and messages an agent a teammate started, named as its starter, the line landing in the starter's conversation",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { owner, other, task, agent, sessionId, ask, transcript } = yield* startedAgent(eve, {
          running: false,
        });
        const asOther = (text: string) =>
          ask(messageAs(other, agent.id, { text, clientKey: randomUUID() }));
        assert.deepEqual(
          yield* asOther("Before I joined."),
          refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );
        yield* joinWorkspace(task.workspaceId, other);

        const listed = readAnswer(
          agentListAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(TASK_AGENTS, other, { id: task.id })),
        );
        assert.deepEqual(
          listed.agents.map((each) => [each.id, each.status]),
          [[agent.id, AGENT_STATUS.COMPLETED]],
        );
        // The teammate reads whose agent it is, which the window says as "Started by".
        assert.deepEqual(
          listed.agents.map((each) => each.startedBy?.userId),
          [owner],
        );
        const read = readAnswer(
          agentMessagesAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(AGENT_MESSAGES, other, { id: agent.id })),
        );
        assert.deepEqual(userTexts(read), [SNAPSHOT]);

        const sent = readAnswer(
          agentMessageAnswerSchema,
          HOSTED_HTTP_STATUS.ACCEPTED,
          yield* asOther("Rename the subject line too."),
        );
        assert.equal(sent.agent.status, AGENT_STATUS.RUNNING);
        assert.equal(sent.agent.startedBy?.userId, owner);
        assert.deepEqual(
          eve.sent.map((each) => [each.authorization, each.sessionId]),
          [[`Bearer ${other}`, sessionId]],
        );
        assert.deepEqual(yield* transcript(), {
          lines: [SNAPSHOT, "Rename the subject line too."],
          status: AGENT_STATUS.RUNNING,
        });
      }),
  );

  it.effect(
    "a line no turn ever took reads its agent running for the line's grace and failed past it, alike on its page, in its task's list, and on its transcript",
    () =>
      Effect.gen(function* () {
        const { owner, task, agent, ask, transcript, sent } = yield* startedAgent(fakeEve(), {
          running: false,
        });
        // The session takes the line and then fails with the store's hooks, so no turn row is written for it.
        yield* TestClock.adjust(Duration.seconds(1));
        assert.equal(
          (yield* sent("Rename the subject line too.")).agent.status,
          AGENT_STATUS.RUNNING,
        );
        const statuses = () =>
          Effect.gen(function* () {
            const page = readAnswer(
              agentPageAnswerSchema,
              HOSTED_HTTP_STATUS.OK,
              yield* ask(request(AGENT, owner, { id: agent.id })),
            );
            const listed = readAnswer(
              agentListAnswerSchema,
              HOSTED_HTTP_STATUS.OK,
              yield* ask(request(TASK_AGENTS, owner, { id: task.id })),
            );
            return {
              page: page.agent.status,
              list: listed.agents.find((each) => each.id === agent.id)?.status,
              transcript: (yield* transcript()).status,
            };
          });

        yield* TestClock.adjust(CODER.LINE_GRACE);
        assert.deepEqual(yield* statuses(), {
          page: AGENT_STATUS.RUNNING,
          list: AGENT_STATUS.RUNNING,
          transcript: AGENT_STATUS.RUNNING,
        });
        yield* TestClock.adjust(Duration.millis(1));
        assert.deepEqual(yield* statuses(), {
          page: AGENT_STATUS.FAILED,
          list: AGENT_STATUS.FAILED,
          transcript: AGENT_STATUS.FAILED,
        });
      }),
  );

  it.effect(
    "the plan list a teammate reads names the member who started each of the plan's agents, by the name their account holds now",
    () =>
      Effect.gen(function* () {
        const { owner, other, task, agent, ask } = yield* startedAgent(fakeEve(), {
          running: false,
        });
        yield* joinWorkspace(task.workspaceId, other);
        yield* Database.use((db) =>
          db.update(user).set({ name: "Charles Pan" }).where(eq(user.id, owner)),
        );

        const listed = readAnswer(
          taskListAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(TASKS, other)),
        );
        assert.deepEqual(
          listed.plans
            .find((each) => each.id === task.id)
            ?.agents?.agents.map((each) => [each.id, each.startedBy]),
          [[agent.id, { userId: owner, name: "Charles Pan" }]],
        );
      }),
  );

  it.effect(
    "an agent an automation's run started names the automation on the plan's agent list and on the plan list's line, and one started by hand names none",
    () =>
      Effect.gen(function* () {
        const { owner, task, agent, ask } = yield* startedAgent(fakeEve(), { running: false });
        const automationIds = () =>
          Effect.gen(function* () {
            const agents = readAnswer(
              agentListAnswerSchema,
              HOSTED_HTTP_STATUS.OK,
              yield* ask(request(TASK_AGENTS, owner, { id: task.id })),
            );
            const tasks = readAnswer(
              taskListAnswerSchema,
              HOSTED_HTTP_STATUS.OK,
              yield* ask(request(TASKS, owner)),
            );
            const line = tasks.plans.find((each) => each.id === task.id)?.agents?.agents[0];
            return [agents.agents[0]?.automationId, line?.automationId];
          });
        assert.deepEqual(yield* automationIds(), [undefined, undefined]);

        const made = yield* createAutomation(owner, {
          organizationId: task.workspaceId,
          repositories: task.repository === null ? [] : [task.repository],
          name: "Morning Sentry triage",
          scope: AUTOMATION_SCOPE.PERSONAL,
          trigger: { kind: AUTOMATION_TRIGGER.SCHEDULE, cron: "0 9 * * 1-5", timezone: "UTC" },
          action: { kind: AUTOMATION_ACTION.AGENT, prompt: "Triage Sentry." },
          guards: AUTOMATION_DEFAULT_GUARDS,
          nextRunAt: new Date("2026-10-16T09:00:00Z"),
          webhookSecretHash: null,
        });
        const automationId = Option.getOrThrow(made).id;
        yield* Database.use((db) =>
          db.update(agentTable).set({ automationId }).where(eq(agentTable.id, agent.id)),
        );

        assert.deepEqual(yield* automationIds(), [automationId, automationId]);
      }),
  );

  it.effect(
    "an agent with no plan is messaged and read like any other, its summary naming no plan, by a member of its workspace",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { owner, task, agent, sessionId, ask } = yield* startedAgent(eve, { running: false });
        // An automation's run leaves an agent so: in its workspace, on no task.
        yield* Database.use((db) =>
          db
            .update(agentTable)
            .set({ taskId: null, organizationId: task.workspaceId })
            .where(eq(agentTable.id, agent.id)),
        );

        const sent = readAnswer(
          agentMessageAnswerSchema,
          HOSTED_HTTP_STATUS.ACCEPTED,
          yield* ask(
            messageAs(owner, agent.id, { text: "Rebase on main.", clientKey: randomUUID() }),
          ),
        );
        const read = readAnswer(
          agentMessagesAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(AGENT_MESSAGES, owner, { id: agent.id })),
        );

        assert.deepEqual([sent.agent.id, sent.agent.planId], [agent.id, null]);
        assert.deepEqual(userTexts(read), [SNAPSHOT, "Rebase on main."]);
        assert.deepEqual(
          eve.sent.map((each) => each.sessionId),
          [sessionId],
        );
      }),
  );

  it.effect(
    "an agent reads as its own page by its id, its plan named, and with no plan once an automation's run left it so, for a member of its workspace and no one else",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { owner, other, task, agent, ask } = yield* startedAgent(eve, { running: false });
        const page = () =>
          Effect.map(ask(request(AGENT, owner, { id: agent.id })), (answered) =>
            readAnswer(agentPageAnswerSchema, HOSTED_HTTP_STATUS.OK, answered),
          );

        const onTask = yield* page();
        yield* Database.use((db) =>
          db
            .update(agentTable)
            .set({ taskId: null, organizationId: task.workspaceId })
            .where(eq(agentTable.id, agent.id)),
        );
        const taskless = yield* page();
        const outside = yield* ask(request(AGENT, other, { id: agent.id }));

        assert.deepEqual(
          [onTask.agent.id, onTask.agent.planId, onTask.agent.workspaceId, onTask.agent.repository],
          [agent.id, task.id, task.workspaceId, RELAY_FULL_NAME],
        );
        assert.deepEqual(
          [taskless.agent.planId, taskless.agent.automationId, taskless.agent.workspaceId],
          [null, null, task.workspaceId],
        );
        assert.equal(taskless.agent.status, AGENT_STATUS.COMPLETED);
        assert.deepEqual(
          outside,
          refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );
      }),
  );

  it.effect(
    "an automation's agent reads as its page with the run that started it: the automation's name, the prompt alone, the pull request its event named, and who asked for a run now",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { owner, task, agent, ask } = yield* startedAgent(eve, { running: false });
        const ranAs = (firing: AutomationFiring) =>
          Effect.gen(function* () {
            yield* Database.use((db) =>
              db
                .update(agentTable)
                .set({
                  taskId: null,
                  organizationId: task.workspaceId,
                  automationOrigin: { name: "Code review", firing, prompt: "Review it." },
                })
                .where(eq(agentTable.id, agent.id)),
            );
            return readAnswer(
              agentPageAnswerSchema,
              HOSTED_HTTP_STATUS.OK,
              yield* ask(request(AGENT, owner, { id: agent.id })),
            ).agent;
          });

        const reviewed = yield* ranAs({
          kind: AUTOMATION_FIRING.GITHUB,
          event: GITHUB_TRIGGER_EVENT.PULL_REQUEST_OPENED,
          repository: RELAY_FULL_NAME,
          number: 2905,
          title: "View commands",
          url: "https://github.com/acme/relay/pull/2905",
        });
        const ranNow = yield* ranAs({ kind: AUTOMATION_FIRING.MANUAL, userId: owner });

        assert.equal(reviewed.automationName, "Code review");
        assert.deepEqual(reviewed.origin, {
          prompt: "Review it.",
          subject: {
            number: 2905,
            title: "View commands",
            url: "https://github.com/acme/relay/pull/2905",
          },
        });
        assert.equal(ranNow.origin?.runBy?.userId, owner);
        assert.equal(ranNow.origin?.subject, undefined);
      }),
  );

  it.effect(
    "the plan list names the teammate who archived an agent with no plan, as its own page does",
    () =>
      Effect.gen(function* () {
        const { owner, other, task, agent, ask } = yield* startedAgent(fakeEve(), {
          running: false,
        });
        yield* joinWorkspace(task.workspaceId, other);
        yield* Database.use((db) =>
          db
            .update(agentTable)
            .set({ taskId: null, organizationId: task.workspaceId })
            .where(eq(agentTable.id, agent.id)),
        );
        yield* ask(
          request(AGENT, other, { method: "PATCH", id: agent.id, body: { archived: true } }),
        );

        const listed = readAnswer(
          taskListAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(TASKS, owner, { archived: TASK_LIST_ARCHIVED.INCLUDE })),
        );
        const by = listed.planlessAgents?.find((each) => each.id === agent.id)?.archivedBy;
        assert.equal(by?.by, AGENT_ARCHIVER.MEMBER);
        assert.equal(by?.member?.userId, other);
        assert.ok((by?.member?.name ?? "") !== "", JSON.stringify(by));
      }),
  );

  it.effect(
    "the plan list carries an agent with no plan beside the plans, as its own page reads it and when it last moved, for a member of its workspace, an archived one only where asked for, and for no one else",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { owner, other, task, agent, ask } = yield* startedAgent(eve, { running: false });
        yield* Database.use((db) =>
          db
            .update(agentTable)
            .set({ taskId: null, organizationId: task.workspaceId })
            .where(eq(agentTable.id, agent.id)),
        );
        const listed = (bearer: string, archived?: string) =>
          Effect.map(ask(request(TASKS, bearer, { archived })), (answered) =>
            readAnswer(taskListAnswerSchema, HOSTED_HTTP_STATUS.OK, answered),
          );
        const page = readAnswer(
          agentPageAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(AGENT, owner, { id: agent.id })),
        ).agent;

        const standing = yield* listed(owner);
        const outside = yield* listed(other);
        yield* Database.use((db) =>
          db.update(agentTable).set({ archivedAt: new Date() }).where(eq(agentTable.id, agent.id)),
        );
        const archived = yield* listed(owner);
        const included = yield* listed(owner, TASK_LIST_ARCHIVED.INCLUDE);

        const [only, ...rest] = standing.planlessAgents ?? [];
        assert.ok(only !== undefined);
        const { activityAt, ...read } = only;
        assert.deepEqual([read, rest], [page, []]);
        assert.ok(activityAt >= page.createdAt);
        assert.equal(standing.plans.find((each) => each.id === task.id)?.agents, undefined);
        assert.deepEqual(outside.planlessAgents, []);
        assert.deepEqual(archived.planlessAgents, []);
        assert.deepEqual(
          included.planlessAgents?.map((each) => each.id),
          [agent.id],
        );
      }),
  );

  it.effect(
    "a member's PATCH pins an agent with no plan in their own plan list and unpins it again, and pins nothing for an account outside its workspace",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { owner, other, task, agent, ask } = yield* startedAgent(eve, { running: false });
        yield* Database.use((db) =>
          db
            .update(agentTable)
            .set({ taskId: null, organizationId: task.workspaceId })
            .where(eq(agentTable.id, agent.id)),
        );
        const pin = (bearer: string, pinned: boolean) =>
          ask(request(AGENT, bearer, { method: "PATCH", id: agent.id, body: { pinned } }));
        const pinnedAt = (bearer: string) =>
          Effect.map(
            ask(request(TASKS, bearer)),
            (answered) =>
              readAnswer(
                taskListAnswerSchema,
                HOSTED_HTTP_STATUS.OK,
                answered,
              ).planlessAgents?.find((each) => each.id === agent.id)?.pinnedAt,
          );
        const at = yield* Clock.currentTimeMillis;

        const pinned = yield* pin(owner, true);
        const refused = yield* pin(other, true);
        const held = yield* pinnedAt(owner);
        yield* pin(owner, false);
        const unpinned = yield* pinnedAt(owner);

        assert.equal(
          readAnswer(agentAnswerSchema, HOSTED_HTTP_STATUS.OK, pinned).agent.id,
          agent.id,
        );
        assert.equal(refused.status, HOSTED_HTTP_STATUS.NOT_FOUND);
        assert.equal(held, at);
        assert.equal(unpinned, undefined);
      }),
  );

  it.effect(
    "a member's PATCH drags their pin of an agent with no plan to a position the list then carries, and one given with an unpin is refused",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { owner, task, agent, ask } = yield* startedAgent(eve, { running: false });
        yield* Database.use((db) =>
          db
            .update(agentTable)
            .set({ taskId: null, organizationId: task.workspaceId })
            .where(eq(agentTable.id, agent.id)),
        );
        const patch = (body: { pinned: boolean; position: string }) =>
          ask(request(AGENT, owner, { method: "PATCH", id: agent.id, body }));
        const listed = Effect.map(ask(request(TASKS, owner)), (answered) =>
          readAnswer(taskListAnswerSchema, HOSTED_HTTP_STATUS.OK, answered).planlessAgents?.find(
            (each) => each.id === agent.id,
          ),
        );

        const placed = yield* patch({ pinned: true, position: "a1" });
        const refused = yield* patch({ pinned: false, position: "a2" });
        const held = yield* listed;

        assert.equal(placed.status, HOSTED_HTTP_STATUS.OK);
        assert.equal(refused.status, HOSTED_HTTP_STATUS.BAD_REQUEST);
        assert.equal(held?.pinPosition, "a1");
        assert.notEqual(held?.pinnedAt, undefined);
      }),
  );

  it.effect(
    "an agent's inbox reads by the agent for a member of its workspace, an agent with no plan among them, and as not found for anyone else",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { owner, other, task, agent, ask } = yield* startedAgent(eve, { running: false });
        yield* Database.use((db) =>
          db
            .update(agentTable)
            .set({ taskId: null, organizationId: task.workspaceId })
            .where(eq(agentTable.id, agent.id)),
        );
        const posted = yield* postInboxThread(
          { userId: owner, taskId: null, agentId: agent.id },
          {
            key: "which-queue",
            title: "Which queue?",
            body: "Which queue should the jobs run on?",
            ask: { type: INBOX_ASK.ANSWER },
          },
        );
        assert.ok(Result.isSuccess(posted));

        const read = readAnswer(
          inboxAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(AGENT_INBOX, owner, { id: agent.id, after: INBOX_CURSOR_START })),
        );
        const outside = yield* ask(
          request(AGENT_INBOX, other, { id: agent.id, after: INBOX_CURSOR_START }),
        );

        assert.deepEqual(
          read.items.map((item) => [item.id, item.title]),
          [[posted.success.id, "Which queue?"]],
        );
        assert.deepEqual(
          outside,
          refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );
      }),
  );

  it.effect(
    "an agent's Luke tools read for its starter, and as not found for a member who reaches the agent but not its task",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { owner, other, task, agent, ask } = yield* startedAgent(eve, { running: false });
        yield* joinWorkspace(task.workspaceId, other);
        // The task is seen on its starter's own token, which the teammate holds none of, while the agent is seen through the App.
        yield* Database.use((db) =>
          db
            .update(taskTable)
            .set({ githubAccess: GITHUB_ACCESS.TOKEN })
            .where(eq(taskTable.id, task.id)),
        );

        const read = readAnswer(
          lukeToolsAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(AGENT_LUKE_TOOLS, owner, { id: agent.id })),
        );
        const teammate = yield* ask(request(AGENT_LUKE_TOOLS, other, { id: agent.id }));

        assert.ok(read.tools.includes(AGENT_TOOL.RUN_ON_MAC));
        assert.deepEqual(
          teammate,
          refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );
      }),
  );

  it.effect(
    "a message to an agent whose plan's workspace holds no installation any more is refused, saying nothing is connected, and sends nothing",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { owner, task, agent, ask } = yield* startedAgent(eve, { running: true });
        yield* Database.use((db) =>
          db
            .delete(githubInstallation)
            .where(eq(githubInstallation.organizationId, task.workspaceId)),
        );

        const sent = yield* ask(
          messageAs(owner, agent.id, { text: "Rebase on main.", clientKey: randomUUID() }),
        );

        assert.deepEqual(sent, {
          status: HOSTED_HTTP_STATUS.FORBIDDEN,
          body: {
            error: HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE,
            unreached: { reason: REPOSITORY_UNREACHED.NOT_CONNECTED, repository: RELAY_FULL_NAME },
          },
        });
        assert.deepEqual(eve.sent, []);
      }),
  );

  it.effect(
    "a message while GitHub does not answer still reaches the agent, since only GitHub's definite no keeps the words from it",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        let githubDown = false;
        const { owner, ask, agent } = yield* agentStartedOn(
          yield* openTask({
            eve,
            github: (sent) =>
              githubDown && new URL(sent.url).pathname.startsWith("/app/installations/")
                ? Response.json({ message: "Service Unavailable" }, { status: 503 })
                : undefined,
          }),
          eve,
          { running: true },
        );
        githubDown = true;

        readAnswer(
          agentMessageAnswerSchema,
          HOSTED_HTTP_STATUS.ACCEPTED,
          yield* ask(
            messageAs(owner, agent.id, { text: "Rebase on main.", clientKey: randomUUID() }),
          ),
        );

        assert.equal(eve.sent.length, 1);
      }),
  );

  it.effect(
    "a member steers the running turn of an agent a teammate started: the words reach the starter's session and stand under the starter, so a repeat under the key sends nothing",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { owner, other, task, agent, target, sessionId, ask, transcript } =
          yield* startedAgent(eve, { running: true });
        yield* joinWorkspace(task.workspaceId, other);
        const clientKey = randomUUID();
        const steer = () =>
          ask(messageAs(other, agent.id, { text: "Use seven days, not five.", clientKey }));

        const first = readAnswer(
          agentMessageAnswerSchema,
          HOSTED_HTTP_STATUS.ACCEPTED,
          yield* steer(),
        );
        // The send that wrote the line answers the transaction that wrote it.
        assert.match(first.txid ?? "", /^\d+$/u);
        assert.deepEqual(
          eve.sent.map((each) => [each.authorization, each.sessionId, each.message.conversationId]),
          [[`Bearer ${other}`, sessionId, target.conversationId]],
        );
        assert.equal(
          yield* sentLineStands(owner, target.conversationId, sentLineId(clientKey)),
          true,
        );
        assert.deepEqual(yield* transcript(), {
          lines: [SNAPSHOT, "Use seven days, not five."],
          status: AGENT_STATUS.RUNNING,
        });

        const again = readAnswer(
          agentMessageAnswerSchema,
          HOSTED_HTTP_STATUS.ACCEPTED,
          yield* steer(),
        );
        // A repeat wrote nothing, so there is no transaction to wait for.
        assert.equal(again.txid, undefined);
        assert.equal(eve.sent.length, 1);
      }),
  );

  it.effect(
    "each member's line to an agent names them as its sender and when it was sent, by the name their account holds now, a line from before senders were kept names nobody, and a member whose account is gone reads as a former member",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { owner, other, task, agent, ask, sent, writer, target } = yield* startedAgent(eve, {
          running: true,
        });
        yield* joinWorkspace(task.workspaceId, other);
        yield* Database.use((db) =>
          db.update(user).set({ name: "Dean Stratakos" }).where(eq(user.id, owner)),
        );
        yield* Database.use((db) =>
          db.update(user).set({ name: "Charles Pan" }).where(eq(user.id, other)),
        );
        // A line from before senders were kept, standing after the Start's own.
        yield* transcriptRow(target, 2, MESSAGE_ROLE.USER, [text("Sweep the flaky tests.")]);
        yield* sent("Use seven days.");
        // Charles answers a minute later, which the time each line names says.
        yield* TestClock.adjust(Duration.minutes(1));
        readAnswer(
          agentMessageAnswerSchema,
          HOSTED_HTTP_STATUS.ACCEPTED,
          yield* ask(messageAs(other, agent.id, { text: "Not five.", clientKey: randomUUID() })),
        );
        // Luke's line from a call, an automation's run's, and another coding agent's, written as their sends write them.
        for (const [text, sender] of [
          ["Rebase on main.", { kind: MESSAGE_SENDER.LUKE }],
          ["Triage the failures.", { kind: MESSAGE_SENDER.AUTOMATION, name: "Nightly triage" }],
          [
            "Take the split view.",
            {
              kind: MESSAGE_SENDER.AGENT,
              agentId: agent.id,
              name: "Add PR overview tab",
              model: agent.model,
            },
          ],
        ] as const) {
          yield* writer.writeAwaitingLine(
            target,
            { text, clientKey: randomUUID(), sender },
            Effect.succeed(true),
          );
        }
        /** Each of the developer's lines as a member reads the page, beside what sent it. */
        const sendersAs = (reader: string) =>
          Effect.map(ask(request(AGENT_MESSAGES, reader, { id: agent.id })), (answered) =>
            readAnswer(agentMessagesAnswerSchema, HOSTED_HTTP_STATUS.OK, answered)
              .messages.filter((message) => message.role === MESSAGE_ROLE.USER)
              .map((message) => [userTexts({ messages: [message] })[0], message.sentBy]),
          );

        const named = [
          // The task the Start wrote names its starter.
          [SNAPSHOT, { userId: owner, name: "Dean Stratakos", kind: AGENT_SENDER.MEMBER }],
          // A line from before senders were kept names nobody.
          ["Sweep the flaky tests.", undefined],
          ["Use seven days.", { userId: owner, name: "Dean Stratakos", kind: AGENT_SENDER.MEMBER }],
          ["Not five.", { userId: other, name: "Charles Pan", kind: AGENT_SENDER.MEMBER }],
          // Luke and an automation are named by kind, so the window draws each as itself.
          ["Rebase on main.", { name: "Luke", kind: AGENT_SENDER.LUKE }],
          ["Triage the failures.", { name: "Nightly triage", kind: AGENT_SENDER.AUTOMATION }],
          // Another agent is marked as one beside its name, its model, and itself, with no kind an older window would refuse.
          [
            "Take the split view.",
            { name: "Add PR overview tab", agent: true, model: agent.model, agentId: agent.id },
          ],
        ];
        assert.deepEqual(yield* sendersAs(owner), named);
        assert.deepEqual(yield* sendersAs(other), named);

        // Every line names when it was sent, a minute apart where they were.
        const sentAts = readAnswer(
          agentMessagesAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(AGENT_MESSAGES, owner, { id: agent.id })),
        )
          .messages.filter((message) => message.role === MESSAGE_ROLE.USER)
          .map((message) => message.sentAt);
        assert.ok(sentAts.every((at) => at !== undefined));
        assert.equal((sentAts[3] ?? 0) - (sentAts[2] ?? 0), Duration.toMillis(Duration.minutes(1)));

        yield* Database.use((db) => db.delete(user).where(eq(user.id, other)));
        assert.deepEqual((yield* sendersAs(owner))[3], [
          "Not five.",
          { name: "Former member", kind: AGENT_SENDER.FORMER },
        ]);
      }),
  );

  it.effect(
    "a message while a turn runs reaches eve under the developer's bearer with no policy of its own, shows in the transcript at once as the developer's line, and leaves the agent running",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { owner, sessionId, sent, transcript } = yield* startedAgent(eve, {
          running: true,
        });
        const answered = yield* sent("  Use the helper.  ");
        assert.equal(answered.agent.status, AGENT_STATUS.RUNNING);
        assert.deepEqual(
          eve.sent.map((each) => [each.authorization, each.sessionId, each.message]),
          [
            [
              `Bearer ${owner}`,
              sessionId,
              {
                conversationId: eve.opened[0]?.message.conversationId,
                turn: EVE_HOST_TURN.TYPED,
                message: "Use the helper.",
              },
            ],
          ],
        );
        assert.deepEqual(yield* transcript(), {
          lines: [SNAPSHOT, "Use the helper."],
          status: AGENT_STATUS.RUNNING,
        });
      }),
  );

  it.effect(
    "a message mentioning a section of the agent's plan hands eve the section as it stands beside the words, and the line reads as the words alone",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { task, transcript, sent } = yield* startedAgent(eve, { running: true });
        const words = `Do what ${mentionMarkdown({ kind: MENTION_KIND.SECTION, taskId: task.id, anchor: "goal" }, "Goal", { workspace: "acme", repository: task.repository })} says.`;

        yield* sent(words);

        assert.deepEqual(eve.sent.at(-1)?.message.message, [
          { type: "text", text: words },
          {
            type: "text",
            text: `${MENTIONED_HEADING}\n\nThe plan's section "Goal":\n\n## Goal\n\nInvite a teammate by email.`,
          },
        ]);
        assert.deepEqual((yield* transcript()).lines, [SNAPSHOT, words]);
      }),
  );

  it.effect(
    "a message mentioning a page and another agent of the plan hands eve the page by its id and version with how to read it, never its HTML, and the agent by its id and branch, never its conversation",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { owner, task, ask, sent } = yield* startedAgent(eve, { running: true });
        const other = yield* startedAgentOf(owner, task.id, ask);
        yield* updateAgentBranch(owner, other.agent.id, "luke/store-invitations");
        const shown = yield* writePage(
          owner,
          taskPageOwner(task.id),
          {
            title: "Invites by week",
            html: "<h1>Invites by week</h1>",
          },
          { kind: PAGE_SHOWER.LUKE },
        );
        assert.ok(Option.isSome(shown));
        const place = { workspace: "acme", repository: task.repository };
        const words = `Build what ${mentionMarkdown({ kind: MENTION_KIND.PAGE, taskId: task.id, pageId: shown.value.id }, "Invites by week", place)} shows on ${mentionMarkdown({ kind: MENTION_KIND.AGENT, agentId: other.agent.id }, "Store", place)}.`;

        yield* sent(words);

        const message = eve.sent.at(-1)?.message.message;
        assert.ok(Array.isArray(message));
        const [said, part] = message;
        assert.deepEqual(said, { type: "text", text: words });
        assert.ok(part?.type === "text");
        assert.ok(part.text.startsWith(MENTIONED_HEADING), part.text);
        assert.match(
          part.text,
          new RegExp(
            `the page "Invites by week" \\(id \`${shown.value.id}\`, version 1\\)[^]*with \`read_page\`, \`pageId: "${shown.value.id}"\`, and \`version: 1\``,
            "u",
          ),
        );
        assert.ok(!part.text.includes("<h1>Invites by week</h1>"), part.text);
        assert.match(
          part.text,
          new RegExp(
            `\\(id \`${other.agent.id}\`\\) working in \`${RELAY_FULL_NAME}\` on the branch \`luke/store-invitations\``,
            "u",
          ),
        );
        assert.match(part.text, /git fetch origin luke\/store-invitations/u);
      }),
  );

  it.effect(
    "a message mentioning agents on another task and on none of the workspace hands each by its task with how to message it, and one of another workspace the sender is also in as not found",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { owner, other, task, ask, sent } = yield* startedAgent(eve, { running: true });
        const billing = yield* startTask(owner, { name: "Billing", repository: RELAY_FULL_NAME });
        const onBilling = yield* startedAgentOf(owner, billing.id, ask);
        const oneOff = yield* startedAgentOf(owner, task.id, ask);
        const foreign = yield* startedAgentOf(owner, task.id, ask);
        // The sender is a member of a second workspace, which holds the foreign agent.
        const elsewhere = yield* openWorkspace(other);
        yield* joinWorkspace(elsewhere, owner);
        const moved = (agentId: string, organizationId: string) =>
          Database.use((db) =>
            db
              .update(agentTable)
              .set({ taskId: null, organizationId })
              .where(eq(agentTable.id, agentId)),
          );
        yield* moved(oneOff.agent.id, task.workspaceId);
        yield* moved(foreign.agent.id, elsewhere);
        const place = { workspace: "acme", repository: task.repository };
        const mention = (agentId: string, name: string) =>
          mentionMarkdown({ kind: MENTION_KIND.AGENT, agentId }, name, place);
        const words = `Line up with ${mention(onBilling.agent.id, "Billing agent")}, ${mention(oneOff.agent.id, "Sweeper")} and ${mention(foreign.agent.id, "Stranger")}.`;

        yield* sent(words);

        const message = eve.sent.at(-1)?.message.message;
        assert.ok(Array.isArray(message));
        const part = message[1];
        assert.ok(part?.type === "text");
        assert.match(
          part.text,
          new RegExp(
            `another agent of your workspace on the task "Billing", "[^"]+" \\(id \`${onBilling.agent.id}\`\\)`,
            "u",
          ),
        );
        assert.match(
          part.text,
          new RegExp(`on no task, "[^"]+" \\(id \`${oneOff.agent.id}\`\\)`, "u"),
        );
        assert.equal(part.text.match(/To message it, call `message_agent`/gu)?.length, 2);
        assert.match(part.text, /The agent "Stranger": not found in your workspace\./u);
        assert.ok(!part.text.includes(`id \`${foreign.agent.id}\``), part.text);
      }),
  );

  it.effect(
    "a message mentioning people hands a member of the agent's workspace by their role, never their email, and someone of another workspace the sender is also in as not a member",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { owner, other, task, sent } = yield* startedAgent(eve, { running: true });
        // The sender and the other account share a second workspace, which is not the agent's.
        const elsewhere = yield* openWorkspace(other);
        yield* joinWorkspace(elsewhere, owner);
        const place = { workspace: "acme", repository: task.repository };
        const mention = (userId: string, name: string) =>
          mentionMarkdown({ kind: MENTION_KIND.PERSON, userId }, name, place);
        const words = `Ask ${mention(owner, "Me")} and ${mention(other, "Stranger")}.`;

        yield* sent(words);

        const message = eve.sent.at(-1)?.message.message;
        assert.ok(Array.isArray(message));
        const part = message[1];
        assert.ok(part?.type === "text");
        assert.match(
          part.text,
          /The developer pointed you at [^\n]+, an owner of your workspace\./u,
        );
        assert.ok(!part.text.includes("@"), part.text);
        assert.match(part.text, /The person "Stranger": not a member of your workspace\./u);
      }),
  );

  it.effect(
    "a message mentioning an MCP server that eve does not take leaves no server for a later turn",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve({ sends: EVE_SEND_OUTCOME.NOT_READY });
        const { owner, agent, ask, target } = yield* startedAgent(eve, { running: true });
        const words = `Check ${mentionMarkdown({ kind: MENTION_KIND.SERVER, provider: INTEGRATION_PROVIDER.LINEAR }, "Linear", { workspace: "acme", repository: null })} first.`;

        const answered = yield* ask(
          messageAs(owner, agent.id, { text: words, clientKey: randomUUID() }),
        );

        assert.notEqual(answered.status, HOSTED_HTTP_STATUS.ACCEPTED);
        assert.deepEqual(
          yield* takeAgentMentionedServers(target.userId, target.conversationId),
          [],
        );
      }),
  );

  it.effect(
    "an agent started on a prompt mentioning a switched-off MCP server leaves the server for its first turn to take, its switch left off",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const opened = yield* openTask({ eve });
        const task = `Triage ${mentionMarkdown({ kind: MENTION_KIND.SERVER, provider: INTEGRATION_PROVIDER.LINEAR }, "Linear", { workspace: "acme", repository: null })} first.`;

        const agent = readAnswer(
          agentAnswerSchema,
          HOSTED_HTTP_STATUS.CREATED,
          yield* opened.ask(
            startAs(opened.owner, opened.task.id, {
              idempotencyKey: randomUUID(),
              task,
              disabledServers: [INTEGRATION_PROVIDER.LINEAR],
            }),
          ),
        ).agent;

        const stored = yield* readAgent(opened.owner, agent.id);
        assert.ok(Option.isSome(stored));
        assert.deepEqual(stored.value.disabledServers, [INTEGRATION_PROVIDER.LINEAR]);
        assert.deepEqual(
          yield* takeAgentMentionedServers(opened.owner, stored.value.conversationId),
          [INTEGRATION_PROVIDER.LINEAR],
        );
      }),
  );

  it.effect(
    "a message mentioning an MCP server hands eve a note naming its connection beside the words, and the server is left for the agent's next turn to take",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { target, sent } = yield* startedAgent(eve, { running: true });
        const words = `Check ${mentionMarkdown({ kind: MENTION_KIND.SERVER, provider: INTEGRATION_PROVIDER.LINEAR }, "Linear", { workspace: "acme", repository: null })} first.`;

        yield* sent(words);

        const handed = eve.sent.at(-1)?.message.message;
        assert.ok(Array.isArray(handed), "eve was handed parts");
        assert.deepEqual(handed[0], { type: "text", text: words });
        assert.match(
          JSON.stringify(handed[1]),
          /pointed you at the Linear MCP server \(connection `linear`\)/u,
        );
        assert.deepEqual(yield* takeAgentMentionedServers(target.userId, target.conversationId), [
          INTEGRATION_PROVIDER.LINEAR,
        ]);
      }),
  );

  it.effect(
    "a message is the owner's alone and bounded: another account and no bearer are refused by name, as are words past the bound, no words, and a key missing or past its bound, and eve hears none of them",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { owner, other, agent, ask, transcript } = yield* startedAgent(eve, {
          running: true,
        });
        const line = { text: "Rename the helper.", clientKey: randomUUID() };
        assert.deepEqual(
          yield* ask(messageAs(other, agent.id, line)),
          refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );
        assert.deepEqual(
          yield* ask(messageAs(undefined, agent.id, line)),
          refusal(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN),
        );
        assert.deepEqual(
          yield* ask(
            messageAs(owner, agent.id, {
              ...line,
              text: "x".repeat(AGENT_BOUNDS.MAX_MESSAGE_CHARS + 1),
            }),
          ),
          refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.MESSAGE_TOO_LONG),
        );
        const invalid = refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
        assert.deepEqual(yield* ask(messageAs(owner, agent.id, { ...line, text: "   " })), invalid);
        assert.deepEqual(yield* ask(messageAs(owner, agent.id, { text: "Hi" })), invalid);
        assert.deepEqual(
          yield* ask(messageAs(owner, agent.id, { ...line, delivery: "queue" })),
          invalid,
        );
        assert.deepEqual(
          yield* ask(
            messageAs(owner, agent.id, {
              ...line,
              clientKey: "k".repeat(AGENT_BOUNDS.MAX_KEY_CHARS + 1),
            }),
          ),
          invalid,
        );
        assert.deepEqual(eve.sent, []);
        assert.deepEqual((yield* transcript()).lines, [SNAPSHOT]);
        // The bounds themselves are taken.
        readAnswer(
          agentMessageAnswerSchema,
          HOSTED_HTTP_STATUS.ACCEPTED,
          yield* ask(
            messageAs(owner, agent.id, {
              text: "y".repeat(AGENT_BOUNDS.MAX_MESSAGE_CHARS),
              clientKey: "k".repeat(AGENT_BOUNDS.MAX_KEY_CHARS),
            }),
          ),
        );
        assert.equal(eve.sent.length, 1);
      }),
  );
});
