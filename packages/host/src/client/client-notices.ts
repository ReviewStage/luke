/**
 * client-notices.ts -- the agent notices as a client links them: read from the document and the host, written back into the document, and shown through the doors and the presenter the platform hands in.
 */
import { ACCOUNT_STATUS, type AccountSnapshot } from "@luke/credentials/snapshot";
import type { CodingAgentAccountInboxAnswerView } from "@luke/features/coding-agent-view";
import { Effect, FiberSet, Queue, type Scope, Stream } from "effect";
import {
  AgentNoticeDoors,
  type AgentNotices,
  type AgentNoticesDependencies,
  createAgentNotices,
  NOTICE_KIND,
} from "../agent-notices.js";
import type { HostOperator } from "../host-operator.js";
import type { AppStateStore } from "./app-state-store.js";

/** Where a notice's click takes the developer, as the platform brings its window forward on it. */
interface NoticePresenter {
  /** Brings Luke's window forward, where the prompt for a command stands: a command ask's notification's click. */
  openMacCommandAsk: () => void;
}

/** What the notification of a command waiting says: nothing of the command, which the prompt shows. */
const MAC_COMMAND_ASK_NOTICE = {
  title: "Run a command on your Mac?",
  body: "An agent is waiting for you to allow or deny a command.",
} as const;

/** The host's methods the notices read and refresh through. */
type NoticeHost = Pick<
  HostOperator,
  | "codingAgentList"
  | "codingAgentPage"
  | "codingAgentAccountInboxFollow"
  | "codingAgentAccountInboxUnfollow"
  | "onAccountInboxChanged"
  | "onAccountChanged"
  | "tasksRefresh"
  | "workspacesRefresh"
>;

export interface ClientNoticesDependencies {
  /** The document the notices read from and write the unseen agents and the inbox into. */
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
 * The notices for the client's scope. They write the unseen agents and the
 * waiting inbox items into the document, and a command ask's notification's
 * click brings the window forward through the presenter. Whose inbox is
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
  const doors = yield* AgentNoticeDoors;
  const fork = yield* FiberSet.makeRuntime();
  let focused = false;
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
    onUnseenChanged: (unseen) => state.update({ codingAgents: { unseen } }),
    onPanelFocusChanged,
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
  // A command asked while the window is behind would otherwise wait unseen
  // until its timeout denies it, so each new ask is announced once, the one
  // notification Luke posts, since Ask every time is the developer's own ask
  // to be asked; the window in front shows the prompt itself.
  const told = new Set<string>();
  yield* Effect.forkScoped(
    Stream.runForEach(
      Stream.changes(Stream.map(state.changes, (document) => document.macCommands.asks)),
      (asks) =>
        Effect.sync(() => {
          const waiting = new Set(asks.map((ask) => ask.id));
          for (const askId of told) if (!waiting.has(askId)) told.delete(askId);
          for (const ask of asks) {
            if (told.has(ask.id)) continue;
            told.add(ask.id);
            if (focused) continue;
            doors.post({
              ...MAC_COMMAND_ASK_NOTICE,
              subject: { kind: NOTICE_KIND.MAC_COMMAND_ASK, askId: ask.id },
              onClick: presenter.openMacCommandAsk,
            });
          }
        }),
    ),
  );
  // A teammate's change or an installation made on GitHub may have moved the
  // workspaces; the host reads them no oftener than once a minute.
  yield* Effect.acquireRelease(
    Effect.sync(() =>
      onPanelFocusChanged((next) => {
        focused = next;
        if (focused) forkReported(host.workspacesRefresh(), "the workspaces refresh");
      }),
    ),
    (unsubscribe) => Effect.sync(unsubscribe),
  );
  return notices;
});
