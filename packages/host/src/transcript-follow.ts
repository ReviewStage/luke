import { CALL_FAULT } from "@repo/features";
import {
  AGENT_CALL_FAILURE,
  type AgentMessagesAnswerView,
  type AgentTranscriptPage,
} from "@repo/features/agent-view";
import {
  AGENT_BOUNDS,
  AGENT_CURSOR_START,
  AGENT_STATUS,
  type AgentNewestAnswer,
  type AgentOlderAnswer,
  type AgentTranscriptMessage,
  applyMessagesPage,
} from "@repo/features/agent-wire";
import { FAILURE_FACT, type FailureFacts } from "@repo/features/failure-facts";
import {
  type AgentTranscriptLiveAnswer,
  agentTranscriptLiveRowsSchema,
  LIVE_SIGNED_OUT,
  type SealedLiveQueryWire,
  type TranscriptNowAnswer,
} from "@repo/features/live-wire";
import { joinedWindowRows, windowMessagesOf } from "@repo/features/transcript-window";
import { MESSAGE_ROLE } from "@repo/wire";
import {
  Data,
  Duration,
  Effect,
  Fiber,
  Option,
  RcMap,
  Schedule,
  type Scope,
  Stream,
  SubscriptionRef,
} from "effect";
import type { AppTranscript } from "./app-state.js";
import type { HeldAnswers } from "./live-collection.js";
import { decodedLiveRows, LIVE_STATE, type SealedRead } from "./live-follow.js";

export const HELD_TRANSCRIPTS = 8;
export const HELD_BYTES = 4 * 1024 * 1024;
export const HELD_BYTES_EACH = HELD_BYTES / 4;

const IDLE = Duration.seconds(30);
const RESEAL = Duration.seconds(1);
const RESEALS = 30;

function noAnswer(facts: FailureFacts | undefined): boolean {
  if (facts === undefined) return false;
  return facts.fault === CALL_FAULT.NETWORK || noAnswer(facts.cause);
}

function resealing(): (failed: Failed) => boolean {
  let refused = 0;
  return (failed) => {
    if (noAnswer(failed.cause)) return true;
    refused += 1;
    return refused <= RESEALS;
  };
}

class SealUnanswered extends Data.TaggedError("SealUnanswered")<{
  readonly failure: string;
  readonly cause?: FailureFacts;
}> {}

export class TranscriptKey extends Data.Class<{
  readonly agentId: string;
  readonly callId: string | undefined;
}> {}

interface Drawn {
  readonly messages: readonly AgentTranscriptMessage[];
  readonly lowest: number;
  readonly highest: number;
  readonly revision: number | undefined;
  readonly awaiting: ReadonlySet<string>;
  readonly queueRevision: number | undefined;
}

type LiveState =
  | { readonly kind: typeof LIVE_STATE.WAITING }
  | { readonly kind: typeof LIVE_STATE.STANDING; readonly digest: string; readonly drawn: Drawn }
  | { readonly kind: typeof LIVE_STATE.BROKEN; readonly cause: FailureFacts };

type Standing =
  | {
      readonly kind: typeof LIVE_STATE.LIVE;
      readonly state: SubscriptionRef.SubscriptionRef<LiveState>;
    }
  | { readonly kind: typeof LIVE_STATE.REFUSED };

interface Failed {
  readonly failure: string;
  readonly cause?: FailureFacts;
}

export interface TranscriptFollowDependencies<Key = TranscriptKey> {
  readonly seal: (
    key: Key,
    poll: boolean,
    userId: string,
    after?: string,
    cursor?: string,
  ) => Effect.Effect<AgentTranscriptLiveAnswer | Failed>;
  readonly accountId: () => string | undefined;
}

export type TranscriptFollows<Key = TranscriptKey> = RcMap.RcMap<Key, Standing, SealUnanswered>;

function digestOf(rows: typeof agentTranscriptLiveRowsSchema.Type): string {
  const parts = {
    turns: rows.turns,
    conversation: rows.conversation.map(({ id, title }) => ({ id, title })),
    agent: rows.agent,
    workers: rows.workers,
    queue: rows.queueRevision ?? [],
    launch: rows.launch ?? [],
    awaiting: rows.window
      .filter((row) => row.role === MESSAGE_ROLE.USER && row.turnStatus === null)
      .map(({ id }) => ({ id })),
  };
  return JSON.stringify(
    Object.entries(parts).map(
      ([part, list]) => [part, list.map((row) => JSON.stringify(row)).toSorted()] as const,
    ),
  );
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, held: unknown) =>
    held !== null && typeof held === "object" && !Array.isArray(held)
      ? Object.fromEntries(
          Object.entries(held).toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        )
      : held,
  );
}

