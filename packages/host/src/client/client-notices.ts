/**
 * client-notices.ts -- the agent notices as a client links them: read from the document and the host, written back into the document, and shown through the doors and the presenter the platform hands in.
 */
import { ACCOUNT_STATUS, type AccountSnapshot } from "@luke/credentials/snapshot";
import { APP_SETTING_SCHEMA, EXPERIMENT, experimentOn, NO_EXPERIMENTS } from "@luke/settings";
import { Effect, FiberSet, type Scope, Stream } from "effect";
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
  | "codingAgentAccountInbox"
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
 * The notices for the client's scope. They read the tasks' names from the
 * document and write the unseen agents and the waiting inbox items back into
 * it; a click brings the window forward through the presenter. Whose inbox is
 * read follows the document's account, which the launch's bootstrap writes as
 * well as every change after it. Two rules stand beside them: the agents with
 * no plan each list read carries are the notices' to hold, and a panel coming
 * forward reads the account's workspaces again.
 *
 * A refresh a callback asks for is forked into a set this scope owns, so it
 * runs on the services the client was built with and ends with the scope.
 */
export const linkClientNotices = /* @__PURE__ */ Effect.fn("client/linkClientNotices")(function* (
  dependencies: ClientNoticesDependencies,
): Effect.fn.Return<AgentNotices, never, Scope.Scope | AgentNoticeDoors> {
  const { state, host, presenter, onPanelFocusChanged, report } = dependencies;
  const fork = yield* FiberSet.makeRuntime();
  const notices = yield* createAgentNotices({
    listAgents: (planId) => host.codingAgentList({ taskId: planId }),
    readAgent: (agentId) => host.codingAgentPage({ agentId }),
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
    // An agent starting or ending, or a new pull request, is read on the sidebar's rows from the list.
    onTaskAgentsMoved: () => {
      fork(host.tasksRefresh());
    },
    readAccountInbox: (after) => host.codingAgentAccountInbox({ after }),
    accounts: Stream.map(state.changes, (document) => accountKey(document.account)),
    onInboxChanged: (inbox) => state.update({ inbox }),
    automationsOn: () =>
      experimentOn(
        state.snapshot().settings?.experiments ?? NO_EXPERIMENTS,
        EXPERIMENT.AUTOMATIONS,
      ),
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
          Effect.sync(() => notices.observeTaskless(agents ?? [])),
          (defect) =>
            Effect.sync(() =>
              report(
                `the agents with no plan could not be noted: ${defect instanceof Error ? defect.message : String(defect)}`,
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
        if (focused) fork(host.workspacesRefresh());
      }),
    ),
    (unsubscribe) => Effect.sync(unsubscribe),
  );
  return notices;
});
