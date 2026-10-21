/**
 * agent-browser-tabs.ts -- the Browser tabs open in agents' browsers: an agent's actions write them, and a task's members list them and take one over.
 *
 * An agent is named here by its own conversation, the one its sandbox is
 * kept for (`schemas/agent-browser-tab.ts`): a coding agent's, or the task's
 * for Luke, and a worker writes under its parent's. The agent's side, an
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
 */

import { AGENT_BROWSER_TAB_OPENER } from "@luke/features/agent-browser-tab-wire";
import { BROWSER_SHOWN_MAX_CHARS } from "@luke/features/browser-acts";
import { GITHUB_ACCESS, type GitHubAccess } from "@luke/features/github-repositories-wire";
import { and, asc, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import { DateTime, Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type QueryError } from "../core/query.js";
import { agentBrowserTab } from "../schemas/agent-browser-tab.js";
import { codingAgent } from "../schemas/coding-agent.js";
import { task } from "../schemas/task.js";
import { InstantColumnSchema } from "./columns.js";
import { agentReachableBy, reachableTask, taskReachableBy } from "./workspace-store.js";

type BrowserTabFailure = QueryError | Schema.SchemaError;

type BrowserTabEffect<A> = Effect.Effect<A, BrowserTabFailure, DatabaseServices>;

const OPENERS = Object.values(AGENT_BROWSER_TAB_OPENER);

const GITHUB_ACCESSES = Object.values(GITHUB_ACCESS);

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
});

export type AgentBrowserTabRow = typeof BrowserTabSchema.Type;

/** The coding agent whose browser holds a tab, as the rule for who may drive it reads it. */
interface BrowserTabAgent {
  readonly id: string;
  /** The member who started the agent. */
  readonly userId: string;
  readonly githubAccess: GitHubAccess;
}

/** A tab a member reached: its row, and the coding agent whose browser holds it, null for the task's Luke. */
export interface ReachedBrowserTab {
  readonly tab: AgentBrowserTabRow;
  readonly agent: BrowserTabAgent | null;
}

/** A tab as an agent's action on it reports it: whose browser, its task, the browser's own id for it, and how its page stands. */
export interface BrowserTabAction {
  /** The conversation of the agent whose browser holds it: a coding agent's, the task's for Luke, a worker's parent's. */
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
};

const ReachedTabSchema = Schema.Struct({
  ...BrowserTabSchema.fields,
  agentId: Schema.NullOr(Schema.String),
  agentUserId: Schema.NullOr(Schema.String),
  agentGithubAccess: Schema.NullOr(Schema.Literals(GITHUB_ACCESSES)),
});

/** An address or a title cut where the Browser tab cuts one, since it is only drawn. */
function shown(text: string): string {
  return text.length > BROWSER_SHOWN_MAX_CHARS ? text.slice(0, BROWSER_SHOWN_MAX_CHARS) : text;
}

/**
 * The task of the agent whose conversation is named, read from the agent's
 * own row rather than taken from the caller: a coding agent's task, or the
 * task whose Luke the conversation is; null for an agent on none. So a tab
 * is never listed on a task its agent is not on.
 */
function taskOfConversation(conversationId: string) {
  return sql<string | null>`coalesce(
  (select ${codingAgent.taskId} from ${codingAgent} where ${codingAgent.conversationId} = ${conversationId}),
  (select ${task.id} from ${task} where ${task.conversationId} = ${conversationId})
)`;
}

/**
 * The tabs a member reaches: on a task they reach, and, for a coding
 * agent's, of an agent they see; the task's Luke has no agent row, and its
 * tabs are the task's.
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
      .leftJoin(codingAgent, eq(codingAgent.conversationId, agentBrowserTab.conversationId))
      .where(
        and(
          eq(agentBrowserTab.taskId, taskId),
          tabId === undefined ? undefined : eq(agentBrowserTab.id, tabId),
          taskReachableBy(userId),
          or(isNull(codingAgent.id), agentReachableBy(userId)),
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
    now: Schema.Date,
  }),
  Result: BrowserTabSchema,
  execute: ({ now, ...tab }) =>
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
          // Who opened it and when stand from its first report; the page and the instant move on.
          set: { address: tab.address, title: tab.title, lastActedAt: now },
        })
        .returning(tabColumns),
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
    targetId: Schema.String,
  }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ conversationId, tabId, targetId }) =>
    Database.use((db) =>
      db
        .update(agentBrowserTab)
        .set({ targetId })
        .where(
          and(eq(agentBrowserTab.id, tabId), eq(agentBrowserTab.conversationId, conversationId)),
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
  const agent =
    agentId === null || agentUserId === null || agentGithubAccess === null
      ? null
      : { id: agentId, userId: agentUserId, githubAccess: agentGithubAccess };
  return { tab, agent };
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
      now,
    }).pipe(
      // An upsert that returned no row is the database breaking its own contract, not an outcome.
      Effect.catchTag("NoSuchElementError", (missing) => Effect.die(missing)),
    );
  });
}

/**
 * Moves a tab of the agent's onto the target its browser reopened it as,
 * once a resumed sandbox's browser started without its pages: the same tab,
 * by its id, with its page, opener, takeover, and instants as they stood.
 * Answers whether the agent's browser held it.
 */
export function retargetBrowserTab(
  conversationId: string,
  tabId: string,
  targetId: string,
): BrowserTabEffect<boolean> {
  return Effect.map(retargetTab({ conversationId, tabId, targetId }), (rows) => rows.length > 0);
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
