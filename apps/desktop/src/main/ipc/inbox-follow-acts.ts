/**
 * inbox-follow-acts.ts -- a plan's or an agent's inbox followed for the panels that draw it, and each change pushed to those panels alone.
 *
 * A panel says which inboxes it draws, one follow per plan or agent, and
 * lets each go when it stops; the host follows each inbox while any panel
 * does (over Neon Realtime where the service seals it, by the held read
 * where it does not) and tells main every change, which is sent on to the
 * panels following it and to no other window. A panel may follow the same
 * inbox from several places at once, so its follows are counted, and the
 * inbox is let go at the host once no panel holds a follow of it. A panel
 * that follows an inbox another already holds is sent the inbox as it last
 * stood, at once; one that follows an inbox whose last word was that it
 * could not be read has the host follow it again, which is how Try again
 * asks. A panel whose page is gone lets go of everything it followed.
 *
 * What is kept here is the last word of each followed inbox, which only
 * the panels following it are sent, and nothing once no panel follows it.
 */

import type {
  CodingAgentInboxChanged,
  CodingAgentInboxScope,
} from "@luke/features/coding-agent-view";
import { ACT, ACT_KIND } from "@luke/host/acts";
import type { HostOperator } from "@luke/host/host-operator";
import { Effect } from "effect";
import type { WebContents } from "electron";
import { ActRefused, type ActRows, type ActSender } from "../act-router";

type InboxFollowActKind =
  | typeof ACT_KIND.CODING_AGENTS_INBOX_FOLLOW
  | typeof ACT_KIND.CODING_AGENTS_INBOX_UNFOLLOW;

type ScopeKind = CodingAgentInboxScope["kind"];

export interface InboxFollowActsDependencies {
  host: Pick<
    HostOperator,
    "codingAgentInboxFollow" | "codingAgentInboxUnfollow" | "onInboxChanged"
  >;
  /** Sends one panel the inbox as it now stands. */
  deliver: (sender: WebContents, changed: CodingAgentInboxChanged) => void;
  /** Calls `then` once, when the panel's page is gone. */
  whenGone: (sender: WebContents, then: () => void) => void;
  /** Runs what a page's end asks of the host, from the page's own callback. */
  run: <A>(effect: Effect.Effect<A>) => Promise<A>;
}

/** One followed inbox: how many follows each panel holds of it, and its last word, once there is one. */
interface Followed {
  readonly panels: Map<WebContents, number>;
  last: CodingAgentInboxChanged | undefined;
}

/** The refusal a window that draws no inbox hears, in its kind's own words. */
function refuseUnlessPanel(kind: InboxFollowActKind, sender: ActSender): void {
  if (!sender.panel) throw new ActRefused({ message: ACT[kind].refusal });
}

export function inboxFollowActRows(
  dependencies: InboxFollowActsDependencies,
): Pick<ActRows, InboxFollowActKind> {
  const { host, deliver, whenGone, run } = dependencies;
  /** Every followed inbox, by its kind and then its id. */
  const followed = new Map<ScopeKind, Map<string, Followed>>();
  /** The panels whose page's end is watched, so it is watched once. */
  const watched = new Set<WebContents>();

  host.onInboxChanged((changed) => {
    const held = followed.get(changed.scope.kind)?.get(changed.scope.id);
    if (held === undefined) return;
    held.last = changed;
    for (const panel of held.panels.keys()) deliver(panel, changed);
  });

  /** One follow of the panel's let go, and the inbox let go at the host once no panel holds one. */
  const release = (scope: CodingAgentInboxScope, panel: WebContents, all: boolean) =>
    Effect.suspend(() => {
      const byId = followed.get(scope.kind);
      const held = byId?.get(scope.id);
      const count = held?.panels.get(panel);
      if (byId === undefined || held === undefined || count === undefined) return Effect.void;
      if (all || count === 1) held.panels.delete(panel);
      else held.panels.set(panel, count - 1);
      if (held.panels.size > 0) return Effect.void;
      byId.delete(scope.id);
      return host.codingAgentInboxUnfollow(scope);
    });

  /** Everything the panel followed let go, as its page is gone. */
  const gone = (panel: WebContents) => {
    watched.delete(panel);
    const scopes = [...followed].flatMap(([kind, byId]) =>
      [...byId].flatMap(([id, held]) => (held.panels.has(panel) ? [{ kind, id }] : [])),
    );
    void run(Effect.forEach(scopes, (scope) => release(scope, panel, true), { discard: true }));
  };

  return {
    [ACT_KIND.CODING_AGENTS_INBOX_FOLLOW]: (scope, sender) => {
      refuseUnlessPanel(ACT_KIND.CODING_AGENTS_INBOX_FOLLOW, sender);
      const panel = sender.sender;
      if (!watched.has(panel)) {
        watched.add(panel);
        whenGone(panel, () => gone(panel));
      }
      const byId = followed.get(scope.kind) ?? new Map<string, Followed>();
      followed.set(scope.kind, byId);
      const held = byId.get(scope.id) ?? {
        panels: new Map<WebContents, number>(),
        last: undefined,
      };
      byId.set(scope.id, held);
      const first = held.panels.size === 0;
      held.panels.set(panel, (held.panels.get(panel) ?? 0) + 1);
      const { last } = held;
      // Note that a follow of an inbox whose last word was a failure asks the host again, as Try again means it to.
      if (first || (last !== undefined && "failure" in last.inbox)) {
        held.last = undefined;
        return host.codingAgentInboxFollow(scope);
      }
      if (last !== undefined) deliver(panel, last);
      return Effect.void;
    },
    [ACT_KIND.CODING_AGENTS_INBOX_UNFOLLOW]: (scope, sender) => {
      refuseUnlessPanel(ACT_KIND.CODING_AGENTS_INBOX_UNFOLLOW, sender);
      return release(scope, sender.sender, false);
    },
  };
}
