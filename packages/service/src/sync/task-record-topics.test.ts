import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import {
  closeBrowserTab,
  handBackBrowserTab,
  pointBrowserTab,
  takeOverBrowserTab,
  upsertBrowserTab,
} from "@repo/database/models/agent-browser-tabs";
import { createAgent, renameAgent } from "@repo/database/models/agent-store";
import { startDescriptionCommentThread } from "@repo/database/models/description-comments";
import { recordRepositoryReads } from "@repo/database/models/github-repository-reads";
import { readGitHubTokenRow, removeGitHubToken } from "@repo/database/models/github-token-store";
import { writePage } from "@repo/database/models/task-pages";
import { user } from "@repo/database/schemas/auth";
import { CONVERSATION_RUNTIME } from "@repo/database/storage-vocabulary";
import { type SyncTopic, TOPIC } from "@repo/database/sync/notification";
import {
  expectTopicsFire,
  getTestDB,
  joinWorkspace,
  leaveWorkspace,
  openTaskAgent,
  startTask,
} from "@repo/database/testing";
import { AGENT_BROWSER_TAB_OPENER } from "@repo/features/agent-browser-tab-wire";
import { BROWSER_CURSOR_KIND } from "@repo/features/browser-agent-actions";
import { DESCRIPTION_COMMENT_ACTOR } from "@repo/features/description-comment-wire";
import { PAGE_OWNER, PAGE_SHOWER, taskPageOwner } from "@repo/features/page-wire";
import { Clock, Duration, Effect, Option } from "effect";
import { TestClock } from "effect/testing";
import { saveNotes } from "../tasks/description-notes.js";
import { openTokenMember } from "../testing/github-app-fake.js";
import { added } from "../testing/task-contents.js";
import {
  agentPagesLive,
  taskBrowserTabsLive,
  taskCommentsLive,
  taskHistoryLive,
  taskPagesLive,
  taskRecordLive,
} from "./live-queries.js";

/**
 * An open task's live reads on the migrated capture: its record, pages,
 * history, comments, and Browser tabs (`taskRecordLive` and its neighbors), and an
 * agent's own pages on no task (`agentPagesLive`). Each write that moves
 * one, through its real writer, notifies a topic the read is woken on, so a
 * window holding it hears it within a coalesce window rather than at the
 * hold's end: the description saved, a page shown on the task and a comment left
 * on it, a page an agent
 * on no task shows, an agent's tab opened, pointed at, taken over, handed
 * back, and closed, an agent renamed, and what admits the reader to the
 * task. Note that an editor renamed wakes no history, which reads the name
 * at the hold's end, so no case here writes one.
 *
 * Synthetic accounts, workspaces, tasks, pages, and tabs throughout.
 */

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });
  return id;
});

/** Runs the write, held to the topics it notifies, and fails unless one of them wakes each read, named by the topics it is woken on. */
const wakes = <A, E, R>(
  write: Effect.Effect<A, E, R>,
  topics: readonly SyncTopic[],
  reads: readonly (readonly SyncTopic[])[],
) =>
  Effect.gen(function* () {
    const fired = yield* expectTopicsFire(write, topics);
    for (const woken of reads) {
      assert.ok(
        topics.some(([kind, id]) => woken.some((topic) => topic[0] === kind && topic[1] === id)),
        "the read is woken by a topic the write notifies",
      );
    }
    return fired;
  });

