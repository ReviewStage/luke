import {
  AGENT_BROWSER_TAB_OPENER,
  type BrowserTabsPlace,
} from "@repo/features/agent-browser-tab-wire";
import { BROWSER_SHOWN_MAX_CHARS } from "@repo/features/browser-acts";
import { BROWSER_CURSOR_KIND, type BrowserCursorMove } from "@repo/features/browser-agent-actions";
import { GITHUB_ACCESS, type GitHubAccess } from "@repo/features/github-repositories-wire";
import { and, asc, eq, gt, isNull, lte, or, type SQL, sql } from "drizzle-orm";
import { DateTime, Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { type LiveStatement, liveSelection, liveStatementOf } from "../core/live-statement.js";
import { Database, type DatabaseServices, queryBuilder, type StoreFailure } from "../core/query.js";
import { agentTable } from "../schemas/agent.js";
import { agentBrowserTab } from "../schemas/agent-browser-tab.js";
import { member } from "../schemas/auth.js";
import { task } from "../schemas/task.js";
import { InstantColumnSchema } from "./columns.js";
import { agentVisibleTo, reachableTask } from "./workspace-store.js";

type BrowserTabEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

const OPENERS = Object.values(AGENT_BROWSER_TAB_OPENER);

const GITHUB_ACCESSES = Object.values(GITHUB_ACCESS);

const CURSOR_KINDS = Object.values(BROWSER_CURSOR_KIND);

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

interface BrowserTabAgent {
  readonly id: string;
  readonly userId: string;
  readonly githubAccess: GitHubAccess;
}

export interface ReachedBrowserTab {
  readonly tab: AgentBrowserTabRow;
  readonly agent: BrowserTabAgent;
}

export interface BrowserTabAction {
  readonly conversationId: string;
  readonly targetId: string;
  readonly address: string;
  readonly title: string;
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

function shown(text: string): string {
  return text.length > BROWSER_SHOWN_MAX_CHARS ? text.slice(0, BROWSER_SHOWN_MAX_CHARS) : text;
}

function taskOfConversation(conversationId: string) {
  return sql<
    string | null
  >`(select ${agentTable.taskId} from ${agentTable} where ${agentTable.conversationId} = ${conversationId})`;
}

function agentOfPlace(place: BrowserTabsPlace): SQL {
  return "taskId" in place ? eq(agentTable.taskId, place.taskId) : eq(agentTable.id, place.agentId);
}

function reachedTabs(userId: string, place: BrowserTabsPlace, tabId?: string) {
  return Database.use((db) =>
    db
      .select({
        ...tabColumns,
        agentId: agentTable.id,
        agentUserId: agentTable.userId,
        agentGithubAccess: agentTable.githubAccess,
      })
      .from(agentBrowserTab)
      .innerJoin(agentTable, eq(agentTable.conversationId, agentBrowserTab.conversationId))
      .where(
        and(
          agentOfPlace(place),
          tabId === undefined ? undefined : eq(agentBrowserTab.id, tabId),
          agentVisibleTo(userId),
        ),
      )
      .orderBy(asc(agentBrowserTab.createdAt), asc(agentBrowserTab.id)),
  );
}

const PlaceSchema = Schema.Union([
  Schema.Struct({ taskId: Schema.String }),
  Schema.Struct({ agentId: Schema.String }),
]);

const findReachedTabs = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    place: PlaceSchema,
    tabId: Schema.optionalKey(Schema.String),
  }),
  Result: ReachedTabSchema,
  execute: ({ userId, place, tabId }) => reachedTabs(userId, place, tabId),
});

const findReachableTask = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, taskId: Schema.String }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, taskId }) =>
    Database.use((db) =>
      db.select({ id: task.id }).from(task).where(reachableTask(userId, taskId)),
    ),
});

