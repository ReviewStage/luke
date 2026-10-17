/**
 * automation-follow-acts.ts -- a workspace's automations, or an automation's runs, followed for the panels that draw them, and each change pushed to those panels alone.
 *
 * A panel says what it draws, one follow per list or history, and lets each
 * go when it stops; the host follows each while any panel does (over Neon
 * Realtime where the service seals it, read each minute where it does not)
 * and tells main every change, which is sent on to the panels following it
 * and to no other window. A panel may follow the same list from several
 * places at once, so its follows are counted, and the host lets it go once
 * no panel holds a follow of it. A panel that follows what another already
 * holds is sent it as it last stood, at once; one that follows what last
 * answered a failure has the host follow it again, which is how Try again
 * asks. A panel whose page is gone lets go of everything it followed.
 *
 * What is kept here is the last word of each followed list or history,
 * which only its followers are sent, and nothing once no panel follows it.
 */

import type { AutomationFollow, AutomationFollowed } from "@luke/features/automation-view";
import { ACT, ACT_KIND } from "@luke/host/acts";
import type { HostOperator } from "@luke/host/host-operator";
import { Effect } from "effect";
import type { WebContents } from "electron";
import { ActRefused, type ActRows, type ActSender } from "../act-router";

type FollowActKind = typeof ACT_KIND.AUTOMATIONS_FOLLOW | typeof ACT_KIND.AUTOMATIONS_UNFOLLOW;

type FollowKind = AutomationFollow["kind"];

export interface AutomationFollowActsDependencies {
  host: Pick<HostOperator, "automationsFollow" | "automationsUnfollow" | "onAutomationsChanged">;
  /** Sends one panel what it follows as it now stands. */
  deliver: (sender: WebContents, changed: AutomationFollowed) => void;
  /** Calls `then` once, when the panel's page is gone. */
  whenGone: (sender: WebContents, then: () => void) => void;
  /** Runs what a page's end asks of the host, from the page's own callback. */
  run: <A>(effect: Effect.Effect<A>) => Promise<A>;
}

/** One followed list or history: how many follows each panel holds of it, and its last word, once there is one. */
interface Followed {
  readonly scope: AutomationFollow;
  readonly panels: Map<WebContents, number>;
  last: AutomationFollowed | undefined;
}

/** The refusal a window that draws no Automations page hears, in its kind's own words. */
function refuseUnlessPanel(kind: FollowActKind, sender: ActSender): void {
  if (!sender.panel) throw new ActRefused({ message: ACT[kind].refusal });
}

export function automationFollowActRows(
  dependencies: AutomationFollowActsDependencies,
): Pick<ActRows, FollowActKind> {
  const { host, deliver, whenGone, run } = dependencies;
  /** Everything followed, by its kind and then its id. */
  const followed = new Map<FollowKind, Map<string, Followed>>();
  /** The panels whose page's end is watched, so it is watched once. */
  const watched = new Set<WebContents>();

  host.onAutomationsChanged((changed) => {
    const held = followed.get(changed.scope.kind)?.get(changed.scope.id);
    if (held === undefined) return;
    held.last = changed;
    for (const panel of held.panels.keys()) deliver(panel, changed);
  });

  /** One follow of the panel's let go, and the host's let go once no panel holds one. */
  const release = (scope: AutomationFollow, panel: WebContents, all: boolean) =>
    Effect.suspend(() => {
      const byId = followed.get(scope.kind);
      const held = byId?.get(scope.id);
      const count = held?.panels.get(panel);
      if (byId === undefined || held === undefined || count === undefined) return Effect.void;
      if (all || count === 1) held.panels.delete(panel);
      else held.panels.set(panel, count - 1);
      if (held.panels.size > 0) return Effect.void;
      byId.delete(scope.id);
      return host.automationsUnfollow(scope);
    });

  /** Everything the panel followed let go, as its page is gone. */
  const gone = (panel: WebContents) => {
    watched.delete(panel);
    const scopes = [...followed.values()].flatMap((byId) =>
      [...byId.values()].flatMap((held) => (held.panels.has(panel) ? [held.scope] : [])),
    );
    void run(Effect.forEach(scopes, (scope) => release(scope, panel, true), { discard: true }));
  };

  return {
    [ACT_KIND.AUTOMATIONS_FOLLOW]: (scope, sender) => {
      refuseUnlessPanel(ACT_KIND.AUTOMATIONS_FOLLOW, sender);
      const panel = sender.sender;
      if (!watched.has(panel)) {
        watched.add(panel);
        whenGone(panel, () => gone(panel));
      }
      const byId = followed.get(scope.kind) ?? new Map<string, Followed>();
      followed.set(scope.kind, byId);
      const held = byId.get(scope.id) ?? {
        scope,
        panels: new Map<WebContents, number>(),
        last: undefined,
      };
      byId.set(scope.id, held);
      const first = held.panels.size === 0;
      held.panels.set(panel, (held.panels.get(panel) ?? 0) + 1);
      const { last } = held;
      // Note that a follow of what last answered a failure asks the host again, as Try again means it to.
      if (first || (last !== undefined && "failure" in last.view)) {
        held.last = undefined;
        return Effect.andThen(host.automationsUnfollow(scope), host.automationsFollow(scope));
      }
      if (last !== undefined) deliver(panel, last);
      return Effect.void;
    },
    [ACT_KIND.AUTOMATIONS_UNFOLLOW]: (scope, sender) => {
      refuseUnlessPanel(ACT_KIND.AUTOMATIONS_UNFOLLOW, sender);
      return release(scope, sender.sender, false);
    },
  };
}
