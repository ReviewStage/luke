/**
 * agent-browser-tab-wire.ts -- the Browser tabs open in a task's agents' browsers, as the service keeps them and a member's window reads them.
 *
 * Each agent (Luke, or a coding agent, whose workers share its sandbox)
 * runs one browser in its own sandbox, and the service keeps a line for each
 * tab open in it, so every window of a task's members lists them, on any
 * client and across a relaunch. A tab says whose browser it is in, who
 * opened it, and the member driving it, where one took it over: a takeover
 * is held until an instant the member's window keeps moving on, so one whose
 * window went away lapses on its own, and two members never drive one tab
 * at once. The address and title are cut where the Browser tab cuts them
 * (`browser-acts.ts`), since they are only drawn.
 *
 * `GET /api/plans/{id}/browser-tabs` lists the task's tabs; `POST
 * /api/plans/{id}/browser-tabs/{tab}/driver` takes one over or renews the
 * caller's own takeover, and `DELETE` on that path hands it back, each
 * answering the tab as it then stands, so a takeover another member holds
 * answers their name as the driver rather than a refusal.
 *
 * A tab the agent has pointed at carries its cursor: where the agent's
 * pointer last went, in the page's CSS pixels of its visible area, what it
 * did there, that area's size so a view drawn at another scale places it,
 * and when. The window draws it over the live view, never in the page.
 */

import { Schema as EffectSchema } from "effect";
import { BROWSER_SHOWN_MAX_CHARS } from "./browser-acts.js";
import { BROWSER_CURSOR_KIND } from "./browser-agent-actions.js";
import { countedNumber, wireUuidSchema } from "./service-wire.js";

/** Who opened a tab: the agent whose browser it is in, or a member. */
export const AGENT_BROWSER_TAB_OPENER = {
  AGENT: "agent",
  MEMBER: "member",
} as const;

export type AgentBrowserTabOpener =
  (typeof AGENT_BROWSER_TAB_OPENER)[keyof typeof AGENT_BROWSER_TAB_OPENER];

/** An address or a title as a tab is drawn with it: cut, never refused, at the Browser tab's own bound. */
const shownSchema = EffectSchema.String.check(EffectSchema.isMaxLength(BROWSER_SHOWN_MAX_CHARS));

/** A member's account, by its id. */
const memberIdSchema = EffectSchema.String.check(EffectSchema.isNonEmpty());

/** Who opened a tab: its agent, or a member by their account's id, null once that account is gone. */
const agentBrowserTabOpenedBySchema = EffectSchema.Union([
  EffectSchema.Struct({ kind: EffectSchema.Literal(AGENT_BROWSER_TAB_OPENER.AGENT) }),
  EffectSchema.Struct({
    kind: EffectSchema.Literal(AGENT_BROWSER_TAB_OPENER.MEMBER),
    userId: EffectSchema.NullOr(memberIdSchema),
  }),
]);

/** The member driving a tab, and the epoch milliseconds their takeover lapses at unless their window renews it. */
const agentBrowserTabDriverSchema = EffectSchema.Struct({
  userId: memberIdSchema,
  heldUntil: countedNumber,
});

/** Where the agent's pointer last went on a tab: the point, what it did there, the visible page's size, and when, in epoch milliseconds. */
const agentBrowserTabCursorSchema = EffectSchema.Struct({
  x: EffectSchema.Finite,
  y: EffectSchema.Finite,
  kind: EffectSchema.Literals(Object.values(BROWSER_CURSOR_KIND)),
  viewport: EffectSchema.Struct({ width: countedNumber, height: countedNumber }),
  at: countedNumber,
});

type AgentBrowserTabCursor = typeof agentBrowserTabCursorSchema.Type;

/** One tab open in one of a task's agents' browsers. */
const agentBrowserTabSchema = EffectSchema.Struct({
  id: wireUuidSchema,
  /** The coding agent whose browser holds the tab; null for the task's Luke. */
  agentId: EffectSchema.NullOr(wireUuidSchema),
  address: shownSchema,
  title: shownSchema,
  openedBy: agentBrowserTabOpenedBySchema,
  /** The member driving the tab; null while the agent has it. */
  driver: EffectSchema.NullOr(agentBrowserTabDriverSchema),
  /** Epoch milliseconds the tab opened. */
  createdAt: countedNumber,
  /** Epoch milliseconds its agent last acted on it. */
  lastActedAt: countedNumber,
  /** Where the agent's pointer last went on it; absent until it first points. */
  cursor: EffectSchema.optionalKey(agentBrowserTabCursorSchema),
});

