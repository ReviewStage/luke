import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { AGENT_BROWSER_TAB_OPENER } from "@luke/features/agent-browser-tab-wire";
import { BROWSER_SHOWN_MAX_CHARS } from "@luke/features/browser-acts";
import { BROWSER_CURSOR_KIND } from "@luke/features/browser-agent-actions";
import { GITHUB_ACCESS } from "@luke/features/github-repositories-wire";
import { eq } from "drizzle-orm";
import { DateTime, Effect, Option } from "effect";
import { TestClock } from "effect/testing";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { codingAgent } from "../../schemas/coding-agent.js";
import { conversations } from "../../schemas/storage.js";
import { task } from "../../schemas/task.js";
import { CONVERSATION_KIND } from "../../storage-vocabulary.js";
import { getTestDB, joinWorkspace, openWorkspace } from "../../testing/index.js";
import {
  type BrowserTabAction,
  browserTabDriver,
  closeBrowserTab,
  handBackBrowserTab,
  listAgentBrowserTabs,
  listTaskBrowserTabs,
  noteBrowserTabPage,
  pointBrowserTab,
  readTaskBrowserTab,
  recordMemberOpenedBrowserTab,
  renewBrowserTabTakeover,
  retargetBrowserTab,
  takeOverBrowserTab,
  upsertBrowserTab,
} from "../agent-browser-tabs.js";
import { createCodingAgent } from "../coding-agent-store.js";
import { CLEARED_CONVERSATION_RETENTION_MS, purgeClearedConversations } from "../soft-delete.js";
import { createTask } from "../task-store.js";

/**
 * The Browser tabs open in agents' browsers, over a real dialect: an
 * agent's action writes its tab once and moves its page on; a task's tabs
 * are listed only to a member who reaches the task and sees the agent, each
 * with the coding agent whose browser holds it; a takeover is a
 * check-and-set two members never both win, which lapses on its own; and a
 * tab goes with its agent's conversation, the purge's delete among them.
 *
 * Synthetic accounts, workspaces, tasks, agents, and pages throughout.
 */

const MINUTE_MS = 60_000;

