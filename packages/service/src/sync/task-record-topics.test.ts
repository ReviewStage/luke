import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import {
  closeBrowserTab,
  handBackBrowserTab,
  pointBrowserTab,
  takeOverBrowserTab,
  upsertBrowserTab,
} from "@luke/database/models/agent-browser-tabs";
import { createCodingAgent, renameCodingAgent } from "@luke/database/models/coding-agent-store";
import { recordRepositoryReads } from "@luke/database/models/github-repository-reads";
import { readGitHubTokenRow, removeGitHubToken } from "@luke/database/models/github-token-store";
import { writePage } from "@luke/database/models/plan-pages";
import { user } from "@luke/database/schemas/auth";
import { type SyncTopic, TOPIC } from "@luke/database/sync/notification";
import {
  expectTopicsFire,
  getTestDB,
  joinWorkspace,
  leaveWorkspace,
  openTaskAgent,
  startTask,
} from "@luke/database/testing";
import { AGENT_BROWSER_TAB_OPENER } from "@luke/features/agent-browser-tab-wire";
import { BROWSER_CURSOR_KIND } from "@luke/features/browser-agent-actions";
import { PAGE_OWNER, PAGE_SHOWER, taskPageOwner } from "@luke/features/page-wire";
import { Clock, Duration, Effect, Option } from "effect";
import { TestClock } from "effect/testing";
import { saveNotes } from "../tasks/plan-notes.js";
import { openTokenMember } from "../testing/github-app-fake.js";
import { added } from "../testing/task-contents.js";
import {
  agentPagesLive,
  taskBrowserTabsLive,
  taskHistoryLive,
  taskPagesLive,
  taskRecordLive,
} from "./live-queries.js";

/**
 * An open task's live reads on the migrated capture: its record, pages,
 * history, and Browser tabs (`taskRecordLive` and its neighbours), and an
 * agent's own pages on no task (`agentPagesLive`). Each write that moves
 * one, through its real writer, notifies a topic the read is woken on, so a
 * window holding it hears it within a coalesce window rather than at the
 * hold's end: the plan saved and a page shown on the task, a page an agent
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
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` });
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
    "the plan's notes saved and a page shown on the task notify the task, which wakes its record, pages, and history",
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
        yield* wakes(
          writePage(
            owner,
            taskPageOwner(task.id),
            { title: "Invite funnel", html: "<p>One</p>" },
            { kind: PAGE_SHOWER.LUKE },
          ),
          onTask,
          [taskRecordLive.topics(params), taskPagesLive.topics(params)],
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
          renameCodingAgent(owner, agentId, "Spike"),
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
        const started = yield* createCodingAgent(owner, {
          taskId: task.id,
          idempotencyKey: randomUUID(),
          model: "anthropic/claude-opus-5.5",
          effort: "high",
          planSnapshot: null,
          prompt: "Try the checkout.",
          repository: null,
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
          renameCodingAgent(owner, agent.id, "Checkout"),
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
