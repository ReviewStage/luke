/**
 * send-queue.ts -- sends keyed by whom they go to, each going once the one before it under the same key has answered.
 *
 * A message box takes the next message the moment the one before it leaves
 * it, and nothing holds it while the service answers, so several may be on
 * their way at once. The service writes a message and hands it on under its
 * conversation's lock, so two out at once would be taken in either order;
 * the queue keeps one key's sends in the order they were asked, each
 * starting once the one before it has answered. The key is whatever the
 * service locks on, an agent's id, an Inbox item's, or a plan comment
 * thread's, so sends under different keys never wait on each other. The
 * agent's box (`tasks/use-agent-composer.ts`), the Inbox's thread box
 * (`tasks/use-task-inbox.ts`), and a plan comment thread's reply field
 * (`tasks/plan-comments.tsx`) send through it; what each draws of a send on
 * its way, or of one that did not go, is its own.
 *
 * A send answers however it went and never throws: each box catches every
 * refusal and marks its own line, so the chain under a key is the sends
 * themselves. One that threw would stop every send asked behind it, and say
 * so as an unhandled rejection.
 */

import { useState } from "react";

/** Sends keyed by whom they go to, one key's going one at a time in the order asked. */
export interface SendQueue {
  /** Runs `send` once every send asked under `key` before it has answered; the answer is `send`'s own to take. */
  readonly after: (key: string, send: () => Promise<void>) => void;
  /** Settles once every send asked under `key` so far has answered, however it did, which work that must not go ahead of them waits for. */
  readonly settled: (key: string) => Promise<void>;
}

/** Nothing, in place of a send's answer or throw, so a wait on the queue settles either way. */
function done(): undefined {
  return undefined;
}

/** A send queue of its own, which a component holds through `useSendQueue`. */
function sendQueue(): SendQueue {
  // Each key's newest send, which the next under it waits on. Note that a key's
  // answered send is kept, a settled promise, since a key is an agent's or an
  // item's id and a session meets few.
  const newest = new Map<string, Promise<void>>();
  return {
    after: (key, send) => {
      const before = newest.get(key) ?? Promise.resolve();
      newest.set(key, before.then(send));
    },
    settled: (key) => (newest.get(key) ?? Promise.resolve()).then(done, done),
  };
}

/** A send queue held for as long as the component that sends through it is mounted. */
export function useSendQueue(): SendQueue {
  const [queue] = useState(sendQueue);
  return queue;
}