export type AgentBrowserTab = typeof agentBrowserTabSchema.Type;

/**
 * A tab as the service keeps it, every instant in epoch milliseconds and
 * every value as its column holds it: what the held list and the live read
 * (`live-wire.ts`) each build a tab from (`agentBrowserTabOf`), so the two
 * never answer one tab apart.
 */
export const agentBrowserTabLineSchema = EffectSchema.Struct({
  id: wireUuidSchema,
  /** The coding agent whose browser holds the tab. */
  agentId: wireUuidSchema,
  address: EffectSchema.String,
  title: EffectSchema.String,
  openedBy: EffectSchema.Literals(Object.values(AGENT_BROWSER_TAB_OPENER)),
  openedByUserId: EffectSchema.NullOr(EffectSchema.String),
  driverUserId: EffectSchema.NullOr(EffectSchema.String),
  heldUntil: EffectSchema.NullOr(countedNumber),
  createdAt: countedNumber,
  lastActedAt: countedNumber,
  cursorX: EffectSchema.NullOr(EffectSchema.Finite),
  cursorY: EffectSchema.NullOr(EffectSchema.Finite),
  cursorKind: EffectSchema.NullOr(EffectSchema.Literals(Object.values(BROWSER_CURSOR_KIND))),
  cursorViewportW: EffectSchema.NullOr(countedNumber),
  cursorViewportH: EffectSchema.NullOr(countedNumber),
  cursorAt: EffectSchema.NullOr(countedNumber),
});

export type AgentBrowserTabLine = typeof agentBrowserTabLineSchema.Type;

/** Where the agent's pointer last went on the tab; none until every cursor column is written. */
function cursorOfLine(line: AgentBrowserTabLine): AgentBrowserTabCursor | undefined {
  const { cursorX, cursorY, cursorKind, cursorViewportW, cursorViewportH, cursorAt } = line;
  if (cursorX === null || cursorY === null || cursorKind === null) return undefined;
  if (cursorViewportW === null || cursorViewportH === null || cursorAt === null) return undefined;
  return {
    x: cursorX,
    y: cursorY,
    kind: cursorKind,
    viewport: { width: cursorViewportW, height: cursorViewportH },
    at: cursorAt,
  };
}

/**
 * A kept tab as a member's window reads it at the instant given, in epoch
 * milliseconds: its driver only while their takeover stands then, and its
 * cursor once the agent has pointed at it. Note that a takeover lapsing
 * changes no column, so a reader that follows the rows reads them again
 * at the instant one lapses.
 */
export function agentBrowserTabOf(line: AgentBrowserTabLine, now: number): AgentBrowserTab {
  const driving =
    line.driverUserId !== null && line.heldUntil !== null && line.heldUntil > now
      ? { userId: line.driverUserId, heldUntil: line.heldUntil }
      : null;
  const cursor = cursorOfLine(line);
  return {
    id: line.id,
    agentId: line.agentId,
    address: line.address.slice(0, BROWSER_SHOWN_MAX_CHARS),
    title: line.title.slice(0, BROWSER_SHOWN_MAX_CHARS),
    openedBy:
      line.openedBy === AGENT_BROWSER_TAB_OPENER.MEMBER
        ? { kind: AGENT_BROWSER_TAB_OPENER.MEMBER, userId: line.openedByUserId }
        : { kind: AGENT_BROWSER_TAB_OPENER.AGENT },
    driver: driving,
    createdAt: line.createdAt,
    lastActedAt: line.lastActedAt,
    ...(cursor === undefined ? {} : { cursor }),
  };
}

/** A task's tabs, every agent's, the oldest first (GET). */
export const agentBrowserTabsAnswerSchema = EffectSchema.Struct({
  tabs: EffectSchema.Array(agentBrowserTabSchema),
});

/** One tab as it stands after a takeover, a renewal, or a hand-back (POST, DELETE). */
export const agentBrowserTabAnswerSchema = EffectSchema.Struct({ tab: agentBrowserTabSchema });