/** A new account, answering its id. */
const openAccount = Effect.gen(function* () {
  const id = `user-${randomUUID()}`;
  yield* Database.use((db) =>
    db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` }),
  );
  return id;
});

/** A starter's coding agent on the task named, its browser named by its own conversation. */
const startAgent = (starter: string, taskId: string) =>
  Effect.map(
    createCodingAgent(starter, {
      taskId,
      planSnapshot: "# Checkout",
      prompt: null,
      idempotencyKey: randomUUID(),
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      repository: "acme/shop",
    }),
    (started) => Option.getOrThrow(started).agent,
  );

/** A starter's task in a workspace a teammate shares, and two coding agents on it. */
const openTask = Effect.gen(function* () {
  const [starter, teammate, outsider] = [
    yield* openAccount,
    yield* openAccount,
    yield* openAccount,
  ];
  const workspace = yield* openWorkspace(starter);
  yield* joinWorkspace(workspace, teammate);
  yield* openWorkspace(outsider);
  const started = yield* createTask(starter, { organizationId: workspace, name: "Checkout" });
  const agent = yield* startAgent(starter, started.id);
  const other = yield* startAgent(starter, started.id);
  return { starter, teammate, outsider, taskId: started.id, agent, other };
});

/** An agent's report of a page in a tab its browser names. */
const action = (conversationId: string, targetId: string, address: string): BrowserTabAction => ({
  conversationId,
  targetId,
  address,
  title: `Title of ${address}`,
  openedBy: { kind: AGENT_BROWSER_TAB_OPENER.AGENT },
});

it.layer(getTestDB())("an agent's Browser tabs", (it) => {
  it.effect(
    "an agent's action writes its tab once, moves its page on, and cuts what is only drawn",
    () =>
      Effect.gen(function* () {
        const { agent, taskId, teammate } = yield* openTask;
        const first = yield* upsertBrowserTab({
          ...action(agent.conversationId, "target-1", "https://shop.test/"),
          openedBy: { kind: AGENT_BROWSER_TAB_OPENER.MEMBER, userId: teammate },
        });
        yield* TestClock.adjust("1 minute");
        const long = `https://shop.test/${"a".repeat(BROWSER_SHOWN_MAX_CHARS)}`;
        const moved = yield* upsertBrowserTab(action(agent.conversationId, "target-1", long));

        assert.equal(moved.id, first.id);
        assert.equal(moved.taskId, taskId);
        assert.equal(moved.address, long.slice(0, BROWSER_SHOWN_MAX_CHARS));
        assert.equal(moved.title, `Title of ${long}`.slice(0, BROWSER_SHOWN_MAX_CHARS));
        assert.equal(moved.openedBy, AGENT_BROWSER_TAB_OPENER.MEMBER);
        assert.equal(moved.openedByUserId, teammate);
        assert.equal(moved.createdAt.getTime(), first.createdAt.getTime());
        assert.equal(moved.lastActedAt.getTime(), first.createdAt.getTime() + MINUTE_MS);
        assert.deepEqual(
          (yield* listAgentBrowserTabs(agent.conversationId)).map((tab) => tab.id),
          [first.id],
        );
      }),
  );

  it.effect(
    "a task's tabs are listed to the members who reach it, each with the agent whose browser holds it, and to no one else",
    () =>
      Effect.gen(function* () {
        const { starter, teammate, outsider, taskId, agent, other } = yield* openTask;
        const coders = yield* upsertBrowserTab(
          action(agent.conversationId, "target-1", "http://localhost:3000/"),
        );
        yield* TestClock.adjust("1 second");
        const others = yield* upsertBrowserTab(
          action(other.conversationId, "target-1", "https://docs.test/"),
        );

        for (const member of [starter, teammate]) {
          const listed = Option.getOrThrow(yield* listTaskBrowserTabs(member, taskId));
          assert.deepEqual(
            listed.map(({ tab, agent: holder }) => [tab.id, holder.id]),
            [
              [coders.id, agent.id],
              [others.id, other.id],
            ],
          );
        }
        assert.ok(Option.isNone(yield* listTaskBrowserTabs(outsider, taskId)));
        assert.ok(Option.isNone(yield* readTaskBrowserTab(outsider, taskId, coders.id)));
        assert.ok(Option.isNone(yield* listTaskBrowserTabs(starter, randomUUID())));
        const read = Option.getOrThrow(yield* readTaskBrowserTab(teammate, taskId, coders.id));
        assert.deepEqual(read.agent, {
          id: agent.id,
          userId: starter,
          githubAccess: GITHUB_ACCESS.APP,
        });
      }),
  );

  it.effect(
    "a coding agent on its starter's own token keeps its tabs from a teammate who does not see it",
    () =>
      Effect.gen(function* () {
        const { starter, teammate, taskId, agent, other } = yield* openTask;
        yield* Database.use((db) =>
          db
            .update(codingAgent)
            .set({ githubAccess: GITHUB_ACCESS.TOKEN })
            .where(eq(codingAgent.id, agent.id)),
        );
        const coders = yield* upsertBrowserTab(
          action(agent.conversationId, "target-1", "https://shop.test/"),
        );
        const others = yield* upsertBrowserTab(
          action(other.conversationId, "target-1", "https://docs.test/"),
        );

        const seen = (member: string) =>
          Effect.map(listTaskBrowserTabs(member, taskId), (listed) =>
            Option.getOrThrow(listed).map(({ tab }) => tab.id),
          );
        assert.deepEqual(new Set(yield* seen(starter)), new Set([coders.id, others.id]));
        assert.deepEqual(yield* seen(teammate), [others.id]);
        assert.ok(Option.isNone(yield* readTaskBrowserTab(teammate, taskId, coders.id)));
      }),
  );

  it.effect(
    "two members never both drive a tab, and a takeover lapses unless its driver renews it",
    () =>
      Effect.gen(function* () {
        const { starter, teammate, taskId, agent } = yield* openTask;
        const tab = yield* upsertBrowserTab(
          action(agent.conversationId, "target-1", "https://shop.test/"),
        );
        const instant = (minutes: number) =>
          Effect.map(DateTime.nowAsDate, (now) => new Date(now.getTime() + minutes * MINUTE_MS));
        const driverNow = Effect.gen(function* () {
          const now = yield* DateTime.nowAsDate;
          const read = Option.getOrThrow(yield* readTaskBrowserTab(starter, taskId, tab.id));
          return browserTabDriver(read.tab, now)?.userId ?? null;
        });

        assert.equal(
          yield* takeOverBrowserTab(tab.id, starter, yield* instant(1), yield* instant(0)),
          true,
        );
        assert.equal(
          yield* takeOverBrowserTab(tab.id, teammate, yield* instant(1), yield* instant(0)),
          false,
        );
        assert.equal(
          yield* renewBrowserTabTakeover(tab.id, teammate, yield* instant(2), yield* instant(0)),
          false,
        );
        assert.equal(yield* handBackBrowserTab(tab.id, teammate), false);
        assert.equal(yield* driverNow, starter);

        // A renewal moves the takeover on, and a slower one never moves it back.
        assert.equal(
          yield* renewBrowserTabTakeover(tab.id, starter, yield* instant(2), yield* instant(0)),
          true,
        );
        assert.equal(
          yield* renewBrowserTabTakeover(tab.id, starter, yield* instant(1), yield* instant(0)),
          true,
        );
        yield* TestClock.adjust("90 seconds");
        assert.equal(yield* driverNow, starter);

        yield* TestClock.adjust("1 minute");
        assert.equal(yield* driverNow, null);
        assert.equal(
          yield* renewBrowserTabTakeover(tab.id, starter, yield* instant(1), yield* instant(0)),
          false,
        );
        assert.equal(
          yield* takeOverBrowserTab(tab.id, teammate, yield* instant(1), yield* instant(0)),
          true,
        );
        assert.equal(yield* driverNow, teammate);
        assert.equal(yield* handBackBrowserTab(tab.id, teammate), true);
        assert.equal(yield* driverNow, null);
      }),
  );

  it.effect(
    "a tab a member opened stands as theirs though the agent's list wrote it first, and the agent's later writes leave it theirs",
    () =>
      Effect.gen(function* () {
        const { agent, teammate } = yield* openTask;
        // The agent's `list` saw the new page in the moment before the member's open recorded it.
        const listed = yield* upsertBrowserTab(
          action(agent.conversationId, "target-new", "about:blank"),
        );
        const opened = yield* recordMemberOpenedBrowserTab({
          conversationId: agent.conversationId,
          targetId: "target-new",
          address: "https://accounts.test/",
          title: "https://accounts.test/",
          userId: teammate,
        });
        const later = yield* upsertBrowserTab(
          action(agent.conversationId, "target-new", "https://accounts.test/home"),
        );

        assert.equal(opened.id, listed.id);
        assert.equal(opened.address, "https://accounts.test/");
        for (const row of [opened, later]) {
          assert.equal(row.openedBy, AGENT_BROWSER_TAB_OPENER.MEMBER);
          assert.equal(row.openedByUserId, teammate);
        }
      }),
  );

  it.effect(
    "a live view's note of a tab's page moves its address and title on its own target alone, and leaves its opener and last action",
    () =>
      Effect.gen(function* () {
        const { agent } = yield* openTask;
        const tab = yield* upsertBrowserTab(
          action(agent.conversationId, "target-1", "https://shop.test/login"),
        );
        yield* TestClock.adjust("1 minute");

        const noted = yield* noteBrowserTabPage(tab.id, "target-1", {
          address: "https://shop.test/dashboard",
          title: "Dashboard",
        });
        yield* retargetBrowserTab(agent.conversationId, tab.id, "target-1", "target-2");
        // A view still on the old target, as one a reopening moved the tab off, notes nothing.
        const stale = yield* noteBrowserTabPage(tab.id, "target-1", {
          address: "https://shop.test/stale",
          title: "Stale",
        });

        assert.equal(noted, true);
        assert.equal(stale, false);
        const [row] = yield* listAgentBrowserTabs(agent.conversationId);
        assert.ok(row);
        assert.equal(row.address, "https://shop.test/dashboard");
        assert.equal(row.title, "Dashboard");
        assert.equal(row.openedBy, AGENT_BROWSER_TAB_OPENER.AGENT);
        assert.equal(row.lastActedAt.getTime(), tab.lastActedAt.getTime());
      }),
  );

  it.effect("a member's earlier take landing after a later one never shortens their takeover", () =>
    Effect.gen(function* () {
      const { starter, teammate, taskId, agent } = yield* openTask;
      const tab = yield* upsertBrowserTab(
        action(agent.conversationId, "target-1", "https://shop.test/"),
      );
      const now = yield* DateTime.nowAsDate;
      const at = (minutes: number) => new Date(now.getTime() + minutes * MINUTE_MS);

      assert.equal(yield* takeOverBrowserTab(tab.id, starter, at(2), now), true);
      assert.equal(yield* takeOverBrowserTab(tab.id, starter, at(1), now), true);
      yield* TestClock.adjust("90 seconds");
      assert.equal(
        yield* takeOverBrowserTab(tab.id, teammate, at(3), yield* DateTime.nowAsDate),
        false,
      );
      const read = Option.getOrThrow(yield* readTaskBrowserTab(starter, taskId, tab.id));
      assert.equal(browserTabDriver(read.tab, yield* DateTime.nowAsDate)?.userId, starter);
    }),
  );

  it.effect("a tab stands on the task its agent is on, and on none for an agent on none", () =>
    Effect.gen(function* () {
      const { starter, taskId, agent } = yield* openTask;
      const elsewhere = yield* openTask;
      const [loose] = yield* Database.use((db) =>
        db
          .insert(conversations)
          .values({ userId: starter, kind: CONVERSATION_KIND.CODING_AGENT })
          .returning({ id: conversations.id }),
      );
      assert.ok(loose);
      const own = yield* upsertBrowserTab(
        action(agent.conversationId, "target-1", "https://a.test/"),
      );
      const theirs = yield* upsertBrowserTab(
        action(elsewhere.agent.conversationId, "target-1", "https://b.test/"),
      );
      const none = yield* upsertBrowserTab(action(loose.id, "target-1", "https://c.test/"));

      assert.deepEqual([own.taskId, theirs.taskId, none.taskId], [taskId, elsewhere.taskId, null]);
      assert.deepEqual(
        Option.getOrThrow(yield* listTaskBrowserTabs(starter, taskId)).map(({ tab }) => tab.id),
        [own.id],
      );
    }),
  );

  it.effect(
    "a pointer move is kept on the tab its own agent's browser names, and a tab no row keeps takes none",
    () =>
      Effect.gen(function* () {
        const { agent, other } = yield* openTask;
        const tab = yield* upsertBrowserTab(
          action(agent.conversationId, "target-1", "https://shop.test/"),
        );
        yield* TestClock.adjust("1 minute");
        const at = (yield* DateTime.nowAsDate).getTime();
        const move = {
          tab: "target-1",
          x: 10.25,
          y: 20,
          kind: BROWSER_CURSOR_KIND.CLICK,
          viewport: { width: 1279.6, height: 800 },
          at,
        };

        assert.equal(yield* pointBrowserTab(other.conversationId, move), false);
        assert.equal(
          yield* pointBrowserTab(agent.conversationId, { ...move, tab: "target-2" }),
          false,
        );
        assert.equal(yield* pointBrowserTab(agent.conversationId, move), true);
        const [kept] = yield* listAgentBrowserTabs(agent.conversationId);
        assert.deepEqual(
          kept && {
            id: kept.id,
            x: kept.cursorX,
            y: kept.cursorY,
            kind: kept.cursorKind,
            width: kept.cursorViewportW,
            height: kept.cursorViewportH,
            at: kept.cursorAt?.getTime(),
            lastActedAt: kept.lastActedAt.getTime(),
          },
          {
            id: tab.id,
            x: 10.25,
            y: 20,
            kind: "click",
            width: 1280,
            height: 800,
            at,
            lastActedAt: at,
          },
        );
        assert.deepEqual(yield* listAgentBrowserTabs(other.conversationId), []);
      }),
  );

  it.effect(
    "a move that lands after a later one leaves the later one, and the tab's last action never goes back",
    () =>
      Effect.gen(function* () {
        const { agent } = yield* openTask;
        yield* upsertBrowserTab(action(agent.conversationId, "target-1", "https://shop.test/"));
        yield* TestClock.adjust("1 minute");
        const later = (yield* DateTime.nowAsDate).getTime();
        const move = {
          tab: "target-1",
          kind: BROWSER_CURSOR_KIND.CLICK,
          viewport: { width: 1280, height: 800 },
        };

        assert.equal(
          yield* pointBrowserTab(agent.conversationId, { ...move, x: 2, y: 2, at: later }),
          true,
        );
        assert.equal(
          yield* pointBrowserTab(agent.conversationId, { ...move, x: 1, y: 1, at: later - 30_000 }),
          false,
        );
        // An action reported before the move, its write landing after it, moves nothing back either.
        yield* Effect.provide(
          upsertBrowserTab(action(agent.conversationId, "target-1", "https://shop.test/next")),
          // A clock of its own, at the epoch, well before the move.
          TestClock.layer(),
        );
        const [kept] = yield* listAgentBrowserTabs(agent.conversationId);

        assert.deepEqual(
          kept && [
            kept.cursorX,
            kept.cursorAt?.getTime(),
            kept.lastActedAt.getTime(),
            kept.address,
          ],
          [2, later, later, "https://shop.test/next"],
        );
      }),
  );

  it.effect("a close deletes the tab from its own agent's browser alone", () =>
    Effect.gen(function* () {
      const { starter, taskId, agent, other } = yield* openTask;
      const tab = yield* upsertBrowserTab(
        action(agent.conversationId, "target-1", "https://shop.test/"),
      );

      assert.equal(yield* closeBrowserTab(other.conversationId, tab.id), false);
      assert.equal(yield* closeBrowserTab(agent.conversationId, tab.id), true);
      assert.deepEqual(yield* listAgentBrowserTabs(agent.conversationId), []);
      assert.deepEqual(Option.getOrThrow(yield* listTaskBrowserTabs(starter, taskId)), []);
    }),
  );

  it.effect(
    "a reopened tab keeps its id, page, and takeover on its new target, in its own agent's browser alone",
    () =>
      Effect.gen(function* () {
        const { teammate, agent, other } = yield* openTask;
        const tab = yield* upsertBrowserTab(
          action(agent.conversationId, "target-1", "https://shop.test/"),
        );
        const now = yield* DateTime.nowAsDate;
        yield* takeOverBrowserTab(tab.id, teammate, new Date(now.getTime() + MINUTE_MS), now);

        assert.equal(
          yield* retargetBrowserTab(other.conversationId, tab.id, "target-1", "target-9"),
          false,
        );
        assert.equal(
          yield* retargetBrowserTab(agent.conversationId, tab.id, "target-1", "target-2"),
          true,
        );
        // A second reopening that read the tab on its old target finds it moved, and moves nothing.
        assert.equal(
          yield* retargetBrowserTab(agent.conversationId, tab.id, "target-1", "target-3"),
          false,
        );
        const [moved] = yield* listAgentBrowserTabs(agent.conversationId);

        assert.ok(moved);
        assert.equal(moved.id, tab.id);
        assert.equal(moved.targetId, "target-2");
        assert.equal(moved.address, "https://shop.test/");
        assert.equal(moved.driverUserId, teammate);
        // A later report from the browser names the new target and finds the same tab.
        const again = yield* upsertBrowserTab(
          action(agent.conversationId, "target-2", "https://shop.test/cart"),
        );
        assert.equal(again.id, tab.id);
      }),
  );

  it.effect(
    "a tab goes with its agent's conversation when the purge removes it, and with its task",
    () =>
      Effect.gen(function* () {
        const { starter, taskId, agent, other } = yield* openTask;
        yield* upsertBrowserTab(action(agent.conversationId, "target-1", "https://shop.test/"));
        yield* upsertBrowserTab(action(other.conversationId, "target-1", "https://docs.test/"));
        const now = yield* DateTime.nowAsDate;
        yield* Database.use((db) =>
          db
            .update(conversations)
            .set({ deletedAt: new Date(now.getTime() - CLEARED_CONVERSATION_RETENTION_MS) })
            .where(eq(conversations.id, agent.conversationId)),
        );

        yield* purgeClearedConversations(now);

        assert.deepEqual(yield* listAgentBrowserTabs(agent.conversationId), []);
        assert.deepEqual(
          Option.getOrThrow(yield* listTaskBrowserTabs(starter, taskId)).map(
            ({ tab }) => tab.address,
          ),
          ["https://docs.test/"],
        );
        yield* Database.use((db) => db.delete(task).where(eq(task.id, taskId)));
        assert.deepEqual(yield* listAgentBrowserTabs(other.conversationId), []);
      }),
  );
});
