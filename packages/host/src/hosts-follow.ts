import type { HostDoneAnswerView } from "@repo/features/agent-view";
import {
  type HostLiveRow,
  type HostsLiveAnswer,
  hostsLiveRowsSchema,
  hostsOfLiveRows,
} from "@repo/features/host-live";
import { type LIVE_READ, LIVE_SIGNED_OUT } from "@repo/features/live-wire";
import { carried } from "@repo/gateway";
import {
  type EntityPool,
  type FieldChange,
  fieldKind,
  type HeldRows,
  ROW_GONE,
  type WriteDeclaration,
} from "@repo/sync";
import type { WireValue } from "@repo/wire";
import { Effect, type Scope } from "effect";
import { type AppHostReads, type AppHosts, NO_KEYS_HELD } from "./app-state.js";
import { type HeldAnswers, type HeldSlice, heldSlice } from "./live-collection.js";
import {
  confirmWrite,
  followTakingRows,
  LIVE_GONE,
  restarting,
  type TxWait,
} from "./live-follow.js";

const HOST = fieldKind((row: HostLiveRow) => row.id);

interface HostsUnanswered {
  readonly failure: string;
}

export interface HostsFollowDependencies {
  readonly seal: (
    userId: string,
    poll: boolean,
    after?: string,
  ) => Effect.Effect<HostsLiveAnswer | HostsUnanswered>;
  readonly accountId: () => string | undefined;
  readonly gate: () => boolean;
  readonly pool: EntityPool;
  readonly tell: (held: AppHosts) => void;
}

function followHosts(
  dependencies: HostsFollowDependencies,
  userId: string,
  answers: HeldAnswers<AppHostReads[typeof LIVE_READ.HOSTS]>,
): Effect.Effect<void> {
  const seal = (poll: boolean, after?: string) =>
    userId === dependencies.accountId()
      ? dependencies.seal(userId, poll, after)
      : Effect.succeed(LIVE_SIGNED_OUT);
  const attempt = Effect.scoped(
    Effect.gen(function* () {
      const first = yield* seal(false);
      if ("failure" in first) {
        if (first.failure === LIVE_SIGNED_OUT.failure) return false;
        answers.unanswered();
        return true;
      }
      const { installScriptUrl } = first;
      let wait: TxWait | undefined;
      let answered = false;
      const drawn: Effect.Effect<void> = Effect.sync(() => {
        if (answered) answers.answered({ hosts: hostsOfLiveRows(hosts.rows()), installScriptUrl });
      });
      const hosts: HeldRows<HostLiveRow> = yield* dependencies.pool.stand(HOST, {
        redraw: () => drawn,
        confirmation: () => {
          const handed = wait;
          return handed === undefined ? undefined : (txid) => confirmWrite(handed, txid);
        },
      });
      const gone = yield* followTakingRows(
        {
          poll: (after) =>
            Effect.map(seal(true, after), (read) =>
              "failure" in read
                ? { failure: read.failure, gone: read.failure === LIVE_SIGNED_OUT.failure }
                : read,
            ),
          onTxWait: (handed) => {
            wait = handed;
          },
        },
        first,
        hostsLiveRowsSchema,
        (rows) =>
          Effect.andThen(
            hosts.answer(rows.hosts),
            Effect.suspend(() => {
              answered = true;
              return drawn;
            }),
          ),
      ).pipe(
        Effect.as(false),
        Effect.catch((broken) => Effect.succeed(broken.reason === LIVE_GONE)),
      );
      return !gone;
    }),
  );
  return restarting(attempt);
}

export function heldHosts(
  dependencies: HostsFollowDependencies,
): Effect.Effect<HeldSlice<string>, never, Scope.Scope> {
  return heldSlice<typeof LIVE_READ.HOSTS, string>({
    empty: NO_KEYS_HELD,
    path: (userId) => [userId],
    gate: dependencies.gate,
    follow: (userId, answers) => followHosts(dependencies, userId, answers),
    tell: dependencies.tell,
  });
}

export function hostRemove(
  send: (id: string) => Effect.Effect<HostDoneAnswerView>,
): WriteDeclaration<HostLiveRow, FieldChange<HostLiveRow>, string, WireValue> {
  return {
    kind: HOST,
    keys: (id) => [id],
    change: () => () => ROW_GONE,
    send: (id) =>
      Effect.map(send(id), (answer) =>
        "done" in answer
          ? { answer: carried<HostDoneAnswerView>(answer), txid: answer.txid }
          : { refused: carried<HostDoneAnswerView>(answer) },
      ),
  };
}
