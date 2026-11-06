import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { writeAccountPreferences } from "@repo/database/models/account-store";
import { type Agent, type AgentBriefText, createAgent } from "@repo/database/models/agent-store";
import {
  keepDescriptionAttachment,
  DESCRIPTION_ATTACHMENT_KEEP,
} from "@repo/database/models/description-attachments";
import {
  readDescriptionCommentThreads,
  startDescriptionCommentThread,
} from "@repo/database/models/description-comments";
import {
  createTask,
  readTask,
  saveDescriptionText,
  updateTask,
} from "@repo/database/models/task-store";
import { CONVERSATION_RUNTIME } from "@repo/database/storage-vocabulary";
import { getTestDB, joinWorkspace, openWorkspace, startTask } from "@repo/database/testing";
import { AGENT_PAYER } from "@repo/features/agent-wire";
import { PICTURE_TYPE } from "@repo/features/picture-wire";
import { descriptionAttachmentAddress } from "@repo/features/description-attachment-link";
import {
  DESCRIPTION_COMMENT_ACTOR,
  DESCRIPTION_COMMENT_SCOPE,
  DESCRIPTION_COMMENT_STATUS,
} from "@repo/features/description-comment-wire";
import { descriptionSections } from "@repo/features/description-document";
import { EXPERIMENT } from "@repo/settings";
import { Clock, Effect, Option } from "effect";
import { ACTION_RESULT_STATUS, unparsedWire } from "../../core.js";
import { COMMENT_TOOL_REFUSAL } from "../../tasks/comment-tools.js";
import {
  PICTURE_LOOK_REFUSAL,
  PICTURE_LOOK_STATUS,
  pictureNotLooked,
} from "../../tasks/picture-look.js";
import { githubReaching, openGithubUser } from "../../testing/github-app-fake.js";
import type { AdmittedConversation } from "../eve-host/conversation.js";
import {
  runAgentComment,
  runAgentEditDescription,
  runAgentLookAtPicture,
  runAgentOpenPullRequest,
} from "./agent-doors.js";
import { CODER_REFUSAL } from "./bounds.js";
import type { InboxSandboxDoor } from "./inbox-image.js";
import { DESCRIPTION_EDIT_REFUSAL } from "./description-edit.js";
import { CODER_TOOL } from "./tool-set.js";

/**
 * agent-doors.test.ts -- the doors a coding agent's description, picture, comment, and pull request tools run through, as its harness's MCP server calls them.
 *
 * Each call runs as the agent's conversation, admitted as the MCP door
 * admits a runner's bearer, over the real migrations on PGlite: notes are
 * taken into the description of a task of the agent's workspace together or not at
 * all, named by its id, and refused for no task or one of another
 * workspace; a picture of another workspace's description is not looked at; a
 * comment is written under the agent on a task of its workspace, and
 * refused elsewhere; and an agent in no repository opens no pull request.
 * Synthetic accounts, tasks, and words throughout.
 */

/** A sandbox door no call of notes alone opens: one that fails if it is. */
const noSandbox: InboxSandboxDoor = () => Promise.reject(new Error("the sandbox was opened"));

const DESCRIPTION_TEXT = "# Teammate invitations\n\n## Goal\n\nInvite a teammate by email.\n";

/** The agent's conversation as the MCP door admits it: the agent's starter, on its own conversation. */
function admittedOf(agent: Agent): AdmittedConversation {
  return {
    caller: agent.userId,
    target: { userId: agent.userId, conversationId: agent.conversationId },
    runtimeSessionId: undefined,
    timeZone: undefined,
  };
}

/** What every agent here starts on: Claude Code, on its starter's Claude plan. */
const ON_CLAUDE_CODE = {
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
  payer: AGENT_PAYER.CLAUDE_SUBSCRIPTION,
} as const;

