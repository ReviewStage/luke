import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { ISSUE_CALL_FAILURE } from "@luke/features/issue-view";
import { ACT, ACT_KIND, ACT_OUTCOME_STATUS } from "@luke/host/acts";
import { Effect } from "effect";
import type { WebContents } from "electron";
import { type ActRows, type ActSender, createActRouter } from "../act-router";
import { type IssueActsDependencies, issueActRows } from "./issue-acts";

/**
 * The Issues page's acts: only a panel asks, the voice and call windows are
 * refused in each kind's own words before the host is asked, and a panel's
 * ask reaches the host with its payload as the panel sent it.
 */

// SAFETY: the router reads the sender by identity alone; one inert object is one window.
const SENDER = {} as WebContents;

const PANEL: ActSender = { sender: SENDER, panel: true, voice: false, call: false };
const VOICE: ActSender = { ...PANEL, panel: false, voice: true };
const CALL: ActSender = { ...PANEL, panel: false, call: true };

const ISSUE_ID = "3f0e6f5c-7d1a-4f6e-9a55-1b2c3d4e5f60";
const WORKSPACE_ID = "workspace-1";

type HostAsk = IssueActsDependencies["host"];

/** The params any one of the host's issue asks takes. */
type IssueParams = Parameters<HostAsk[keyof HostAsk]>[0];

function fixture() {
  const asked: unknown[] = [];
  const unanswered = (name: string) => (params: IssueParams) =>
    Effect.sync(() => {
      asked.push([name, params]);
      return { failure: ISSUE_CALL_FAILURE.UNANSWERED };
    });
  const rows = issueActRows({
    host: {
      issueList: unanswered("list"),
      issueRead: unanswered("read"),
      issueCreate: unanswered("create"),
      issueChange: unanswered("change"),
    },
  });
  // SAFETY: the router dispatches on the kind alone; the rows under test are the only ones reached.
  const router = createActRouter(rows as ActRows);
  return { router, asked };
}

const ACTS = [
  { kind: ACT_KIND.ISSUES_LIST, payload: { workspaceId: WORKSPACE_ID } },
  { kind: ACT_KIND.ISSUES_READ, payload: { issueId: ISSUE_ID } },
  { kind: ACT_KIND.ISSUES_CREATE, payload: { workspaceId: WORKSPACE_ID, title: "Bug" } },
  { kind: ACT_KIND.ISSUES_CHANGE, payload: { issueId: ISSUE_ID, change: { title: "Bug" } } },
] as const;

it.effect(
  "the voice and call windows are refused every issue act in the kind's own words, and the host is not asked",
  () =>
    Effect.gen(function* () {
      const { router, asked } = fixture();

      for (const sender of [VOICE, CALL]) {
        for (const act of ACTS) {
          assert.deepEqual(yield* router.performAct(act, sender), {
            status: ACT_OUTCOME_STATUS.REFUSED,
            reason: ACT[act.kind].refusal,
          });
        }
      }
      assert.deepEqual(asked, []);
    }),
);

it.effect(
  "a panel's ask reaches the host with its payload, and the host's answer is the panel's",
  () =>
    Effect.gen(function* () {
      const { router, asked } = fixture();

      const outcomes = [];
      for (const act of ACTS) outcomes.push(yield* router.performAct(act, PANEL));

      for (const outcome of outcomes) {
        assert.deepEqual(outcome, {
          status: ACT_OUTCOME_STATUS.DONE,
          value: { failure: ISSUE_CALL_FAILURE.UNANSWERED },
        });
      }
      assert.deepEqual(
        asked,
        ACTS.map((act, index) => [["list", "read", "create", "change"][index], act.payload]),
      );
    }),
);
