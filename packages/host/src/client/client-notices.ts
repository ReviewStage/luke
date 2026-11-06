import { ACCOUNT_STATUS, type AccountSnapshot } from "@repo/credentials/snapshot";
import type { AgentAccountInboxAnswerView } from "@repo/features/agent-view";
import { LIVE_READ } from "@repo/features/live-wire";
import { Effect, FiberSet, Queue, type Scope, Stream } from "effect";
import {
  AgentNoticeDoors,
  type AgentNotices,
  type AgentNoticesDependencies,
  createAgentNotices,
  NOTICE_KIND,
} from "../agent-notices.js";
import { type AppTranscripts, OWN_TRANSCRIPT } from "../app-state.js";
import type { HostOperator } from "../host-operator.js";
import type { AppStateStore } from "./app-state-store.js";

interface NoticePresenter {
  openMacCommandAsk: () => void;
}

const MAC_COMMAND_ASK_NOTICE = {
  title: "Run a command on your Mac?",
  body: "An agent is waiting for you to allow or deny a command.",
} as const;

type NoticeHost = Pick<
  HostOperator,
  | "agentList"
  | "agentPage"
  | "agentAccountInboxFollow"
  | "agentAccountInboxUnfollow"
  | "onAccountInboxChanged"
  | "onAccountChanged"
  | "workspacesRefresh"
>;

export interface ClientNoticesDependencies {
  state: AppStateStore;
  host: NoticeHost;
  presenter: NoticePresenter;
  onPanelFocusChanged: AgentNoticesDependencies["onPanelFocusChanged"];
  report: (message: string) => void;
}

function accountKey(account: AccountSnapshot): string | undefined {
  return account.status === ACCOUNT_STATUS.SIGNED_IN ? account.email : undefined;
}

function accountInboxOf(host: NoticeHost): Stream.Stream<AgentAccountInboxAnswerView> {
  return Stream.callback<AgentAccountInboxAnswerView>((queue) =>
    Effect.gen(function* () {
      yield* Effect.acquireRelease(
        Effect.sync(() => host.onAccountInboxChanged((answer) => Queue.offerUnsafe(queue, answer))),
        (unsubscribe) => Effect.sync(unsubscribe),
      );
      yield* Effect.acquireRelease(host.agentAccountInboxFollow(), () =>
        host.agentAccountInboxUnfollow(),
      );
    }),
  );
}

function observeTranscripts(
  held: AppTranscripts,
  noted: Map<string, number>,
  notices: Pick<AgentNotices, "observeStatus">,
): void {
  for (const agentId of noted.keys()) {
    if (!Object.hasOwn(held, agentId)) noted.delete(agentId);
  }
  for (const [agentId, transcripts] of Object.entries(held)) {
    const rows = transcripts[OWN_TRANSCRIPT]?.rows;
    if (rows === undefined) noted.delete(agentId);
    if (rows?.word === undefined || noted.get(agentId) === rows.pages) continue;
    noted.set(agentId, rows.pages);
    notices.observeStatus(agentId, rows.word.status);
  }
}

export const linkClientNotices = Effect.fn("client/linkClientNotices")(function* (
  dependencies: ClientNoticesDependencies,
): Effect.fn.Return<AgentNotices, never, Scope.Scope | AgentNoticeDoors> {
  const { state, host, presenter, onPanelFocusChanged, report } = dependencies;
  const doors = yield* AgentNoticeDoors;
  const fork = yield* FiberSet.makeRuntime();
  let focused = false;
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
    onUnseenChanged: (unseen) => state.update({ agents: { unseen } }),
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
  yield* Effect.forkScoped(
    Stream.runForEach(
      Stream.changes(Stream.map(state.changes, (document) => document.tasks.tasklessAgents)),
      (agents) =>
        Effect.catchDefect(
          Effect.withErrorReporting(
            Effect.sync(() => notices.observeAgents(agents ?? [])),
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
  yield* Effect.forkScoped(
    Stream.runForEach(
      Stream.changes(Stream.map(state.changes, (document) => document.tasks.taskAgents)),
      (agents) =>
        Effect.catchDefect(
          Effect.sync(() => {
            if (agents === undefined) return;
            const taskIds = state.snapshot().tasks.tasks.map((each) => each.id);
            notices.observeFollowed(
              agents.filter((agent) => agent.archivedAt === undefined),
              taskIds,
            );
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
  const noted = new Map<string, number>();
  yield* Effect.forkScoped(
    Stream.runForEach(
      Stream.changes(Stream.map(state.changes, (document) => document[LIVE_READ.TRANSCRIPT])),
      (held) =>
        Effect.catchDefect(
          Effect.sync(() => observeTranscripts(held, noted, notices)),
          (defect) =>
            Effect.sync(() =>
              report(
                `the agents' transcripts could not be noted: ${defect instanceof Error ? defect.message : String(defect)}`,
              ),
            ),
        ),
    ),
  );
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
