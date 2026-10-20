import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import type { IssueFollow, IssuesFollowed } from "@luke/features/issue-view";
import { Effect } from "effect";
import { ACT_KIND } from "../acts.js";
import { issueFollowActRows } from "./issue-follow-acts.js";
import type { ActSender } from "./router.js";

/**
 * A workspace's issues followed for the panels that draw them, as main
 * counts the follows: the host follows once however many panels follow, a
 * change reaches the panels following it alone, a panel that follows later
 * is sent the last word at once, and the host lets go only once the last
 * follow does, or the last following page is gone. Synthetic ids throughout.
 */

const SCOPE: IssueFollow = { workspaceId: "workspace-1" };

const CHANGED: IssuesFollowed = { workspaceId: SCOPE.workspaceId, view: { issues: [] } };

/** A panel, as the rows read one: by identity alone. */
interface Panel {
  readonly id: number;
}

let panels = 0;

const panelOf = (): ActSender<Panel> => ({
  sender: { id: ++panels },
  panel: true,
  voice: false,
  call: false,
});

/** A row's answer as the effect it is, whichever shape the row answered in. */
const answered = <E>(answer: Effect.Effect<void, E> | Promise<void> | void) =>
  Effect.isEffect(answer) ? answer : Effect.promise(() => Promise.resolve(answer));

function fixture() {
  const host: string[] = [];
  const delivered: [Panel, IssuesFollowed][] = [];
  const gone = new Map<Panel, () => void>();
  let publish: (changed: IssuesFollowed) => void = () => undefined;
  const rows = issueFollowActRows<Panel>({
    host: {
      issuesFollow: () => Effect.sync(() => void host.push("follow")),
      issuesUnfollow: () => Effect.sync(() => void host.push("unfollow")),
      onIssuesChanged: (listener) => {
        publish = listener;
        return () => undefined;
      },
    },
    deliver: (sender, changed) => void delivered.push([sender, changed]),
    whenGone: (sender, then) => void gone.set(sender, then),
    run: Effect.runPromise,
  });
  const follow = (panel: ActSender<Panel>) => answered(rows[ACT_KIND.ISSUES_FOLLOW](SCOPE, panel));
  const unfollow = (panel: ActSender<Panel>) =>
    answered(rows[ACT_KIND.ISSUES_UNFOLLOW](SCOPE, panel));
  return {
    host,
    delivered,
    follow,
    unfollow,
    publish: (changed: IssuesFollowed) => publish(changed),
    pageGone: (panel: ActSender<Panel>) => gone.get(panel.sender)?.(),
  };
}

it.effect(
  "the host follows once for every panel, a change reaches the panels following, and the host lets go only with the last follow",
  () =>
    Effect.gen(function* () {
      const { host, delivered, follow, unfollow, publish } = fixture();
      const one = panelOf();
      const other = panelOf();

      yield* follow(one);
      publish(CHANGED);
      yield* follow(other);
      assert.deepEqual(host, ["unfollow", "follow"], "the host follows once");
      assert.deepEqual(delivered, [
        [one.sender, CHANGED],
        [other.sender, CHANGED],
      ]);

      yield* unfollow(one);
      assert.deepEqual(host, ["unfollow", "follow"], "the other panel's follow stands");
      publish(CHANGED);
      assert.deepEqual(delivered.at(-1), [other.sender, CHANGED]);
      assert.equal(delivered.length, 3, "the panel let go hears nothing more");

      yield* unfollow(other);
      assert.deepEqual(host, ["unfollow", "follow", "unfollow"], "the last let go ends it");
    }),
);

it.effect("a page gone lets go of every follow it held, and the host with the last", () =>
  Effect.gen(function* () {
    const { host, follow, pageGone } = fixture();
    const panel = panelOf();

    yield* follow(panel);
    yield* follow(panel);
    pageGone(panel);
    yield* Effect.yieldNow;

    assert.deepEqual(host, ["unfollow", "follow", "unfollow"]);
  }),
);