function drawnOf(rows: typeof agentTranscriptLiveRowsSchema.Type): Drawn {
  const seqs = rows.window.map((row) => row.seq);
  const revisions = rows.conversation.map((row) => row.revision);
  const queue = (rows.queueRevision ?? []).map((row) => row.revision);
  return {
    messages: windowMessagesOf(rows.window, rows.windowParts),
    lowest: seqs.length === 0 ? 0 : Math.min(...seqs),
    highest: seqs.length === 0 ? 0 : Math.max(...seqs),
    revision: revisions.length === 0 ? undefined : Math.max(...revisions),
    awaiting: new Set(
      rows.window
        .filter((row) => row.role === MESSAGE_ROLE.USER && row.turnStatus === null)
        .map((row) => row.id),
    ),
    queueRevision: queue.length === 0 ? undefined : Math.max(...queue),
  };
}

function cursorParts(cursor: string): { readonly seq: number; readonly revision: string } {
  const [seq = "0", revision = "0"] = cursor.split(":");
  return { seq: Number(seq), revision };
}

function followedRead(sealed: AgentTranscriptLiveAnswer): SealedRead<string> {
  const { messages: _messages, ...queries } = sealed.queries;
  const answered: Record<string, SealedLiveQueryWire> = {};
  for (const [part, query] of Object.entries(queries)) {
    if (query !== undefined) answered[part] = query;
  }
  return { url: sealed.url, queries: answered };
}

function followedAnswer<Failure extends Failed>(answer: AgentTranscriptLiveAnswer | Failure) {
  return "failure" in answer ? answer : followedRead(answer);
}

function sealedOf(
  seal: (
    poll: boolean,
    after?: string,
    cursor?: string,
  ) => Effect.Effect<AgentTranscriptLiveAnswer | Failed>,
): Effect.Effect<Option.Option<AgentTranscriptLiveAnswer>, SealUnanswered> {
  const again = resealing();
  return seal(false, undefined, AGENT_CURSOR_START).pipe(
    Effect.flatMap((answer) => {
      if (!("failure" in answer)) return Effect.succeed(Option.some(answer));
      if (
        answer.failure === AGENT_CALL_FAILURE.NOT_FOUND ||
        answer.failure === LIVE_SIGNED_OUT.failure
      ) {
        return Effect.succeed(Option.none());
      }
      const { failure, cause } = answer;
      return Effect.fail(
        new SealUnanswered(cause === undefined ? { failure } : { failure, cause }),
      );
    }),
    Effect.retry({ schedule: Schedule.spaced(RESEAL), while: (unsealed) => again(unsealed) }),
  );
}

export function transcriptFollows<Key = TranscriptKey>(
  dependencies: TranscriptFollowDependencies<Key>,
): Effect.Effect<TranscriptFollows<Key>, never, Scope.Scope> {
  return RcMap.make({
    idleTimeToLive: IDLE,
    lookup: (key: Key) =>
      Effect.gen(function* () {
        const userId = dependencies.accountId();
        const seal = (
          poll: boolean,
          after?: string,
          cursor?: string,
        ): Effect.Effect<AgentTranscriptLiveAnswer | Failed> =>
          userId === undefined
            ? Effect.succeed(LIVE_SIGNED_OUT)
            : dependencies.seal(key, poll, userId, after, cursor);
        const first = yield* sealedOf(seal);
        if (Option.isNone(first)) return { kind: LIVE_STATE.REFUSED } as const;
        const state = yield* SubscriptionRef.make<LiveState>({ kind: LIVE_STATE.WAITING });
        yield* Effect.forkScoped(
          Stream.runForEach(
            decodedLiveRows(
              { poll: (after, cursor) => Effect.map(seal(true, after, cursor), followedAnswer) },
              followedRead(first.value),
              agentTranscriptLiveRowsSchema,
              joinedWindowRows,
            ),
            (decoded) =>
              SubscriptionRef.set(state, {
                kind: LIVE_STATE.STANDING,
                digest: digestOf(decoded),
                drawn: drawnOf(decoded),
              }),
          ).pipe(
            Effect.catch((broken) =>
              SubscriptionRef.set(state, {
                kind: LIVE_STATE.BROKEN,
                cause: { _tag: FAILURE_FACT.LIVE_BROKEN, reason: broken.reason },
              }),
            ),
          ),
        );
        return { kind: LIVE_STATE.LIVE, state } as const;
      }),
  });
}

