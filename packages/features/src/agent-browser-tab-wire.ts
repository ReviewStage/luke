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
 */

import { Schema as EffectSchema } from "effect";
import { BROWSER_SHOWN_MAX_CHARS } from "./browser-acts.js";
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
});

export type AgentBrowserTab = typeof agentBrowserTabSchema.Type;

/** A task's tabs, every agent's, the oldest first (GET). */
export const agentBrowserTabsAnswerSchema = EffectSchema.Struct({
  tabs: EffectSchema.Array(agentBrowserTabSchema),
});

/** One tab as it stands after a takeover, a renewal, or a hand-back (POST, DELETE). */
export const agentBrowserTabAnswerSchema = EffectSchema.Struct({ tab: agentBrowserTabSchema });
