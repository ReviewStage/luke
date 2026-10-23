/**
 * agent-browser-tabs.ts -- the Browser tabs open in agents' browsers: an agent's actions write them, and a task's members list them and take one over.
 *
 * An agent is named here by its own conversation, the one its sandbox is
 * kept for (`schemas/agent-browser-tab.ts`), and a worker writes under its
 * parent's. The agent's side, an
 * upsert as it acts on a tab, a close, and the list of its own tabs, is the
 * service's and reads no account, as the sandbox's terminal lease reads
 * none. A member's side reads through the rules every agent route keeps: a
 * task's tabs are listed only to a member who reaches the task, and a coding
 * agent's only to one who sees that agent (`agentReachableBy`); any other
 * reads as none at all. Whether the member may drive the tab, which a coding
 * agent on its starter's own token keeps to the starter, is the service's to
 * decide from the agent this answers beside the tab.
 *
 * A takeover is a check-and-set on the driver and the instant it lapses: a
 * member takes a tab no one drives, or whose takeover lapsed, or that they
 * drive already, and renews only a takeover of their own still standing, so
 * two members never both drive one tab, and one whose window went away
 * leaves the tab to the agent once their instant passes.
 *
 * The agent's side also keeps its pointer on a tab (`pointBrowserTab`), and
 * a member's window follows a task's tabs live
 * (`taskBrowserTabsLiveStatement`), under the same rule as the list.
 */