export function windowsPage(
  answer: TranscriptNowAnswer | AgentMessagesAnswerView,
): AgentMessagesAnswerView {
  if (!("holds" in answer)) return answer;
  const { holds: _holds, wakeIn: _wakeIn, ...page } = answer;
  return page;
}

function toldPage(answer: TranscriptNowAnswer | AgentMessagesAnswerView): AgentTranscriptPage {
  const page = windowsPage(answer);
  if ("failure" in page) return page;
  return { ...page, caughtUp: page.messages.length < AGENT_BOUNDS.MESSAGES_PAGE };
}

function movedFrom(was: LiveState): (state: LiveState) => boolean {
  return (state) =>
    state.kind !== was.kind ||
    (state.kind === LIVE_STATE.STANDING &&
      was.kind === LIVE_STATE.STANDING &&
      state.digest !== was.digest);
}

function unanswered(answer: { readonly failure: string } | object): boolean {
  return "failure" in answer && answer.failure !== AGENT_CALL_FAILURE.NOT_FOUND;
}

function unansweredPage(cause: FailureFacts): AgentTranscriptPage {
  return { failure: AGENT_CALL_FAILURE.UNANSWERED, cause };
}

function sealFacts({ failure, cause }: SealUnanswered): FailureFacts {
  return {
    _tag: FAILURE_FACT.SEAL_UNANSWERED,
    code: failure,
    ...(cause === undefined ? undefined : { cause }),
  };
}

export interface TranscriptReads {
  readonly newest: () => Effect.Effect<
    AgentNewestAnswer | Extract<AgentMessagesAnswerView, { failure: unknown }>
  >;
  readonly after: (after: string) => Effect.Effect<TranscriptNowAnswer | AgentMessagesAnswerView>;
}

export interface HeldTranscript {
  readonly rows: () => AppTranscript | undefined;
  readonly answered: (rows: AppTranscript) => Effect.Effect<void>;
}

export function heldTranscript(answers: HeldAnswers<AppTranscript>): HeldTranscript {
  return { rows: answers.rows, answered: (rows) => Effect.sync(() => answers.answered(rows)) };
}

function meets(
  held: readonly AgentTranscriptMessage[],
  page: { readonly messages: readonly AgentTranscriptMessage[]; readonly before?: string },
): boolean {
  if (page.before === undefined) return true;
  const ids = new Set(page.messages.map((message) => message.id));
  return held.some((message) => ids.has(message.id));
}

export function toldTranscript(
  was: AppTranscript | undefined,
  page: AgentTranscriptPage,
  queueRevision: number | undefined,
): AppTranscript {
  const pages = was?.pages ?? 0;
  if ("failure" in page) {
    if (page.failure === AGENT_CALL_FAILURE.NOT_FOUND)
      return { messages: [], pages, failure: page };
    return { ...(was ?? { messages: [], pages }), failure: page };
  }
  const { messages, cursor, before, newest, ...said } = page;
  const held = was?.messages ?? [];
  const replaces =
    newest === true &&
    (held.length === 0 || !meets(held, page) || said.rewound !== was?.word?.rewound);
  const below = replaces || (newest === true && before === undefined) ? before : was?.before;
  return {
    messages: replaces ? messages : applyMessagesPage(held, messages),
    ...(below === undefined ? undefined : { before: below }),
    cursor,
    word: queueRevision === undefined ? said : { ...said, queueRevision },
    pages: pages + 1,
  };
}

export function withOlderPage(
  held: AppTranscript | undefined,
  before: string,
  older: AgentOlderAnswer,
): AppTranscript | undefined {
  if (held === undefined || held.before !== before) return undefined;
  const ids = new Set(held.messages.map((message) => message.id));
  const { before: _laid, ...rest } = held;
  return {
    ...rest,
    messages: [...older.messages.filter((message) => !ids.has(message.id)), ...held.messages],
    ...(older.before === undefined ? undefined : { before: older.before }),
  };
}

