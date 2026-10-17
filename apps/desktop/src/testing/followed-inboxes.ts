/**
 * followed-inboxes.ts -- what a test of a surface that draws an inbox stands on: main's side of the window's follows, answering each follow and unfollow and pushing on `app:inbox` the inbox the test holds for the plan or agent followed.
 */

import type {
  CodingAgentInboxChanged,
  CodingAgentInboxScope,
} from "@luke/features/coding-agent-view";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act, type ActOutcome } from "@luke/host/acts";
import type { InboxFollower } from "../renderer/tasks/use-followed-inboxes";

type Inbox = CodingAgentInboxChanged["inbox"];

/**
 * Main's follows for one window: `inboxOf` says what a followed inbox holds,
 * pushed a moment after its follow as main pushes it, or nothing yet where
 * it says nothing; `push` pushes a change of one the window follows.
 */
export function followedInboxes(inboxOf: (scope: CodingAgentInboxScope) => Inbox | undefined) {
  const listeners = new Set<(changed: CodingAgentInboxChanged) => void>();
  /** How many follows the window holds of each inbox, by kind and then id. */
  const held = new Map<CodingAgentInboxScope["kind"], Map<string, number>>();
  /** Every follow the window asked for, in order, as `kind:id`. */
  const asked: string[] = [];
  const isFollowed = (scope: CodingAgentInboxScope) =>
    (held.get(scope.kind)?.get(scope.id) ?? 0) > 0;
  const push = (scope: CodingAgentInboxScope, inbox: Inbox) => {
    if (!isFollowed(scope)) return;
    for (const listener of listeners) listener({ scope, inbox });
  };
  const count = (scope: CodingAgentInboxScope, by: number) => {
    const byId = held.get(scope.kind) ?? new Map<string, number>();
    held.set(scope.kind, byId);
    byId.set(scope.id, Math.max(0, (byId.get(scope.id) ?? 0) + by));
  };
  const done: ActOutcome = { status: ACT_OUTCOME_STATUS.DONE, value: undefined };
  const onInbox = (listener: (changed: CodingAgentInboxChanged) => void) => {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  };
  const follow = (scope: CodingAgentInboxScope) => {
    asked.push(`${scope.kind}:${scope.id}`);
    count(scope, 1);
    void Promise.resolve().then(() => {
      const inbox = inboxOf(scope);
      if (inbox !== undefined) push(scope, inbox);
    });
  };
  const unfollow = (scope: CodingAgentInboxScope) => count(scope, -1);
  return {
    asked,
    push,
    isFollowed,
    onInbox,
    /** The same follows, as a plan's agents hand the Inbox tab its follower. */
    follower: { follow, unfollow, onInbox } satisfies InboxFollower,
    /** The follow acts' outcome, or nothing for any other act, which the test answers itself. */
    act: (request: Act): Promise<ActOutcome> | undefined => {
      if (request.kind === ACT_KIND.CODING_AGENTS_INBOX_FOLLOW) {
        follow(request.payload);
        return Promise.resolve(done);
      }
      if (request.kind === ACT_KIND.CODING_AGENTS_INBOX_UNFOLLOW) {
        unfollow(request.payload);
        return Promise.resolve(done);
      }
      return undefined;
    },
  };
}