import { AGENT_BROWSER_TAB_OPENER } from "@luke/features/agent-browser-tab-wire";
import { BROWSER_SHOWN_MAX_CHARS } from "@luke/features/browser-acts";
import { BROWSER_CURSOR_KIND, type BrowserCursorMove } from "@luke/features/browser-agent-actions";
import { GITHUB_ACCESS, type GitHubAccess } from "@luke/features/github-repositories-wire";
import { and, asc, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import { DateTime, Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { type LiveStatement, liveSelection, liveStatementOf } from "../core/live-statement.js";
import { Database, type DatabaseServices, queryBuilder, type StoreFailure } from "../core/query.js";
import { agentBrowserTab } from "../schemas/agent-browser-tab.js";
import { member } from "../schemas/auth.js";
import { codingAgent } from "../schemas/coding-agent.js";
import { task } from "../schemas/task.js";
import { InstantColumnSchema } from "./columns.js";
import { agentReachableBy, reachableTask, taskReachableBy, taskSeenBy } from "./workspace-store.js";

type BrowserTabEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

const OPENERS = Object.values(AGENT_BROWSER_TAB_OPENER);

const GITHUB_ACCESSES = Object.values(GITHUB_ACCESS);

const CURSOR_KINDS = Object.values(BROWSER_CURSOR_KIND);

/** One tab as its row keeps it. */
const BrowserTabSchema = Schema.Struct({
  id: Schema.String,
  conversationId: Schema.String,
  taskId: Schema.NullOr(Schema.String),
  targetId: Schema.String,
  address: Schema.String,
  title: Schema.String,
  openedBy: Schema.Literals(OPENERS),
  openedByUserId: Schema.NullOr(Schema.String),
  driverUserId: Schema.NullOr(Schema.String),
  heldUntil: Schema.NullOr(InstantColumnSchema),
  createdAt: InstantColumnSchema,
  lastActedAt: InstantColumnSchema,
  cursorX: Schema.NullOr(Schema.Number),
  cursorY: Schema.NullOr(Schema.Number),
  cursorKind: Schema.NullOr(Schema.Literals(CURSOR_KINDS)),
  cursorViewportW: Schema.NullOr(Schema.Number),
  cursorViewportH: Schema.NullOr(Schema.Number),
  cursorAt: Schema.NullOr(InstantColumnSchema),
});

export type AgentBrowserTabRow = typeof BrowserTabSchema.Type;

/** The coding agent whose browser holds a tab, as the rule for who may drive it reads it. */
interface BrowserTabAgent {
  readonly id: string;
  /** The member who started the agent. */
  readonly userId: string;
  readonly githubAccess: GitHubAccess;
}

/** A tab a member reached: its row, and the coding agent whose browser holds it. */
export interface ReachedBrowserTab {
  readonly tab: AgentBrowserTabRow;
  readonly agent: BrowserTabAgent;
}

/** A tab as an agent's action on it reports it: whose browser, its task, the browser's own id for it, and how its page stands. */
export interface BrowserTabAction {
  /** The conversation of the agent whose browser holds it: a coding agent's, or a worker's parent's. */
  readonly conversationId: string;
  readonly targetId: string;
  readonly address: string;
  readonly title: string;
  /** Who opened it, kept from its first report: the agent, or the member named. */
  readonly openedBy:
    | { readonly kind: typeof AGENT_BROWSER_TAB_OPENER.AGENT }
    | { readonly kind: typeof AGENT_BROWSER_TAB_OPENER.MEMBER; readonly userId: string };
}

const tabColumns = {
  id: agentBrowserTab.id,
  conversationId: agentBrowserTab.conversationId,
  taskId: agentBrowserTab.taskId,
  targetId: agentBrowserTab.targetId,
  address: agentBrowserTab.address,
  title: agentBrowserTab.title,
  openedBy: agentBrowserTab.openedBy,
  openedByUserId: agentBrowserTab.openedByUserId,
  driverUserId: agentBrowserTab.driverUserId,
  heldUntil: agentBrowserTab.heldUntil,
  createdAt: agentBrowserTab.createdAt,
  lastActedAt: agentBrowserTab.lastActedAt,
  cursorX: agentBrowserTab.cursorX,
  cursorY: agentBrowserTab.cursorY,
  cursorKind: agentBrowserTab.cursorKind,
  cursorViewportW: agentBrowserTab.cursorViewportW,
  cursorViewportH: agentBrowserTab.cursorViewportH,
  cursorAt: agentBrowserTab.cursorAt,
};

const ReachedTabSchema = Schema.Struct({
  ...BrowserTabSchema.fields,
  agentId: Schema.String,
  agentUserId: Schema.String,
  agentGithubAccess: Schema.Literals(GITHUB_ACCESSES),
});

/** An address or a title cut where the Browser tab cuts one, since it is only drawn. */
function shown(text: string): string {
  return text.length > BROWSER_SHOWN_MAX_CHARS ? text.slice(0, BROWSER_SHOWN_MAX_CHARS) : text;
}

/**
 * The task of the agent whose conversation is named, read from the agent's
 * own row rather than taken from the caller; null for an agent on none. So a
 * tab is never listed on a task its agent is not on.
 */
function taskOfConversation(conversationId: string) {
  return sql<
    string | null
  >`(select ${codingAgent.taskId} from ${codingAgent} where ${codingAgent.conversationId} = ${conversationId})`;
}

/**
 * The tabs a member reaches: on a task they reach, of an agent they see. A
 * tab no coding agent's conversation names, one a task's Luke opened while a
 * task had one, is listed to no one.
 */
function reachedTabs(userId: string, taskId: string, tabId?: string) {
  return Database.use((db) =>
    db
      .select({
        ...tabColumns,
        agentId: codingAgent.id,
        agentUserId: codingAgent.userId,
        agentGithubAccess: codingAgent.githubAccess,
      })
      .from(agentBrowserTab)
      .innerJoin(task, eq(task.id, agentBrowserTab.taskId))
      .innerJoin(codingAgent, eq(codingAgent.conversationId, agentBrowserTab.conversationId))
      .where(
        and(
          eq(agentBrowserTab.taskId, taskId),
          tabId === undefined ? undefined : eq(agentBrowserTab.id, tabId),
          taskReachableBy(userId),
          agentReachableBy(userId),
        ),
      )
      .orderBy(asc(agentBrowserTab.createdAt), asc(agentBrowserTab.id)),
  );
}

const findReachedTabs = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    taskId: Schema.String,
    tabId: Schema.optionalKey(Schema.String),
  }),
  Result: ReachedTabSchema,
  execute: ({ userId, taskId, tabId }) => reachedTabs(userId, taskId, tabId),
});

const findReachableTask = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, taskId: Schema.String }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, taskId }) =>
    Database.use((db) =>
      db.select({ id: task.id }).from(task).where(reachableTask(userId, taskId)),
    ),
});

const findAgentTabs = SqlSchema.findAll({
  Request: Schema.Struct({ conversationId: Schema.String }),
  Result: BrowserTabSchema,
  execute: ({ conversationId }) =>
    Database.use((db) =>
      db
        .select(tabColumns)
        .from(agentBrowserTab)
        .where(eq(agentBrowserTab.conversationId, conversationId))
        .orderBy(asc(agentBrowserTab.createdAt), asc(agentBrowserTab.id)),
    ),
});