function reopened(held: HeldTranscript): Effect.Effect<Option.Option<AgentNewestAnswer>> {
  return Effect.suspend(() => {
    const rows = held.rows();
    if (rows === undefined) return Effect.succeed(Option.none());
    const { failure, ...standing } = rows;
    const word = standing.word === undefined ? undefined : { ...standing.word, caughtUp: false };
    const laid =
      failure !== undefined || rows.word?.caughtUp === true
        ? held.answered(word === undefined ? standing : { ...standing, word })
        : Effect.void;
    if (standing.cursor === undefined || word === undefined) return Effect.as(laid, Option.none());
    const { caughtUp: _caughtUp, queueRevision: _revision, ...said } = word;
    return Effect.as(
      laid,
      Option.some({
        ...said,
        messages: standing.messages,
        cursor: standing.cursor,
        ...(standing.before === undefined ? undefined : { before: standing.before }),
      }),
    );
  });
}

function joinedWindow(
  window: AgentNewestAnswer,
  answer: TranscriptNowAnswer | AgentMessagesAnswerView,
): AgentNewestAnswer {
  const read = windowsPage(answer);
  if ("failure" in read) return window;
  return {
    ...read,
    messages: applyMessagesPage(window.messages, read.messages),
    ...(window.before === undefined ? undefined : { before: window.before }),
  };
}

function forgetCursor(held: HeldTranscript): Effect.Effect<void> {
  return Effect.suspend(() => {
    const rows = held.rows();
    if (rows?.cursor === undefined) return Effect.void;
    const { cursor: _cursor, ...rest } = rows;
    return held.answered(rest);
  });
}

