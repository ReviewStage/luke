/**
 * client-notices.ts -- the agent notices as a client links them: read from the document and the host, written back into the document, and shown through the doors and the presenter the platform hands in.
 */
import { ACCOUNT_STATUS, type AccountSnapshot } from "@luke/credentials/snapshot";
import type { CodingAgentAccountInboxAnswerView } from "@luke/features/coding-agent-view";
import { APP_SETTING_SCHEMA, EXPERIMENT, experimentOn, NO_EXPERIMENTS } from "@luke/settings";
import { Effect, FiberSet, Queue, type Scope, Stream } from "effect";
import {
  type AgentNoticeDoors,
  type AgentNotices,
  type AgentNoticesDependencies,
  createAgentNotices,
  noticeTaskTitle,
} from "../agent-notices.js";
import type { HostOperator } from "../host-operator.js";
import type { AppStateStore } from "./app-state-store.js";

/** Where a notice's click takes the developer, as the platform brings its window forward on it. */
type NoticePresenter = Pick<
  AgentNoticesDependencies,
  "open" | "openInbox" | "openTasklessItem" | "openFailedRun" | "openChat"
>;

/** The host's methods the notices read and refresh through. */
type NoticeHost = Pick<
  HostOperator,
  | "codingAgentList"
  | "codingAgentPage"
  | "codingAgentPullRequest"
  | "codingAgentAccountInboxFollow"
  | "codingAgentAccountInboxUnfollow"
  | "onAccountInboxChanged"
  | "onAccountChanged"
  | "tasksRefresh"
  | "workspacesRefresh"
>;

export interface ClientNoticesDependencies {
  /** The document the notices read the tasks' names from and write the unseen agents and the inbox into. */
  state: AppStateStore;
  host: NoticeHost;
  presenter: NoticePresenter;
  /** The panel coming forward or going behind, for as long as the subscription stands. */
  onPanelFocusChanged: AgentNoticesDependencies["onPanelFocusChanged"];
  report: (message: string) => void;
}

/** Whose account this is, as the host keys it, or nobody: what tells another account from the same one renewed. */
function accountKey(account: AccountSnapshot): string | undefined {
  return account.status === ACCOUNT_STATUS.SIGNED_IN ? account.email : undefined;
}

/**
 * What waits across the account, as the host tells it, followed while the
 * stream runs: heard from before the follow is asked, so its first answer is
 * never missed, and let go as the stream ends.
 */
function accountInboxOf(host: NoticeHost): Stream.Stream<CodingAgentAccountInboxAnswerView> {
  return Stream.callback<CodingAgentAccountInboxAnswerView>((queue) =>
    Effect.gen(function* () {
      yield* Effect.acquireRelease(
        Effect.sync(() => host.onAccountInboxChanged((answer) => Queue.offerUnsafe(queue, answer))),
        (unsubscribe) => Effect.sync(unsubscribe),
      );
      yield* Effect.acquireRelease(host.codingAgentAccountInboxFollow(), () =>
        host.codingAgentAccountInboxUnfollow(),
      );
    }),
  );
}

/**
 * The notices for the client's scope. They read the tasks' names from the
 * document and write the unseen agents and the waiting inbox items back into
 * it; a click brings the window forward through the presenter. Whose inbox is
 * read follows the document's account, which the launch's bootstrap writes as
 * well as every change after it. Two rules stand beside them: the agents with
 * no plan each list read carries are the notices' to hold, and a panel coming
 * forward reads the account's workspaces again.
 *
 * A refresh a callback asks for is forked into a set this scope owns, so it
 * runs on the services the client was built with and ends with the scope, and
 * a defect in one is reported, to Sentry as well as the line, rather than left
 * in a set nobody joins.
 */
export const linkClientNotices = /* @__PURE__ */ Effect.fn("client/linkClientNotices")(function* (
  dependencies: ClientNoticesDependencies,
): Effect.fn.Return<AgentNotices, never, Scope.Scope | AgentNoticeDoors> {
  const { state, host, presenter, onPanelFocusChanged, report } = dependencies;
  const fork = yield* FiberSet.makeRuntime();
  // Note that a defect is reported here, because nothing joins the set a refresh is forked into.
  const forkReported = (refresh: Effect.Effect<void>, what: string): void => {
    fork(
      Effect.catchDefect(Effect.withErrorReporting(refresh, { defectsOnly: true }), (defect) =>
        Effect.sync(() =>
          report(`${what} failed: ${defect instanceof Error ? defect.message : String(defect)}`),
        ),
      ),
    );
  };
  const notices = yield* createAgentNotices({
    readPullRequest: (agentId) => host.codingAgentPullRequest({ agentId }),
    taskName: (taskId) => noticeTaskTitle(state.snapshot().tasks, taskId),
    ...presenter,
    onUnseenChanged: (unseen) => state.update({ codingAgents: { unseen } }),
    onPanelFocusChanged,
    notifying: () =>
      state.snapshot().settings?.stored.agentNotifications ??
      APP_SETTING_SCHEMA.agentNotifications.default,
    signedInAs: () => accountKey(state.snapshot().account),
    accountId: () => {
      const { account } = state.snapshot();
      return account.status === ACCOUNT_STATUS.SIGNED_IN ? account.id : undefined;
    },
    onAccountChanged: (listener) =>
      host.onAccountChanged((account) => listener(accountKey(account))),
    followAccountInbox: () => accountInboxOf(host),
    accounts: Stream.map(state.changes, (document) => accountKey(document.account)),
    onInboxChanged: (inbox) => state.update({ inbox }),
    chatOn: () =>
      experimentOn(state.snapshot().settings?.experiments ?? NO_EXPERIMENTS, EXPERIMENT.CHAT),
    report,
  });
  // A note that throws is reported rather than left to end the fiber, which would never resume.
  yield* Effect.forkScoped(
    Stream.runForEach(
      Stream.changes(Stream.map(state.changes, (document) => document.tasks.tasklessAgents)),
      (agents) =>
        Effect.catchDefect(
          Effect.withErrorReporting(
            Effect.sync(() => notices.observeTaskless(agents ?? [])),
            { defectsOnly: true },
          ),
          (defect) =>
            Effect.sync(() =>
              report(
                `the agents with no task could not be noted: ${defect instanceof Error ? defect.message : String(defect)}`,
              ),
            ),
        ),
    ),
  );
  // Every agent on a task, while the list is followed live, is the notices'
  // to hold in place of the watch's own reads, and a task the list no longer
  // holds takes its agents with it.
  yield* Effect.forkScoped(
    Stream.runForEach(
      Stream.changes(Stream.map(state.changes, (document) => document.tasks.taskAgents)),
      (agents) =>
        Effect.catchDefect(
          Effect.sync(() => {
            if (agents === undefined) return;
            const taskIds = state.snapshot().tasks.tasks.map((each) => each.id);
            notices.observeFollowed(agents, taskIds);
          }),
          (defect) =>
            Effect.sync(() =>
              report(
                `the agents on tasks could not be noted: ${defect instanceof Error ? defect.message : String(defect)}`,
              ),
            ),
        ),
    ),
  );
  // A teammate's change or an installation made on GitHub may have moved the
  // workspaces; the host reads them no oftener than once a minute.
  yield* Effect.acquireRelease(
    Effect.sync(() =>
      onPanelFocusChanged((focused) => {
        if (focused) forkReported(host.workspacesRefresh(), "the workspaces refresh");
      }),
    ),
    (unsubscribe) => Effect.sync(unsubscribe),
  );
  return notices;
});
