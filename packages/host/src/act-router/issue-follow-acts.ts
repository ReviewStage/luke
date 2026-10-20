/**
 * issue-follow-acts.ts -- a workspace's standing issues followed for the panels that draw them, and each change pushed to those panels alone, on whichever platform holds them.
 *
 * A panel says which workspace's issues it draws, one follow per list, and
 * lets each go when it stops; the host follows each while any panel does
 * (over Neon Realtime) and tells main every change, which is sent on to the
 * panels following it and to no other window. A panel may follow the same
 * list from several places at once, so its follows are counted, and the
 * host lets it go once no panel holds a follow of it. A panel that follows
 * what another already holds is sent it as it last stood, at once; one that
 * follows what last answered a failure has the host follow it again, which
 * is how Try again asks. A panel whose page is gone lets go of everything
 * it followed.
 *
 * What is kept here is the last word of each followed list, which only its
 * followers are sent, and nothing once no panel follows it.
 */

import type { IssueFollow, IssuesFollowed } from "@luke/features/issue-view";
import { Effect } from "effect";
import { ACT, ACT_KIND } from "../acts.js";
import type { HostOperator } from "../host-operator.js";
import { ActRefused, type ActRows, type ActSender } from "./router.js";

export type IssueFollowActKind = typeof ACT_KIND.ISSUES_FOLLOW | typeof ACT_KIND.ISSUES_UNFOLLOW;

export interface IssueFollowActsDependencies<Panel> {
  host: Pick<HostOperator, "issuesFollow" | "issuesUnfollow" | "onIssuesChanged">;
  /** Sends one panel what it follows as it now stands. */
  deliver: (sender: Panel, changed: IssuesFollowed) => void;
  /** Calls `then` once, when the panel's page is gone. */
  whenGone: (sender: Panel, then: () => void) => void;
  /** Runs what a page's end asks of the host, from the page's own callback. */
  run: <A>(effect: Effect.Effect<A>) => Promise<A>;
}

/** One followed list: how many follows each panel holds of it, and its last word, once there is one. */
interface Followed<Panel> {
  readonly panels: Map<Panel, number>;
  last: IssuesFollowed | undefined;
}

/** The refusal a window that draws no Issues page hears, in its kind's own words. */
function refuseUnlessPanel<Panel>(kind: IssueFollowActKind, sender: ActSender<Panel>): void {
  if (!sender.panel) throw new ActRefused({ message: ACT[kind].refusal });
}

export function issueFollowActRows<Panel>(
  dependencies: IssueFollowActsDependencies<Panel>,
): Pick<ActRows<Panel>, IssueFollowActKind> {
  const { host, deliver, whenGone, run } = dependencies;
  /** Everything followed, by its workspace. */
  const followed = new Map<string, Followed<Panel>>();
  /** The panels whose page's end is watched, so it is watched once. */
  const watched = new Set<Panel>();

  host.onIssuesChanged((changed) => {
    const held = followed.get(changed.workspaceId);
    if (held === undefined) return;
    held.last = changed;
    for (const panel of held.panels.keys()) deliver(panel, changed);
  });

  /** One follow of the panel's let go, and the host's let go once no panel holds one. */
  const release = (scope: IssueFollow, panel: Panel, all: boolean) =>
    Effect.suspend(() => {
      const held = followed.get(scope.workspaceId);
      const count = held?.panels.get(panel);
      if (held === undefined || count === undefined) return Effect.void;
      if (all || count === 1) held.panels.delete(panel);
      else held.panels.set(panel, count - 1);
      if (held.panels.size > 0) return Effect.void;
      followed.delete(scope.workspaceId);
      return host.issuesUnfollow(scope);
    });

  /** Everything the panel followed let go, as its page is gone. */
  const gone = (panel: Panel) => {
    watched.delete(panel);
    const scopes = [...followed.entries()].flatMap(([workspaceId, held]) =>
      held.panels.has(panel) ? [{ workspaceId }] : [],
    );
    void run(Effect.forEach(scopes, (scope) => release(scope, panel, true), { discard: true }));
  };

  return {
    [ACT_KIND.ISSUES_FOLLOW]: (scope, sender) => {
      refuseUnlessPanel(ACT_KIND.ISSUES_FOLLOW, sender);
      const panel = sender.sender;
      if (!watched.has(panel)) {
        watched.add(panel);
        whenGone(panel, () => gone(panel));
      }
      const held = followed.get(scope.workspaceId) ?? { panels: new Map(), last: undefined };
      followed.set(scope.workspaceId, held);
      const first = held.panels.size === 0;
      held.panels.set(panel, (held.panels.get(panel) ?? 0) + 1);
      const { last } = held;
      // Note that a follow of what last answered a failure asks the host again, as Try again means it to.
      if (first || (last !== undefined && "failure" in last.view)) {
        held.last = undefined;
        return Effect.andThen(host.issuesUnfollow(scope), host.issuesFollow(scope));
      }
      if (last !== undefined) deliver(panel, last);
      return Effect.void;
    },
    [ACT_KIND.ISSUES_UNFOLLOW]: (scope, sender) => {
      refuseUnlessPanel(ACT_KIND.ISSUES_UNFOLLOW, sender);
      return release(scope, sender.sender, false);
    },
  };
}