const upsertTab = SqlSchema.findOne({
  Request: Schema.Struct({
    conversationId: Schema.String,
    targetId: Schema.String,
    address: Schema.String,
    title: Schema.String,
    openedBy: Schema.Literals(OPENERS),
    openedByUserId: Schema.NullOr(Schema.String),
    /** Whether the opener given replaces the one a row already keeps: only for a target this caller just made. */
    claimOpener: Schema.Boolean,
    now: Schema.Date,
  }),
  Result: BrowserTabSchema,
  execute: ({ now, claimOpener, ...tab }) =>
    Database.use((db) =>
      db
        .insert(agentBrowserTab)
        .values({
          ...tab,
          taskId: taskOfConversation(tab.conversationId),
          createdAt: now,
          lastActedAt: now,
        })
        .onConflictDoUpdate({
          target: [agentBrowserTab.conversationId, agentBrowserTab.targetId],
          // Who opened it and when stand from its first report; the page moves on, and the instant never back.
          set: {
            address: tab.address,
            title: tab.title,
            lastActedAt: sql`greatest(${agentBrowserTab.lastActedAt}, ${now}::timestamptz)`,
            ...(claimOpener
              ? { openedBy: tab.openedBy, openedByUserId: tab.openedByUserId }
              : undefined),
          },
        })
        .returning(tabColumns),
    ),
});

const pointTab = SqlSchema.findAll({
  Request: Schema.Struct({
    conversationId: Schema.String,
    targetId: Schema.String,
    x: Schema.Number,
    y: Schema.Number,
    kind: Schema.Literals(CURSOR_KINDS),
    width: Schema.Number,
    height: Schema.Number,
    at: Schema.Date,
  }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ conversationId, targetId, x, y, kind, width, height, at }) =>
    Database.use((db) =>
      db
        .update(agentBrowserTab)
        .set({
          cursorX: x,
          cursorY: y,
          cursorKind: kind,
          cursorViewportW: width,
          cursorViewportH: height,
          cursorAt: at,
          lastActedAt: sql`greatest(${agentBrowserTab.lastActedAt}, ${at}::timestamptz)`,
        })
        .where(
          and(
            eq(agentBrowserTab.conversationId, conversationId),
            eq(agentBrowserTab.targetId, targetId),
            // Only over an earlier move, so of two writes landing out of order the later move stands.
            or(isNull(agentBrowserTab.cursorAt), lte(agentBrowserTab.cursorAt, at)),
          ),
        )
        .returning({ id: agentBrowserTab.id }),
    ),
});

const deleteTab = SqlSchema.findAll({
  Request: Schema.Struct({ conversationId: Schema.String, tabId: Schema.String }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ conversationId, tabId }) =>
    Database.use((db) =>
      db
        .delete(agentBrowserTab)
        .where(
          and(eq(agentBrowserTab.id, tabId), eq(agentBrowserTab.conversationId, conversationId)),
        )
        .returning({ id: agentBrowserTab.id }),
    ),
});

const retargetTab = SqlSchema.findAll({
  Request: Schema.Struct({
    conversationId: Schema.String,
    tabId: Schema.String,
    from: Schema.String,
    to: Schema.String,
  }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ conversationId, tabId, from, to }) =>
    Database.use((db) =>
      db
        .update(agentBrowserTab)
        .set({ targetId: to })
        .where(
          and(
            eq(agentBrowserTab.id, tabId),
            eq(agentBrowserTab.conversationId, conversationId),
            // Only from the target the caller read, so of two reopening the tab at once one moves it.
            eq(agentBrowserTab.targetId, from),
          ),
        )
        .returning({ id: agentBrowserTab.id }),
    ),
});

const notePageTab = SqlSchema.findAll({
  Request: Schema.Struct({
    tabId: Schema.String,
    targetId: Schema.String,
    address: Schema.String,
    title: Schema.String,
  }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ tabId, targetId, address, title }) =>
    Database.use((db) =>
      db
        .update(agentBrowserTab)
        .set({ address, title })
        .where(
          and(
            eq(agentBrowserTab.id, tabId),
            // Only on the target the caller watches, so a write from a target a reopening moved the tab off never lands.
            eq(agentBrowserTab.targetId, targetId),
          ),
        )
        .returning({ id: agentBrowserTab.id }),
    ),
});