/** The member's Descriptions turned on or off, which their agents' description tools stand on. */
const descriptionsFor = (userId: string, on: boolean) =>
  writeAccountPreferences(userId, { experiments: { [EXPERIMENT.DESCRIPTIONS]: on } });

/** An agent of the member's on the task named, with the brief given, its member's Descriptions on. */
const agentOn = (
  userId: string,
  taskId: string,
  brief: AgentBriefText = { descriptionSnapshot: DESCRIPTION_TEXT, prompt: null },
) =>
  Effect.map(
    Effect.andThen(
      descriptionsFor(userId, true),
      createAgent(userId, {
        ...ON_CLAUDE_CODE,
        ...brief,
        taskId,
        repository: "acme/relay",
        idempotencyKey: randomUUID(),
      }),
    ),
    (started) => Option.getOrThrow(started).agent,
  );

/** An agent of the member's in the workspace on no task and no repository, handed the prompt given, its member's Descriptions on. */
const tasklessAgentOn = (userId: string, workspaceId: string) =>
  Effect.map(
    Effect.andThen(
      descriptionsFor(userId, true),
      createAgent(userId, {
        ...ON_CLAUDE_CODE,
        taskId: null,
        organizationId: workspaceId,
        descriptionSnapshot: null,
        prompt: "Answer the open comments.",
        repository: null,
        idempotencyKey: randomUUID(),
      }),
    ),
    (started) => Option.getOrThrow(started).agent,
  );

/** An account with one agent on a task of its workspace, with the brief given. */
const openAgent = (brief?: AgentBriefText) =>
  Effect.gen(function* () {
    const userId = yield* openGithubUser();
    const task = yield* startTask(userId, {
      name: "Teammate invitations",
      repository: "acme/relay",
    });
    const agent = yield* agentOn(userId, task.id, brief);
    return { userId, agent, admitted: admittedOf(agent) };
  });

/** A thread the member started on the task's description, over words of its own. */
const openThread = (userId: string, taskId: string) =>
  Effect.gen(function* () {
    yield* saveDescriptionText(userId, taskId, DESCRIPTION_TEXT);
    const quote = "Invite a teammate";
    const from = DESCRIPTION_TEXT.indexOf(quote);
    const started = yield* startDescriptionCommentThread(
      { actor: DESCRIPTION_COMMENT_ACTOR.MEMBER, userId },
      taskId,
      {
        clientKey: randomUUID(),
        scope: DESCRIPTION_COMMENT_SCOPE.WORDS,
        quote,
        anchor: { from, to: from + quote.length },
        text: DESCRIPTION_TEXT,
        words: "By link too?",
      },
    );
    assert.ok("answer" in started && "thread" in started.answer);
    return started.answer.thread.id;
  });

