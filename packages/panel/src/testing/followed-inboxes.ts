/**
 * followed-inboxes.ts -- what a test of a surface that draws an inbox stands on: the host's side of the window's inbox streams, pushing each followed plan's or agent's inbox as the test holds it, and each change a test pushes.
 */

import type {
  CodingAgentInboxChanged,
  CodingAgentInboxScope,
} from "@luke/features/coding-agent-view";
import { AGENT_INBOX_ACT_KIND } from "@luke/host/contract";
import { AsyncIteratorClass } from "@orpc/client";
import type { InboxFollower } from "../tasks/use-followed-inboxes.js";
import type { FakeActPort } from "./app-bridge.js";

type Inbox = CodingAgentInboxChanged["inbox"];

/** One stream's listener, by the scope it follows. */
interface Listening {
  readonly scope: CodingAgentInboxScope;
  readonly hear: (inbox: Inbox) => void;
}

/**
 * The host's inbox streams for one window: `inboxOf` says what a followed
 * inbox holds, pushed a moment after it is followed as the host pushes it,
 * or nothing yet where it says nothing; `push` pushes a change of one the
 * window follows. Its procedure is spread into a test's `fakeActPort`, and
 * its follower handed where a plan's agents hand theirs.
 */
export function followedInboxes(inboxOf: (scope: CodingAgentInboxScope) => Inbox | undefined) {
  const listening = new Set<Listening>();
  /** Every follow the window asked for, in order, as `kind:id`. */
  const asked: string[] = [];
  const isFollowed = (scope: CodingAgentInboxScope) =>
    [...listening].some((each) => each.scope.kind === scope.kind && each.scope.id === scope.id);
  const push = (scope: CodingAgentInboxScope, inbox: Inbox) => {
    for (const each of [...listening]) {
      if (each.scope.kind === scope.kind && each.scope.id === scope.id) each.hear(inbox);
    }
  };
  const follower: InboxFollower = {
    follow: (scope, hear) => {
      asked.push(`${scope.kind}:${scope.id}`);
      const entry: Listening = { scope, hear };
      listening.add(entry);
      void Promise.resolve().then(() => {
        const inbox = inboxOf(scope);
        if (inbox !== undefined && listening.has(entry)) hear(inbox);
      });
      return () => void listening.delete(entry);
    },
  };
  /** The follow procedure as the act port streams it: each change heard, until the window closes the stream. */
  const procedures: Pick<FakeActPort, typeof AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX_FOLLOW> = {
    [AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX_FOLLOW]: (scope) => {
      const queued: Inbox[] = [];
      let waiting: PromiseWithResolvers<void> | undefined;
      let closed = false;
      const stop = follower.follow(scope, (inbox) => {
        queued.push(inbox);
        waiting?.resolve();
      });
      const ended = (): IteratorReturnResult<undefined> => ({ done: true, value: undefined });
      const next = async (): Promise<IteratorResult<Inbox, undefined>> => {
        while (queued.length === 0 && !closed) {
          waiting = Promise.withResolvers<void>();
          await waiting.promise;
        }
        const inbox = queued.shift();
        return inbox === undefined || closed ? ended() : { done: false, value: inbox };
      };
      return Promise.resolve(
        new AsyncIteratorClass<Inbox, undefined, void>(next, async () => {
          closed = true;
          stop();
          waiting?.resolve();
        }),
      );
    },
  };
  return { asked, push, isFollowed, follower, procedures };
}
