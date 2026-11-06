import { Schema as EffectSchema } from "effect";
import { BROWSER_SHOWN_MAX_CHARS } from "./browser-acts.js";
import { BROWSER_CURSOR_KIND } from "./browser-agent-actions.js";
import { countedNumber, wireUuidSchema } from "./service-wire.js";

export const AGENT_BROWSER_TAB_OPENER = {
  AGENT: "agent",
  MEMBER: "member",
} as const;

export type AgentBrowserTabOpener =
  (typeof AGENT_BROWSER_TAB_OPENER)[keyof typeof AGENT_BROWSER_TAB_OPENER];

const shownSchema = EffectSchema.String.check(EffectSchema.isMaxLength(BROWSER_SHOWN_MAX_CHARS));

const memberIdSchema = EffectSchema.String.check(EffectSchema.isNonEmpty());

const agentBrowserTabOpenedBySchema = EffectSchema.Union([
  EffectSchema.Struct({ kind: EffectSchema.Literal(AGENT_BROWSER_TAB_OPENER.AGENT) }),
  EffectSchema.Struct({
    kind: EffectSchema.Literal(AGENT_BROWSER_TAB_OPENER.MEMBER),
    userId: EffectSchema.NullOr(memberIdSchema),
  }),
]);

const agentBrowserTabDriverSchema = EffectSchema.Struct({
  userId: memberIdSchema,
  heldUntil: countedNumber,
});

const agentBrowserTabCursorSchema = EffectSchema.Struct({
  x: EffectSchema.Finite,
  y: EffectSchema.Finite,
  kind: EffectSchema.Literals(Object.values(BROWSER_CURSOR_KIND)),
  viewport: EffectSchema.Struct({ width: countedNumber, height: countedNumber }),
  at: countedNumber,
});

export type AgentBrowserTabCursor = typeof agentBrowserTabCursorSchema.Type;

const agentBrowserTabSchema = EffectSchema.Struct({
  id: wireUuidSchema,
  agentId: wireUuidSchema,
  address: shownSchema,
  title: shownSchema,
  openedBy: agentBrowserTabOpenedBySchema,
  driver: EffectSchema.NullOr(agentBrowserTabDriverSchema),
  createdAt: countedNumber,
  lastActedAt: countedNumber,
  cursor: EffectSchema.optionalKey(agentBrowserTabCursorSchema),
});

export type AgentBrowserTab = typeof agentBrowserTabSchema.Type;

export const agentBrowserTabLineSchema = EffectSchema.Struct({
  id: wireUuidSchema,
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

export const agentBrowserTabsAnswerSchema = EffectSchema.Struct({
  tabs: EffectSchema.Array(agentBrowserTabSchema),
});

export const agentBrowserTabOpenRequestSchema = EffectSchema.Struct({
  agentId: EffectSchema.String,
  address: EffectSchema.String,
});

export const agentBrowserTabAddressRequestSchema = EffectSchema.Struct({
  address: EffectSchema.String,
});

export const browserTabsPlaceSchema = EffectSchema.Union([
  EffectSchema.Struct({ taskId: EffectSchema.NonEmptyString }),
  EffectSchema.Struct({ agentId: EffectSchema.NonEmptyString }),
]);

export type BrowserTabsPlace = typeof browserTabsPlaceSchema.Type;

export function browserTabsPlaceId(place: BrowserTabsPlace): string {
  return "taskId" in place ? place.taskId : place.agentId;
}

export const BROWSER_TABS_PLACE = {
  TASK: "task",
  AGENT: "agent",
} as const;

export type BrowserTabsPlaceKind = (typeof BROWSER_TABS_PLACE)[keyof typeof BROWSER_TABS_PLACE];

export function browserTabsPlaceKind(place: BrowserTabsPlace): BrowserTabsPlaceKind {
  return "taskId" in place ? BROWSER_TABS_PLACE.TASK : BROWSER_TABS_PLACE.AGENT;
}

export const agentBrowserTabAnswerSchema = EffectSchema.Struct({ tab: agentBrowserTabSchema });