const takeTab = SqlSchema.findAll({
  Request: Schema.Struct({
    tabId: Schema.String,
    userId: Schema.String,
    heldUntil: Schema.Date,
    now: Schema.Date,
  }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ tabId, userId, heldUntil, now }) =>
    Database.use((db) =>
      db
        .update(agentBrowserTab)
        .set({
          driverUserId: userId,
          // A member's own standing takeover moves on and never back, so an earlier take landing late shortens nothing.
          heldUntil: sql`case when ${agentBrowserTab.driverUserId} = ${userId} and ${agentBrowserTab.heldUntil} > ${now} then greatest(${agentBrowserTab.heldUntil}, ${heldUntil}) else ${heldUntil}::timestamptz end`,
        })
        .where(
          and(
            eq(agentBrowserTab.id, tabId),
            // No one drives it, the driver's takeover lapsed, or the driver is this member.
            or(
              isNull(agentBrowserTab.driverUserId),
              isNull(agentBrowserTab.heldUntil),
              lte(agentBrowserTab.heldUntil, now),
              eq(agentBrowserTab.driverUserId, userId),
            ),
          ),
        )
        .returning({ id: agentBrowserTab.id }),
    ),
});

const renewTab = SqlSchema.findAll({
  Request: Schema.Struct({
    tabId: Schema.String,
    userId: Schema.String,
    heldUntil: Schema.Date,
    now: Schema.Date,
  }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ tabId, userId, heldUntil, now }) =>
    Database.use((db) =>
      db
        .update(agentBrowserTab)
        // The later of the two, so a slower renewal never moves the takeover back.
        .set({ heldUntil: sql`greatest(${agentBrowserTab.heldUntil}, ${heldUntil})` })
        .where(
          and(
            eq(agentBrowserTab.id, tabId),
            eq(agentBrowserTab.driverUserId, userId),
            gt(agentBrowserTab.heldUntil, now),
          ),
        )
        .returning({ id: agentBrowserTab.id }),
    ),
});

const releaseTab = SqlSchema.findAll({
  Request: Schema.Struct({ tabId: Schema.String, userId: Schema.String }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ tabId, userId }) =>
    Database.use((db) =>
      db
        .update(agentBrowserTab)
        .set({ driverUserId: null, heldUntil: null })
        .where(and(eq(agentBrowserTab.id, tabId), eq(agentBrowserTab.driverUserId, userId)))
        .returning({ id: agentBrowserTab.id }),
    ),
});

/** A reached row split into its tab and its agent. */
function reachedOf(row: typeof ReachedTabSchema.Type): ReachedBrowserTab {
  const { agentId, agentUserId, agentGithubAccess, ...tab } = row;
  return { tab, agent: { id: agentId, userId: agentUserId, githubAccess: agentGithubAccess } };
}

/** The member driving the tab at the instant given; null where none does or their takeover lapsed. */
export function browserTabDriver(
  tab: Pick<AgentBrowserTabRow, "driverUserId" | "heldUntil">,
  now: Date,
): { readonly userId: string; readonly heldUntil: Date } | null {
  if (tab.driverUserId === null || tab.heldUntil === null) return null;
  if (tab.heldUntil.getTime() <= now.getTime()) return null;
  return { userId: tab.driverUserId, heldUntil: tab.heldUntil };
}

/**
 * The task's tabs, every agent's the member sees, the oldest first, each
 * with the coding agent whose browser holds it; nothing where the member
 * reaches no such task.
 */
export function listTaskBrowserTabs(
  userId: string,
  taskId: string,
): BrowserTabEffect<Option.Option<readonly ReachedBrowserTab[]>> {
  return Effect.gen(function* () {
    const reached = yield* findReachableTask({ userId, taskId });
    if (reached.length === 0) return Option.none();
    const rows = yield* findReachedTabs({ userId, taskId });
    return Option.some(rows.map(reachedOf));
  });
}

/** One tab of the task, where the member reaches it as `listTaskBrowserTabs` would list it; nothing otherwise. */
export function readTaskBrowserTab(
  userId: string,
  taskId: string,
  tabId: string,
): BrowserTabEffect<Option.Option<ReachedBrowserTab>> {
  return Effect.map(findReachedTabs({ userId, taskId, tabId }), (rows) =>
    Option.map(Option.fromNullishOr(rows[0]), reachedOf),
  );
}