it.layer(getTestDB())("what moves an open task's record notifies", (it) => {
  it.effect(
    "the description's notes saved, a page shown on the task, and a comment left on it notify the task, which wakes its record, pages, history, and comments",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const task = yield* startTask(owner, { name: "Teammate invitations" });
        const params = { userId: owner, taskId: task.id };
        const onTask: readonly SyncTopic[] = [[TOPIC.TASK, task.id]];

        // A save is stamped at the clock's instant, which has moved on since the task was made.
        yield* TestClock.adjust(Duration.seconds(1));
        yield* wakes(
          saveNotes({ userId: owner, taskId: task.id }, [
            added("Context", "A member cannot bring a teammate in."),
          ]),
          [...onTask, [TOPIC.WORKSPACE, task.workspaceId]],
          [taskRecordLive.topics(params), taskHistoryLive.topics(params)],
        );
        const shown = yield* wakes(
          writePage(
            owner,
            taskPageOwner(task.id),
            { title: "Invite funnel", html: "<p>One</p>" },
            { kind: PAGE_SHOWER.APP },
          ),
          onTask,
          [taskRecordLive.topics(params), taskPagesLive.topics(params)],
        );
        const pageId = Option.getOrThrow(shown.value).id;
        yield* wakes(
          startDescriptionCommentThread(
            { actor: DESCRIPTION_COMMENT_ACTOR.MEMBER, userId: owner },
            task.id,
            {
              clientKey: randomUUID(),
              page: { id: pageId, version: 1 },
              words: "Add a chart.",
            },
          ),
          onTask,
          [taskCommentsLive.topics({ ...params, pageId })],
        );
      }),
  );

  it.effect(
    "a page an agent on no task shows, and the agent renamed, notify the agent, which wakes its pages",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const task = yield* startTask(owner, { name: "Unrelated" });
        const agentId = yield* openTaskAgent(owner, task.workspaceId, null);
        const woken = [agentPagesLive.topics({ userId: owner, agentId })];

        yield* wakes(
          writePage(
            owner,
            { kind: PAGE_OWNER.AGENT, agentId },
            { title: "Spike notes", html: "<p>One</p>" },
            { kind: PAGE_SHOWER.AGENT, agentId },
          ),
          [[TOPIC.AGENT, agentId]],
          woken,
        );
        yield* wakes(
          renameAgent(owner, agentId, "Spike"),
          [
            [TOPIC.AGENT, agentId],
            [TOPIC.WORKSPACE, task.workspaceId],
          ],
          woken,
        );
      }),
  );

  it.effect(
    "an agent's tab opened, pointed at, taken over, handed back, and closed, and the agent renamed, each notify its task, which wakes the task's Browser tabs and history",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const task = yield* startTask(owner, { name: "Checkout flow" });
        const started = yield* createAgent(owner, {
          taskId: task.id,
          idempotencyKey: randomUUID(),
          model: "anthropic/claude-opus-5.5",
          effort: "high",
          descriptionSnapshot: null,
          prompt: "Try the checkout.",
          repository: null,
          runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
        });
        const agent = Option.getOrThrow(started).agent;
        const params = { userId: owner, taskId: task.id };
        const tabs = [taskBrowserTabsLive.topics(params)];
        const onTask: readonly SyncTopic[] = [[TOPIC.TASK, task.id]];
        const targetId = `target-${randomUUID()}`;
        const now = yield* Clock.currentTimeMillis;

        const opened = yield* wakes(
          upsertBrowserTab({
            conversationId: agent.conversationId,
            targetId,
            address: "https://shop.example/cart",
            title: "Cart",
            openedBy: { kind: AGENT_BROWSER_TAB_OPENER.AGENT },
          }),
          onTask,
          tabs,
        );
        const tabId = opened.value.id;
        yield* wakes(
          pointBrowserTab(agent.conversationId, {
            tab: targetId,
            x: 120,
            y: 48,
            kind: BROWSER_CURSOR_KIND.CLICK,
            viewport: { width: 1280, height: 800 },
            at: now,
          }),
          onTask,
          tabs,
        );
        yield* wakes(
          takeOverBrowserTab(tabId, owner, new Date(now + 60_000), new Date(now)),
          onTask,
          tabs,
        );
        yield* wakes(handBackBrowserTab(tabId, owner), onTask, tabs);
        yield* wakes(closeBrowserTab(agent.conversationId, tabId), onTask, tabs);
        yield* wakes(
          renameAgent(owner, agent.id, "Checkout"),
          [...onTask, [TOPIC.AGENT, agent.id], [TOPIC.WORKSPACE, task.workspaceId]],
          [...tabs, taskHistoryLive.topics(params)],
        );
      }),
  );

  it.effect(
    "a teammate's repository read recorded, their token removed, and their leaving the workspace notify the teammate, which wakes each of the task's reads",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const task = yield* startTask(owner, { name: "Billing" });
        const teammate = yield* openTokenMember();
        yield* joinWorkspace(task.workspaceId, teammate);
        const sealed = (yield* readGitHubTokenRow(teammate))?.sealedToken ?? "";
        const now = new Date(yield* Clock.currentTimeMillis);
        const params = { userId: teammate, taskId: task.id };
        const reads = [
          taskRecordLive.topics(params),
          taskPagesLive.topics(params),
          taskHistoryLive.topics(params),
          taskBrowserTabsLive.topics(params),
        ];
        const teammateTopic: SyncTopic = [TOPIC.ACCOUNT, teammate];

        yield* wakes(
          recordRepositoryReads(
            teammate,
            sealed,
            [{ repository: "acme/api", readable: true }],
            now,
          ),
          [teammateTopic],
          reads,
        );
        yield* wakes(removeGitHubToken(teammate), [teammateTopic], reads);
        yield* wakes(
          leaveWorkspace(task.workspaceId, teammate),
          [teammateTopic, [TOPIC.WORKSPACE, task.workspaceId]],
          reads,
        );
      }),
  );
});