const findReachableAgent = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, agentId: Schema.String }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, agentId }) =>
    Database.use((db) =>
      db
        .select({ id: agentTable.id })
        .from(agentTable)
        .where(and(eq(agentTable.id, agentId), agentVisibleTo(userId))),
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
        .where(and(eq(agentBrowserTab.id, tabId), eq(agentBrowserTab.targetId, targetId)))
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
          heldUntil: sql`case when ${agentBrowserTab.driverUserId} = ${userId} and ${agentBrowserTab.heldUntil} > ${now} then greatest(${agentBrowserTab.heldUntil}, ${heldUntil}) else ${heldUntil}::timestamptz end`,
        })
        .where(
          and(
            eq(agentBrowserTab.id, tabId),
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

function reachedOf(row: typeof ReachedTabSchema.Type): ReachedBrowserTab {
  const { agentId, agentUserId, agentGithubAccess, ...tab } = row;
  return { tab, agent: { id: agentId, userId: agentUserId, githubAccess: agentGithubAccess } };
}

export function browserTabDriver(
  tab: Pick<AgentBrowserTabRow, "driverUserId" | "heldUntil">,
  now: Date,
): { readonly userId: string; readonly heldUntil: Date } | null {
  if (tab.driverUserId === null || tab.heldUntil === null) return null;
  if (tab.heldUntil.getTime() <= now.getTime()) return null;
  return { userId: tab.driverUserId, heldUntil: tab.heldUntil };
}

export function listBrowserTabs(
  userId: string,
  place: BrowserTabsPlace,
): BrowserTabEffect<Option.Option<readonly ReachedBrowserTab[]>> {
  return Effect.gen(function* () {
    const reached =
      "taskId" in place
        ? yield* findReachableTask({ userId, taskId: place.taskId })
        : yield* findReachableAgent({ userId, agentId: place.agentId });
    if (reached.length === 0) return Option.none();
    const rows = yield* findReachedTabs({ userId, place });
    return Option.some(rows.map(reachedOf));
  });
}

export function readBrowserTab(
  userId: string,
  place: BrowserTabsPlace,
  tabId: string,
): BrowserTabEffect<Option.Option<ReachedBrowserTab>> {
  return Effect.map(findReachedTabs({ userId, place, tabId }), (rows) =>
    Option.map(Option.fromNullishOr(rows[0]), reachedOf),
  );
}

export function listAgentBrowserTabs(
  conversationId: string,
): BrowserTabEffect<readonly AgentBrowserTabRow[]> {
  return findAgentTabs({ conversationId });
}

export function upsertBrowserTab(action: BrowserTabAction): BrowserTabEffect<AgentBrowserTabRow> {
  return writeTab(action, false);
}

export function recordMemberOpenedBrowserTab(
  tab: Omit<BrowserTabAction, "openedBy"> & { readonly userId: string },
): BrowserTabEffect<AgentBrowserTabRow> {
  const { userId, ...page } = tab;
  return writeTab({ ...page, openedBy: { kind: AGENT_BROWSER_TAB_OPENER.MEMBER, userId } }, true);
}

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
    }).pipe(Effect.catchTag("NoSuchElementError", (missing) => Effect.die(missing)));
  });
}

export function retargetBrowserTab(
  conversationId: string,
  tabId: string,
  from: string,
  to: string,
): BrowserTabEffect<boolean> {
  return Effect.map(retargetTab({ conversationId, tabId, from, to }), (rows) => rows.length > 0);
}

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
      width: Math.round(move.viewport.width),
      height: Math.round(move.viewport.height),
      at: new Date(move.at),
    }),
    (rows) => rows.length > 0,
  );
}

export function closeBrowserTab(conversationId: string, tabId: string): BrowserTabEffect<boolean> {
  return Effect.map(deleteTab({ conversationId, tabId }), (rows) => rows.length > 0);
}

export function takeOverBrowserTab(
  tabId: string,
  userId: string,
  heldUntil: Date,
  now: Date,
): BrowserTabEffect<boolean> {
  return Effect.map(takeTab({ tabId, userId, heldUntil, now }), (rows) => rows.length > 0);
}

export function renewBrowserTabTakeover(
  tabId: string,
  userId: string,
  heldUntil: Date,
  now: Date,
): BrowserTabEffect<boolean> {
  return Effect.map(renewTab({ tabId, userId, heldUntil, now }), (rows) => rows.length > 0);
}

export function handBackBrowserTab(tabId: string, userId: string): BrowserTabEffect<boolean> {
  return Effect.map(releaseTab({ tabId, userId }), (rows) => rows.length > 0);
}

export function browserTabsLiveStatement(
  userId: string,
  place: BrowserTabsPlace,
): Option.Option<LiveStatement> {
  return liveStatementOf(
    queryBuilder
      .select(
        liveSelection(
          {
            id: agentBrowserTab.id,
            agentId: agentTable.id,
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
      .innerJoin(agentTable, eq(agentTable.conversationId, agentBrowserTab.conversationId))
      .innerJoin(
        member,
        and(eq(member.organizationId, agentTable.organizationId), eq(member.userId, userId)),
      )
      .where(and(agentOfPlace(place), agentVisibleTo(userId))),
  );
}