/** The tabs open in the browser of the agent whose conversation is named, the oldest first. */
export function listAgentBrowserTabs(
  conversationId: string,
): BrowserTabEffect<readonly AgentBrowserTabRow[]> {
  return findAgentTabs({ conversationId });
}

/**
 * Records an agent's action on a tab: the tab its browser names, made where
 * none stands on the task its agent is on, its page as it now stands, cut
 * at the Browser tab's bound, and the instant. Who opened it stands from its first report, and a
 * member's takeover is left as it is, for the agent's side to heed.
 */
export function upsertBrowserTab(action: BrowserTabAction): BrowserTabEffect<AgentBrowserTabRow> {
  return writeTab(action, false);
}

/**
 * Records a tab a member just opened in an agent's browser, as
 * `upsertBrowserTab` does, but with the member as its opener even where a
 * row for the target stands already: one the agent's own `list` wrote in
 * the moment between the page opening and this write, since the browser
 * makes a new id for every page, so no agent opened it.
 */
export function recordMemberOpenedBrowserTab(
  tab: Omit<BrowserTabAction, "openedBy"> & { readonly userId: string },
): BrowserTabEffect<AgentBrowserTabRow> {
  const { userId, ...page } = tab;
  return writeTab({ ...page, openedBy: { kind: AGENT_BROWSER_TAB_OPENER.MEMBER, userId } }, true);
}

/** A tab's write: upserted with its page as it stands, its opener kept from its first report unless `claimOpener`. */
function writeTab(
  action: BrowserTabAction,
  claimOpener: boolean,
): BrowserTabEffect<AgentBrowserTabRow> {
  return Effect.gen(function* () {
    const now = yield* DateTime.nowAsDate;
    const { openedBy } = action;
    return yield* upsertTab({
      conversationId: action.conversationId,
      targetId: action.targetId,
      address: shown(action.address),
      title: shown(action.title),
      openedBy: openedBy.kind,
      openedByUserId: openedBy.kind === AGENT_BROWSER_TAB_OPENER.MEMBER ? openedBy.userId : null,
      claimOpener,
      now,
    }).pipe(
      // An upsert that returned no row is the database breaking its own contract, not an outcome.
      Effect.catchTag("NoSuchElementError", (missing) => Effect.die(missing)),
    );
  });
}

/**
 * Moves a tab of the agent's from the target it was read on onto the one
 * its browser reopened it as, once a browser started without its pages: the
 * same tab, by its id, with its page, opener, takeover, and instants as they
 * stood. Answers whether it moved: not for a tab of another agent's browser,
 * nor for one another caller moved off `from` first, so of two reopening a
 * tab at once exactly one keeps its new page.
 */
export function retargetBrowserTab(
  conversationId: string,
  tabId: string,
  from: string,
  to: string,
): BrowserTabEffect<boolean> {
  return Effect.map(retargetTab({ conversationId, tabId, from, to }), (rows) => rows.length > 0);
}

/**
 * Records a tab's page as a member's live view of it saw it move, the
 * member steering it from its bar or driving it, so a browser that starts
 * afresh reopens it where it stood (`restore-tabs.ts`): its address and
 * title, cut where the Browser tab cuts them, and nothing else, its opener,
 * takeover, and last action as they stood. Answers whether the tab took it:
 * not where it no longer stands on the target named, as after a reopening
 * moved it, so a stale view's write never lands.
 */
export function noteBrowserTabPage(
  tabId: string,
  targetId: string,
  page: { readonly address: string; readonly title: string },
): BrowserTabEffect<boolean> {
  return Effect.map(
    notePageTab({ tabId, targetId, address: shown(page.address), title: shown(page.title) }),
    (rows) => rows.length > 0,
  );
}

/**
 * Records where the agent's pointer went on a tab of its browser, the
 * instant it went there standing as the tab's last action, so a member's
 * window draws it gliding there. Answers whether a kept tab took it: a tab
 * no row keeps yet, one this call just opened, is drawn by no window, so
 * its move is dropped, and a move older than the one the tab holds, a write
 * that landed late beside another call's, is dropped too, so the pointer
 * and the tab's last action never go back. Note that it is one write, with
 * no read before it.
 */