export function followTranscript<Key>(
  follows: TranscriptFollows<Key>,
  key: Key,
  reads: TranscriptReads,
  held: HeldTranscript,
): Effect.Effect<void> {
  return Effect.scoped(
    Effect.gen(function* () {
      let revision: number | undefined;
      const tell = (page: AgentTranscriptPage) =>
        Effect.suspend(() => held.answered(toldTranscript(held.rows(), page, revision)));
      let toldNotFound = false;
      const readNewest = Effect.suspend(() => {
        const again = resealing();
        return reads.newest().pipe(
          Effect.tap((answer) => {
            if (!("failure" in answer)) return tell({ ...answer, newest: true, caughtUp: false });
            toldNotFound = answer.failure === AGENT_CALL_FAILURE.NOT_FOUND;
            return tell(answer);
          }),
          Effect.repeat({
            schedule: Schedule.spaced(RESEAL),
            while: (answer) => "failure" in answer && unanswered(answer) && again(answer),
          }),
        );
      });
      const recalled = yield* reopened(held);
      const opening = Option.isSome(recalled) ? undefined : yield* Effect.forkScoped(readNewest);
      const sealed = yield* Effect.result(RcMap.get(follows, key));
      if (sealed._tag === "Failure" || sealed.success.kind === LIVE_STATE.REFUSED) {
        if (opening !== undefined) yield* Fiber.interrupt(opening);
        if (sealed._tag === "Failure") {
          yield* RcMap.invalidate(follows, key);
          return yield* tell(unansweredPage(sealFacts(sealed.failure)));
        }
        if (toldNotFound) return;
        return yield* tell({ failure: AGENT_CALL_FAILURE.NOT_FOUND });
      }
      const { state } = sealed.success;
      const opened =
        opening === undefined
          ? recalled
          : yield* Effect.map(Fiber.join(opening), (newest) =>
              "failure" in newest ? Option.none() : Option.some(newest),
            );
      if (Option.isNone(opened)) return;
      let window = opened.value;
      let fromHeld = Option.isSome(recalled);
      const told = new Map<
        string,
        { readonly said: string; readonly at: number | undefined; readonly paged: boolean }
      >();
      const heardPaged = (messages: readonly AgentTranscriptMessage[], cursor: string) => {
        const at = Number(cursorParts(cursor).revision);
        return messages.filter((message) => {
          const was = told.get(message.id);
          if (was !== undefined && !was.paged && was.at !== undefined && was.at > at) return false;
          told.set(message.id, { said: canonical(message), at, paged: true });
          return true;
        });
      };
      const heardDrawn = ({ messages, revision }: Drawn) =>
        messages.filter((message) => {
          const said = canonical(message);
          const was = told.get(message.id);
          if (was?.said === said) return false;
          const pagedLater =
            was?.paged === true &&
            was.at !== undefined &&
            revision !== undefined &&
            was.at >= revision;
          if (pagedLater) return false;
          told.set(message.id, { said, at: revision, paged: false });
          return true;
        });
      heardPaged(window.messages, window.cursor);
      const tellDrawn = (page: AgentTranscriptPage, state: LiveState) =>
        Effect.gen(function* () {
          if (state.kind !== LIVE_STATE.STANDING || "failure" in page) return;
          const fresh = heardDrawn(state.drawn);
          if (fresh.length === 0) return;
          const { seq, revision } = cursorParts(window.cursor);
          const cursor =
            state.drawn.lowest <= seq + 1 && state.drawn.highest > seq
              ? `${state.drawn.highest}:${revision}`
              : window.cursor;
          const opens = fresh.some((message) => state.drawn.awaiting.has(message.id));
          yield* tell({
            ...page,
            ...(opens ? { status: AGENT_STATUS.RUNNING } : undefined),
            messages: fresh,
            cursor,
            caughtUp: true,
          });
          window = { ...window, messages: applyMessagesPage(window.messages, fresh), cursor };
        });
      let wake: Effect.Effect<unknown> = SubscriptionRef.changes(state).pipe(
        Stream.filter(movedFrom({ kind: LIVE_STATE.WAITING })),
        Stream.runHead,
      );
      let last: AgentTranscriptPage | undefined;
      while (true) {
        yield* wake;
        const was = yield* SubscriptionRef.get(state);
        if (was.kind === LIVE_STATE.BROKEN) {
          yield* RcMap.invalidate(follows, key);
          return yield* tell(unansweredPage(was.cause));
        }
        const lastTold = last;
        const besideRead =
          lastTold === undefined
            ? Effect.void
            : SubscriptionRef.changes(state).pipe(
                Stream.runForEach((now) => tellDrawn(lastTold, now)),
              );
        const answer = yield* Effect.scoped(
          Effect.andThen(Effect.forkScoped(besideRead), reads.after(window.cursor)),
        );
        if (fromHeld && unanswered(answer)) {
          yield* forgetCursor(held);
          const newest = yield* readNewest;
          if ("failure" in newest) {
            if (newest.failure === AGENT_CALL_FAILURE.NOT_FOUND) return;
            wake = Effect.sleep(RESEAL);
            continue;
          }
          fromHeld = false;
          window = newest;
          heardPaged(newest.messages, newest.cursor);
          wake = Effect.void;
          continue;
        }
        if (!("failure" in answer) && (answer.rewound ?? 0) !== (window.rewound ?? 0)) {
          fromHeld = false;
          const newest = yield* readNewest;
          if ("failure" in newest) {
            if (newest.failure === AGENT_CALL_FAILURE.NOT_FOUND) return;
            wake = Effect.sleep(RESEAL);
            continue;
          }
          window = newest;
          told.clear();
          heardPaged(newest.messages, newest.cursor);
          wake = Effect.void;
          continue;
        }
        fromHeld = false;
        const whole = toldPage(answer);
        const fresh = "failure" in answer ? [] : heardPaged(answer.messages, answer.cursor);
        const shown = "failure" in answer ? answer : { ...answer, messages: fresh };
        const page = "failure" in whole ? whole : { ...whole, messages: fresh };
        if (was.kind === LIVE_STATE.STANDING) revision = was.drawn.queueRevision;
        yield* tell(page);
        last = page;
        if ("failure" in answer) {
          if (answer.failure === AGENT_CALL_FAILURE.NOT_FOUND) return;
          wake = Effect.sleep(RESEAL);
          continue;
        }
        window = joinedWindow(window, shown);
        if (answer.messages.length >= AGENT_BOUNDS.MESSAGES_PAGE) {
          wake = Effect.void;
          continue;
        }
        const moved = SubscriptionRef.changes(state).pipe(
          Stream.takeUntil(movedFrom(was)),
          Stream.runForEach((now) => tellDrawn(page, now)),
        );
        const wakeIn = "holds" in answer && answer.holds ? answer.wakeIn : undefined;
        wake =
          wakeIn === undefined ? moved : Effect.race(moved, Effect.sleep(Duration.millis(wakeIn)));
      }
    }),
  );
}
