/**
 * fake-luke.ts -- a fake Luke events route for the runner's tests: it applies each sequence at most once, as the real route does, and answers each post as the test scripted.
 */

import assert from "node:assert/strict";
import { type FakeResponder, fakeHttpClientLayer } from "@luke/wire/testing";
import { Deferred, Exit } from "effect";
import type { RunnerEvent } from "../protocol.js";

/** How a fake Luke answers one post: take it, fail as a server, or fail before answering. */
export const ANSWER = {
  TAKE: "take",
  SERVER_ERROR: "server_error",
  TAKE_THEN_FAIL: "take_then_fail",
  UNREACHABLE: "unreachable",
  REFUSE: "refuse",
} as const;
export type Answer = (typeof ANSWER)[keyof typeof ANSWER];

/**
 * A fake Luke events route at `url`, numbering from `firstSequence`. A batch
 * posted again changes nothing; each post is answered as the next of
 * `answers` says, then every later one is taken; `seen` settles once an
 * applied message holds `watchFor`. `bodies` keeps every post's body as it
 * crossed the wire, for a test of what the runner never sends.
 */
export function makeFakeLuke(options: {
  readonly url: string;
  readonly firstSequence: number;
  readonly answers?: readonly Answer[] | undefined;
  readonly watchFor?: string | undefined;
}) {
  const answers = options.answers ?? [];
  const applied: RunnerEvent[] = [];
  const bearers: (string | null)[] = [];
  const bodies: string[] = [];
  let posts = 0;
  const seen = Deferred.makeUnsafe<void>();

  const respond: FakeResponder = async (url, init) => {
    assert.equal(url, options.url);
    bearers.push(new Headers(init.headers).get("authorization"));
    const answer = answers[posts] ?? ANSWER.TAKE;
    posts += 1;
    if (answer === ANSWER.UNREACHABLE) throw new Error("connection reset");
    if (answer === ANSWER.REFUSE) return new Response(null, { status: 401 });
    if (answer === ANSWER.SERVER_ERROR) return new Response(null, { status: 503 });
    const body = String(init.body);
    bodies.push(body);
    const batch: { events: RunnerEvent[] } = JSON.parse(body);
    const last = applied.at(-1)?.sequence ?? options.firstSequence - 1;
    for (const event of batch.events) {
      if (event.sequence <= last) continue;
      applied.push(event);
      const watchFor = options.watchFor;
      if (watchFor !== undefined && JSON.stringify(event.message).includes(watchFor)) {
        Deferred.doneUnsafe(seen, Exit.void);
      }
    }
    return new Response(null, { status: answer === ANSWER.TAKE_THEN_FAIL ? 500 : 204 });
  };
  return {
    layer: fakeHttpClientLayer(respond),
    applied,
    bearers,
    bodies,
    posts: () => posts,
    seen: Deferred.await(seen),
  };
}