export function pointBrowserTab(
  conversationId: string,
  move: BrowserCursorMove,
): BrowserTabEffect<boolean> {
  return Effect.map(
    pointTab({
      conversationId,
      targetId: move.tab,
      x: move.x,
      y: move.y,
      kind: move.kind,
      // Note that a visible page's size is whole CSS pixels, as the browser reports it.
      width: Math.round(move.viewport.width),
      height: Math.round(move.viewport.height),
      at: new Date(move.at),
    }),
    (rows) => rows.length > 0,
  );
}

/** Deletes a tab its agent closed, answering whether the agent's browser held it. */
export function closeBrowserTab(conversationId: string, tabId: string): BrowserTabEffect<boolean> {
  return Effect.map(deleteTab({ conversationId, tabId }), (rows) => rows.length > 0);
}

/**
 * Makes the member the tab's driver until the instant given, answering
 * whether they now drive it: taken where no one drove it or the driver's
 * takeover had lapsed at `now`, and moved on, never back, where they drove
 * it already;
 * a tab another member drives stays theirs. Reaching the tab is the
 * caller's to have checked.
 */
export function takeOverBrowserTab(
  tabId: string,
  userId: string,
  heldUntil: Date,
  now: Date,
): BrowserTabEffect<boolean> {
  return Effect.map(takeTab({ tabId, userId, heldUntil, now }), (rows) => rows.length > 0);
}

/** Moves the member's own takeover, still standing at `now`, on to the instant given, never back; answers whether it stood. */
export function renewBrowserTabTakeover(
  tabId: string,
  userId: string,
  heldUntil: Date,
  now: Date,
): BrowserTabEffect<boolean> {
  return Effect.map(renewTab({ tabId, userId, heldUntil, now }), (rows) => rows.length > 0);
}

/** Hands the tab back to its agent where the member drives it, answering whether they did; another member's takeover stands. */
export function handBackBrowserTab(tabId: string, userId: string): BrowserTabEffect<boolean> {
  return Effect.map(releaseTab({ tabId, userId }), (rows) => rows.length > 0);
}

/**
 * One task's tabs written for Neon Realtime, so a member's window follows
 * them, the agent's pointer among them, as they move: each tab
 * `listTaskBrowserTabs` lists the account, under the same rule of who may
 * read it, every column under the key the wire's tab line reads it by
 * (`@luke/features/agent-browser-tab-wire`'s `agentBrowserTabLineSchema`)
 * and every instant in epoch milliseconds. The account is joined through its
 * membership of the task's workspace, as Neon's guide authorizes a live
 * read. It reads no clock, as Realtime requires, so a takeover past its
 * instant is delivered as it stands and lapsed by the reader, and keeps no
 * order, which the reader keeps. None where a value cannot be carried, which
 * a caller answers as the tabs not being live.
 */
export function taskBrowserTabsLiveStatement(
  userId: string,
  taskId: string,
): Option.Option<LiveStatement> {
  return liveStatementOf(
    queryBuilder
      .select(
        liveSelection(
          {
            id: agentBrowserTab.id,
            agentId: codingAgent.id,
            address: agentBrowserTab.address,
            title: agentBrowserTab.title,
            openedBy: agentBrowserTab.openedBy,
            openedByUserId: agentBrowserTab.openedByUserId,
            driverUserId: agentBrowserTab.driverUserId,
            cursorX: agentBrowserTab.cursorX,
            cursorY: agentBrowserTab.cursorY,
            cursorKind: agentBrowserTab.cursorKind,
            cursorViewportW: agentBrowserTab.cursorViewportW,
            cursorViewportH: agentBrowserTab.cursorViewportH,
          },
          {
            heldUntil: agentBrowserTab.heldUntil,
            createdAt: agentBrowserTab.createdAt,
            lastActedAt: agentBrowserTab.lastActedAt,
            cursorAt: agentBrowserTab.cursorAt,
          },
        ),
      )
      .from(agentBrowserTab)
      .innerJoin(task, eq(task.id, agentBrowserTab.taskId))
      .innerJoin(
        member,
        and(eq(member.organizationId, task.organizationId), eq(member.userId, userId)),
      )
      // Note that a tab no coding agent's conversation names is listed to no one, as the held list reads it.
      .innerJoin(codingAgent, eq(codingAgent.conversationId, agentBrowserTab.conversationId))
      .where(and(eq(agentBrowserTab.taskId, taskId), taskSeenBy(userId), agentReachableBy(userId))),
  );
}