it.layer(getTestDB())("a coding agent's tool doors", (it) => {
  it.effect(
    "an agent handed a prompt on a task takes notes on its description, as New task starts every agent",
    () =>
      Effect.gen(function* () {
        const brief = { descriptionSnapshot: null, prompt: "Let invites expire." } as const;
        const { userId, agent, admitted } = yield* openAgent(brief);
        assert.ok(agent.taskId !== null);
        const note = { kind: "add", section: "Approach", text: "- Invites expire after 7 days." };

        const answer = yield* runAgentEditDescription(
          admitted,
          unparsedWire({ taskId: agent.taskId, notes: [note] }),
          0,
          noSandbox,
        );

        assert.deepEqual(answer, { status: ACTION_RESULT_STATUS.ACCEPTED, taken: 1 });
        const stored = Option.getOrThrow(yield* readTask(userId, agent.taskId));
        assert.deepEqual(
          stored.agentEdits.map((edit) => edit.agentId),
          [agent.id],
        );
        assert.ok(stored.text.includes("- Invites expire after 7 days."));
      }),
  );

  it.effect(
    "an agent's notes are taken into its description together or not at all, a miss answering the description as it stands to retry from, and read back in the description",
    () =>
      Effect.gen(function* () {
        const { userId, agent, admitted } = yield* openAgent();
        assert.ok(agent.taskId !== null);
        const before = Option.getOrThrow(yield* readTask(userId, agent.taskId));
        const notes = [
          {
            kind: "add",
            section: "Open questions",
            text: "- Who may withdraw an invite? Going on as: the member who sent it.",
          },
          { kind: "add", section: "Approach", text: "- Invites expire after 7 days." },
        ];

        const missed = yield* runAgentEditDescription(
          admitted,
          unparsedWire({
            taskId: agent.taskId,
            notes: [
              ...notes,
              { kind: "replace", find: "a phrase the description never held", text: "x" },
            ],
          }),
          0,
          noSandbox,
        );

        assert.deepEqual(missed, {
          status: ACTION_RESULT_STATUS.REJECTED,
          reason: DESCRIPTION_EDIT_REFUSAL.CONFLICT,
          missed: "replace a phrase the description never held",
          current: before.text,
        });
        const untouched = Option.getOrThrow(yield* readTask(userId, agent.taskId));
        assert.equal(untouched.text, before.text);
        assert.deepEqual(untouched.agentEdits, []);

        const answer = yield* runAgentEditDescription(
          admitted,
          unparsedWire({ taskId: agent.taskId, notes }),
          0,
          noSandbox,
        );

        assert.deepEqual(answer, { status: ACTION_RESULT_STATUS.ACCEPTED, taken: 2 });
        const stored = Option.getOrThrow(yield* readTask(userId, agent.taskId));
        const sectionText = (heading: string) =>
          descriptionSections(stored.text).find((section) => section.heading === heading)?.text ??
          "";
        assert.ok(
          sectionText("Open questions").endsWith(
            "\n\n- Who may withdraw an invite? Going on as: the member who sent it.",
          ),
        );
        assert.ok(sectionText("Approach").endsWith("\n\n- Invites expire after 7 days."));
        assert.equal(stored.task.document.body, stored.text);
        // The save is journaled as the agent's, with the notes that were taken and the agent named as its tab names it.
        const at = yield* Clock.currentTimeMillis;
        assert.deepEqual(stored.task.agentEdits, [
          { agentId: agent.id, label: agent.title ?? "Opus 5.5", at },
        ]);
        assert.deepEqual(
          stored.agentEdits.map((edit) => edit.notes.map((note) => note.kind)),
          [["add", "add"]],
        );
      }),
  );

  it.effect(
    "an agent takes notes on another task of its workspace by its id, the description naming the agent as its tab names it even once the task moves to another workspace",
    () =>
      Effect.gen(function* () {
        const { userId, agent, admitted } = yield* openAgent();
        const sibling = yield* startTask(userId, { name: "Seat billing" });
        const note = { kind: "add", section: "Approach", text: "- Bill by seat." };

        const answer = yield* runAgentEditDescription(
          admitted,
          unparsedWire({ taskId: sibling.id, notes: [note] }),
          0,
          noSandbox,
        );
        yield* updateTask(userId, sibling.id, { organizationId: yield* openWorkspace(userId) });

        assert.deepEqual(answer, { status: ACTION_RESULT_STATUS.ACCEPTED, taken: 1 });
        const stored = Option.getOrThrow(yield* readTask(userId, sibling.id));
        assert.ok(stored.text.includes("- Bill by seat."));
        assert.deepEqual(
          stored.task.agentEdits?.map((edit) => edit.label),
          [agent.title ?? "Opus 5.5"],
        );
      }),
  );

  it.effect(
    "an agent's notes naming no task, or a task of another workspace its member is also in, or made once its member turned Descriptions off, are refused and save nothing, as is its look at a description's picture",
    () =>
      Effect.gen(function* () {
        const { userId, admitted } = yield* openAgent();
        const elsewhere = yield* openWorkspace(userId);
        const other = yield* createTask(userId, {
          name: "Side project",
          organizationId: elsewhere,
        });
        const before = Option.getOrThrow(yield* readTask(userId, other.id));
        const notes = [{ kind: "add", section: "Approach", text: "- Ship it." }];

        const unnamed = yield* runAgentEditDescription(
          admitted,
          unparsedWire({ notes }),
          0,
          noSandbox,
        );
        const outside = yield* runAgentEditDescription(
          admitted,
          unparsedWire({ taskId: other.id, notes }),
          0,
          noSandbox,
        );

        assert.deepEqual(unnamed, {
          status: ACTION_RESULT_STATUS.REJECTED,
          reason: DESCRIPTION_EDIT_REFUSAL.NO_TASK_NAMED,
        });
        assert.deepEqual(outside, {
          status: ACTION_RESULT_STATUS.REJECTED,
          reason: DESCRIPTION_EDIT_REFUSAL.NO_TASK,
        });
        const after = Option.getOrThrow(yield* readTask(userId, other.id));
        assert.equal(after.text, before.text);

        // Note that a harness may call a tool it was not listed, so the door refuses it on its own.
        yield* descriptionsFor(userId, false);
        const off = yield* runAgentEditDescription(
          admitted,
          unparsedWire({ taskId: other.id, notes }),
          0,
          noSandbox,
        );
        const looked = yield* runAgentLookAtPicture(
          admitted,
          unparsedWire({ taskId: other.id, attachmentId: randomUUID() }),
        );
        assert.deepEqual(off, {
          status: ACTION_RESULT_STATUS.REJECTED,
          reason: DESCRIPTION_EDIT_REFUSAL.OFF,
        });
        assert.deepEqual(looked, pictureNotLooked(PICTURE_LOOK_REFUSAL.OFF));
      }),
  );

  it.effect(
    "an agent looks at a picture of another task's description of its workspace, and one of a task of another workspace its member is also in is refused",
    () =>
      Effect.gen(function* () {
        const { userId, admitted } = yield* openAgent();
        const sibling = yield* startTask(userId, { name: "Seat billing" });
        const elsewhere = yield* createTask(userId, {
          name: "Side project",
          organizationId: yield* openWorkspace(userId),
        });
        const picture = {
          contentType: PICTURE_TYPE.PNG,
          bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 4, 2]),
        };
        const look = (taskId: string) =>
          Effect.gen(function* () {
            const kept = yield* keepDescriptionAttachment(userId, taskId, picture);
            assert.equal(kept.status, DESCRIPTION_ATTACHMENT_KEEP.KEPT);
            if (kept.status !== DESCRIPTION_ATTACHMENT_KEEP.KEPT) return assert.fail("no picture");
            const address = descriptionAttachmentAddress({ taskId, attachmentId: kept.id }, "acme");
            return yield* runAgentLookAtPicture(admitted, unparsedWire({ address }));
          });

        const onSibling = yield* look(sibling.id);
        const outside = yield* look(elsewhere.id);

        assert.equal(onSibling.status, PICTURE_LOOK_STATUS.LOOKED);
        assert.deepEqual(outside, pictureNotLooked(PICTURE_LOOK_REFUSAL.ELSEWHERE));
      }),
  );

  it.effect(
    "an agent reads, replies to, resolves, and reopens a thread on another task of its workspace by its id, written as the member under the agent",
    () =>
      Effect.gen(function* () {
        const { userId, agent, admitted } = yield* openAgent();
        const sibling = yield* startTask(userId, { name: "Seat billing" });
        const thread = yield* openThread(userId, sibling.id);
        const call = (
          name: Parameters<typeof runAgentComment>[1],
          input: Readonly<Record<string, string | boolean>>,
        ) => runAgentComment(admitted, name, unparsedWire({ taskId: sibling.id, ...input }));

        const read = yield* call(CODER_TOOL.READ_COMMENTS, {});
        const replied = yield* call(CODER_TOOL.REPLY_TO_COMMENT, { thread, words: "Link too." });
        const resolved = yield* call(CODER_TOOL.UPDATE_COMMENT, { thread, resolved: true });
        const reopened = yield* call(CODER_TOOL.UPDATE_COMMENT, { thread, resolved: false });

        assert.deepEqual(
          [read, replied, resolved, reopened].map((answer) => answer.status),
          Array(4).fill(ACTION_RESULT_STATUS.ACCEPTED),
        );
        const [stored] = Option.getOrThrow(
          yield* readDescriptionCommentThreads(userId, sibling.id),
        );
        assert.equal(stored?.status, DESCRIPTION_COMMENT_STATUS.OPEN);
        assert.deepEqual(
          stored?.entries
            .filter((entry) => entry.words === "Link too.")
            .map((entry) => entry.writer),
          [{ actor: DESCRIPTION_COMMENT_ACTOR.AGENT, agentId: agent.id }],
        );
      }),
  );

  it.effect(
    "an agent's comment call naming no task or a task of another workspace is refused and changes no thread, and it reads a teammate's task's comments",
    () =>
      Effect.gen(function* () {
        const userId = yield* openGithubUser();
        const teammate = yield* openGithubUser();
        const own = yield* startTask(userId, { name: "Seat billing" });
        yield* joinWorkspace(own.workspaceId, teammate);
        const theirs = yield* createTask(teammate, {
          name: "Teammate's invites",
          organizationId: own.workspaceId,
        });
        const elsewhere = yield* createTask(userId, {
          name: "Side project",
          organizationId: yield* openWorkspace(userId),
        });
        const thread = yield* openThread(teammate, theirs.id);
        const outsideThread = yield* openThread(userId, elsewhere.id);
        const agent = yield* tasklessAgentOn(userId, own.workspaceId);
        const admitted = admittedOf(agent);
        const reply = (input: Readonly<Record<string, string>>) =>
          runAgentComment(admitted, CODER_TOOL.REPLY_TO_COMMENT, unparsedWire(input));

        const unnamed = yield* reply({ thread, words: "Done." });
        const outside = yield* reply({ taskId: elsewhere.id, thread: outsideThread, words: "x" });
        const read = yield* runAgentComment(
          admitted,
          CODER_TOOL.READ_COMMENTS,
          unparsedWire({ taskId: theirs.id }),
        );

        assert.deepEqual(unnamed, {
          status: ACTION_RESULT_STATUS.REJECTED,
          reason: COMMENT_TOOL_REFUSAL.NO_TASK_NAMED,
        });
        assert.deepEqual(outside, {
          status: ACTION_RESULT_STATUS.REJECTED,
          reason: COMMENT_TOOL_REFUSAL.NO_TASK,
        });
        assert.equal(read.status, ACTION_RESULT_STATUS.ACCEPTED);
        for (const [owner, taskId] of [
          [teammate, theirs.id],
          [userId, elsewhere.id],
        ] as const) {
          const [stored] = Option.getOrThrow(yield* readDescriptionCommentThreads(owner, taskId));
          assert.equal(stored?.entries.length, 1, taskId);
        }
      }),
  );

  it.effect(
    "an agent in no repository is refused its pull request by name, though its harness may call the tool",
    () =>
      Effect.gen(function* () {
        const userId = yield* openGithubUser();
        const workspaceId = yield* openWorkspace(userId);
        const agent = yield* tasklessAgentOn(userId, workspaceId);

        const opened = yield* runAgentOpenPullRequest(
          admittedOf(agent),
          unparsedWire({ head: "luke/x", title: "x", body: "" }),
        ).pipe(Effect.provide(githubReaching([]).layer));

        assert.deepEqual(opened, {
          status: ACTION_RESULT_STATUS.REJECTED,
          reason: CODER_REFUSAL.NO_REPOSITORY,
        });
      }),
  );
});
