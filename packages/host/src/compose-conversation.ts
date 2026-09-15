import { ACTION_OUTPUT, ACTION_OUTPUT_STATUS, ACTIONS } from "@sidecar/actions";
import { PRODUCT_EVENT, PRODUCT_RATED_MESSAGE_KIND } from "@sidecar/analytics";
import { catalogToolSet } from "@sidecar/brain/tool-set";
import {
  CONVERSATION_RATE_STATUS,
  type ConversationRateMessageResult,
  type ConversationRateStatus,
  carried,
  conversationRateMessageParamsSchema,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type GatewayMethodTable,
  invalid,
  type NotebookReadResult,
} from "@sidecar/gateway";
import {
  CONVERSATION_RATE_REFUSAL,
  CONVERSATION_READ_FAILURE,
  type ConversationMessagesAnswer,
  type ConversationRateRefusal,
  type ConversationReadResult,
  type HostedChangesClient,
  type HostedConversationClient,
} from "@sidecar/hosted";
import { ObservationLoop } from "@sidecar/runtime";
import type {
  ConversationViewMessage,
  ConversationViewSnapshot,
  StoredToolPart,
  UnreadableRow,
} from "@sidecar/session";
import { isStoredToolPart } from "@sidecar/session";
import { readStoredUIMessages, UNREGISTERED_TOOL_PART } from "@sidecar/session/ui-messages";
import { EXCESS_KEYS, unparsedWire, type WireBoundaryInput } from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { Deferred, Effect, Result } from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import type * as HttpClient from "effect/unstable/http/HttpClient";
import type { AccountComposer } from "./compose-account.js";
import type { DevicesComposer } from "./compose-devices.js";
import type { SettingsComposer } from "./compose-settings.js";
import type { Composer } from "./composer.js";
import {
  ConversationViewSync,
  type ReadMessagesPage,
  type ReadTurnGroup,
} from "./conversation-view-sync.js";
import type { HostKernel } from "./host-kernel.js";
import type { RunMode } from "./run-mode.js";

/**
 * How often a signed-in Mac asks the service what moved. The change signal
 * is one small read, and the brake behind it admits every device a person
 * owns polling at this pace; a Clear made on another Mac reaches this one
 * within one of these.
 */
const CONVERSATION_POLL_INTERVAL_MS = 5_000;

/**
 * The most pages one poll takes of one resource before leaving the rest for
 * the next. A first read of a long Conversation is bounded by it rather than
 * by the Conversation's length, and the next poll carries on from the cursor
 * the last page handed back.
 */
const MAX_PAGES_PER_POLL = 25;

export interface ConversationComposer extends Composer {
  /** The loop the merge's supervisor enables; the composer never enables it itself. */
  readonly loop: ObservationLoop;
  /** The Conversation as this device holds it now, for the bootstrap. */
  snapshot: () => ConversationViewSnapshot;
  /** Drops everything held, for a sign-out, and tells every client the thread is gone. */
  reset: () => void;
}

/** The service's side of the reads, Clear, and the rating write, as the composer asks it: the client's calls and nothing of its construction. */
export type ConversationReadsClient = Pick<
  HostedConversationClient,
  "messages" | "events" | "turns" | "clear" | "rate" | "notebook"
>;

/** The change signal's one call, the same client the devices composer restates presence through. */
export type ConversationHeadsClient = Pick<HostedChangesClient, "poll">;

export interface ConversationDependencies {
  kernel: Pick<HostKernel, "report" | "emit" | "now"> & { runMode: Pick<RunMode, "sendsNetwork"> };
  /**
   * Told, with each publish, how many briefings stand on offer to the account
   * as the events just read say: the live composer decides on it whether to
   * open a muted session for the service to say one here. Composed after this
   * composer, so it is handed in as a hand rather than a link.
   */
  onOpenOffers?: (count: number) => void;
  settings: Pick<SettingsComposer, "recordProductEvent">;
  account: Pick<AccountComposer, "capabilitiesActive">;
  devices: Pick<DevicesComposer, "deviceId">;
  /** A created workspace becomes openable only after the roster has observed it. */
  refreshRoster: Effect.Effect<void>;
  heads: ConversationHeadsClient;
  client: ConversationReadsClient;
}

/** How the service's refusal of a rating reaches the control, one answer per refusal so none is read as another. */
const RATE_REFUSAL_STATUS = {
  [CONVERSATION_RATE_REFUSAL.UNANSWERED]: CONVERSATION_RATE_STATUS.UNAVAILABLE,
  [CONVERSATION_RATE_REFUSAL.NOT_FOUND]: CONVERSATION_RATE_STATUS.NOT_FOUND,
  [CONVERSATION_RATE_REFUSAL.NOT_RATEABLE]: CONVERSATION_RATE_STATUS.NOT_RATEABLE,
} as const satisfies Record<ConversationRateRefusal, ConversationRateStatus>;

function rateAnswer(status: ConversationRateStatus) {
  return Effect.succeed(carried<ConversationRateMessageResult>({ status }));
}

/**
 * The Conversation read from the service, for the panel to draw: the
 * per-resource reads behind cursors of this device's own, folded into one
 * picture and told to every client whenever a poll moved it, and the one
 * write the tab has, Clear, carried to the service's soft delete. Nothing of
 * the local Conversation store is read here; the thread a window draws is the
 * account's, the same on every Mac signed in to it.
 *
 * Each poll asks the change signal, through the same client the devices
 * composer restates presence with, where every resource stands, reads only
 * the resources whose head differs from the cursor held, and pages each to
 * its end under the bound above. Before the device row has registered there
 * is no signal to ask, so the three resources are read directly, each an
 * empty page when nothing moved. A messages page is held to the vocabulary
 * under the brain catalog's own registry before it is folded in — the same
 * registry the service read the rows back under — and the one refusal a read
 * answers with a body, an unreadable row, is surfaced on the snapshot and
 * never drawn as an empty page.
 *
 * The other write the tab has is the developer's thumb on one of Luke's
 * messages. It is carried to the service as a rating event on that message,
 * only for a message this device holds and Luke authored — the set the
 * service accepts, so a refusal is a row the thread has moved past rather
 * than a control that should not have been drawn — and the answered event is
 * taken into the picture at once, so the verdict shows before the next poll
 * reads it back. The count that follows names the verdict and whether the
 * message was a briefing or a reply, read from the held message rather than
 * from the caller, and never the message or its id.
 */
export function composeConversation(dependencies: ConversationDependencies): ConversationComposer {
  const { kernel, settings, account, devices, refreshRoster, heads, client, onOpenOffers } =
    dependencies;
  const { runMode, report } = kernel;

  const registry = catalogToolSet();
  const sync = new ConversationViewSync();
  let published = sync.revision;

  const gate = () => runMode.sendsNetwork && account.capabilitiesActive();

  function snapshot(): ConversationViewSnapshot {
    const held = sync.snapshot();
    // A run that sends nothing has nothing to wait for: its empty thread is the whole Conversation.
    return runMode.sendsNetwork ? held : { ...held, settled: true };
  }

  function publish(): void {
    if (sync.revision === published) return;
    published = sync.revision;
    kernel.emit(GATEWAY_EVENT.CONVERSATION_VIEW_CHANGED, carried(snapshot()));
    onOpenOffers?.(sync.openOffers(kernel.now()));
  }

  /**
   * Holds a page's rows to the vocabulary under the registry. A tool part
   * naming a tool this build does not register is dropped from its row, since
   * the service's catalog and this build's registry move separately and a
   * call one of them has retired must not blank the thread. A row the
   * registry refuses otherwise — an input its schema will not admit — is
   * named the way the service names one it could not read back, so the thread
   * stands as last read and says so rather than stopping quietly at the last
   * good page; the cursor does not pass the row.
   */
  const readPage = /* @__PURE__ */ Effect.fnUntraced(function* (
    answer: ConversationMessagesAnswer,
  ): Effect.fn.Return<
    { readonly page: ReadMessagesPage } | { readonly unreadable: UnreadableRow }
  > {
    const groups: ReadTurnGroup[] = [];
    for (const group of answer.groups) {
      const read = yield* Effect.promise(() =>
        readStoredUIMessages(
          group.messages.map((message) => message.message),
          registry,
          UNREGISTERED_TOOL_PART.DROP,
        ),
      );
      if (!read.ok) {
        // The reader's path begins with the index of the row it refused.
        const refused = group.messages.find((_, position) => position === read.path[0]);
        const row: UnreadableRow = {
          conversationId: group.conversationId,
          seq: refused?.seq ?? group.messages[0]?.seq ?? 0,
        };
        report(
          `a Conversation page could not be read under this build's registry: ${read.refusal} at ${read.path.join(".")}`,
        );
        return { unreadable: row };
      }
      const messages: ConversationViewMessage[] = group.messages.map((message, index) => {
        const stored = read.value[index];
        if (stored === undefined)
          throw new Error("the registry read answered fewer rows than it took");
        return {
          message: stored,
          seq: message.seq,
          createdAt: message.createdAt,
          tools: message.tools,
          ...(message.rating !== undefined ? { rating: message.rating } : undefined),
        };
      });
      groups.push({
        turnId: group.turnId,
        conversationId: group.conversationId,
        source: group.source,
        ...(group.turn !== undefined ? { turn: group.turn } : undefined),
        messages,
      });
    }
    return { page: { conversations: answer.conversations, groups, next: answer.next } };
  });

  function createdWorkspaceAnswer(part: StoredToolPart) {
    if (
      part.state !== "output-available" ||
      part.type !== `tool-${ACTIONS.CREATE_WORKSPACE.name}`
    ) {
      return undefined;
    }
    // SAFETY: a stored tool part's output is JSON the service already stored; the action output
    // schema below is the boundary that re-reads it.
    return Result.getOrUndefined(
      readEither(ACTION_OUTPUT, { excess: EXCESS_KEYS.DROP })(
        unparsedWire(part.output as WireBoundaryInput),
      ),
    );
  }

  function pageCreatedWorkspaceNeedsRefresh(page: ReadMessagesPage): boolean {
    for (const group of page.groups) {
      for (const message of group.messages) {
        for (const part of message.message.parts) {
          if (!isStoredToolPart(part)) continue;
          const answer = createdWorkspaceAnswer(part);
          if (
            answer?.status === ACTION_OUTPUT_STATUS.ACCEPTED &&
            answer.createdSession !== undefined
          ) {
            return true;
          }
        }
      }
    }
    return false;
  }

  /**
   * Pages one resource from the cursor held to its end, under the poll's
   * bound: each page is applied only while the poll still owns the loop, and
   * the one refusal a device acts on, an unreadable row, is written on the
   * picture where the walk stops rather than passed over.
   */
  const pageResource = /* @__PURE__ */ Effect.fnUntraced(function* <
    Answer extends { readonly hasMore: boolean },
  >(
    generation: number,
    read: (
      after: string | undefined,
    ) => Effect.Effect<ConversationReadResult<Answer>, never, HttpClient.HttpClient>,
    cursor: () => string | undefined,
    apply: (answer: Answer, epoch: number) => Effect.Effect<boolean>,
  ): Effect.fn.Return<void, never, HttpClient.HttpClient> {
    for (let pages = 0; pages < MAX_PAGES_PER_POLL; pages += 1) {
      const epoch = sync.clearEpoch;
      const result = yield* read(cursor());
      if (!loop.isCurrent(generation)) return;
      if (!result.ok) {
        // A refusal names a row of the thread as it stood when the read went
        // out; a Clear taken meanwhile stamped that thread, and the notice is not written over the new one.
        if (
          result.failure === CONVERSATION_READ_FAILURE.UNREADABLE_ROW &&
          sync.clearEpoch === epoch
        ) {
          sync.markUnreadable(result.row);
        }
        return;
      }
      if (!(yield* apply(result.answer, epoch)) || !result.answer.hasMore) return;
    }
  });

  const pageMessages = (generation: number) =>
    pageResource(
      generation,
      (after) => client.messages({ after }),
      () => sync.cursors().messages,
      (answer, epoch) =>
        Effect.gen(function* () {
          const read = yield* readPage(answer);
          if (!loop.isCurrent(generation)) return false;
          if ("unreadable" in read) {
            if (sync.clearEpoch === epoch) sync.markUnreadable(read.unreadable);
            return false;
          }
          sync.applyMessages(read.page);
          if (pageCreatedWorkspaceNeedsRefresh(read.page)) yield* refreshRoster;
          return true;
        }),
    );

  const pageEvents = (generation: number) =>
    pageResource(
      generation,
      (after) => client.events({ after }),
      () => sync.cursors().events,
      (answer) =>
        Effect.sync(() => {
          sync.applyEvents(answer.events, answer.next, answer.hasMore);
          return true;
        }),
    );

  const pageTurns = (generation: number) =>
    pageResource(
      generation,
      (after) => client.turns({ after }),
      () => sync.cursors().turns,
      (answer) =>
        Effect.sync(() => {
          sync.applyTurns(answer.turns, answer.next);
          return true;
        }),
    );

  const poll = /* @__PURE__ */ Effect.fnUntraced(function* (
    generation: number,
  ): Effect.fn.Return<void, never, HttpClient.HttpClient> {
    const deviceId = devices.deviceId();
    // A heads poll names the device and nothing else, so it moves the row's
    // last-seen instant alone and touches neither presence instant the devices
    // composer restates on its own poll.
    const signal = deviceId === undefined ? undefined : yield* heads.poll({ deviceId });
    if (!loop.isCurrent(generation)) return;
    const cursors = sync.cursors();
    // A signal that could not be had reads everything: each resource answers an empty page when nothing moved.
    const readMessages = signal === undefined || signal.messages !== cursors.messages;
    const readEvents = signal === undefined || signal.events !== cursors.events;
    const readTurns = signal === undefined || signal.turns !== cursors.turns;
    // Messages before turns within a poll, so the turn a group carries is never
    // older than the row the turns resource answered a moment before it.
    if (readMessages) yield* pageMessages(generation);
    if (readEvents) yield* pageEvents(generation);
    if (readTurns) yield* pageTurns(generation);
    if (loop.isCurrent(generation)) publish();
  });

  /**
   * The pass under way, so a caller can wait for one that began after its own
   * write. A `Deferred` and not a promise: the pass is a fiber of whoever
   * runs the loop, and what a waiter needs is the instant it settled,
   * however it settled.
   */
  let inFlight: Deferred.Deferred<void> | undefined;

  const settledInFlight = Effect.suspend(() =>
    inFlight === undefined ? Effect.void : Deferred.await(inFlight),
  );

  const loop = new ObservationLoop({
    gate,
    intervalMs: CONVERSATION_POLL_INTERVAL_MS,
    run: (generation) =>
      Effect.gen(function* () {
        const settled = yield* Deferred.make<void>();
        inFlight = settled;
        yield* Effect.ensuring(
          Effect.provide(poll(generation), FetchHttpClient.layer),
          Deferred.succeed(settled, undefined),
        );
      }),
  });

  /**
   * Runs a poll that began after this call and waits for it to publish. A pass
   * already under way may have read before the caller's write landed, so it
   * is waited out first; the loop then either runs a fresh pass to its end
   * or, when it had already queued one behind the pass that just finished,
   * answers at once, and that queued pass — which began after the write — is
   * what the last wait is for.
   */
  const pollAfter: Effect.Effect<void> = Effect.gen(function* () {
    yield* settledInFlight;
    yield* loop.refresh;
    yield* settledInFlight;
  });

  function reset(): void {
    sync.reset();
    publish();
  }

  const methods: GatewayMethodTable = {
    // A pass asked for now rather than at the cadence: the voice window saw a
    // spoken line settle, which is when the service starts writing it, and the
    // panel draws the line until the record shows it, so the sooner the read
    // the shorter the line stands ahead of its row. The loop coalesces the ask
    // with any pass under way and gates it like every pass; the answer is that
    // the pass it earned has run, or that the gate was closed.
    [GATEWAY_METHOD.CONVERSATION_REFRESH]: () => Effect.as(loop.refresh, {}),
    [GATEWAY_METHOD.CONVERSATION_CLEAR]: () =>
      Effect.gen(function* () {
        if (!gate()) return { cleared: false };
        const answer = yield* Effect.provide(client.clear(), FetchHttpClient.layer);
        if (answer === undefined) return { cleared: false };
        // The service's own answer is what empties this Mac's thread: the
        // picture drops the stamped main's groups and the observed rows from
        // before the new main opened, and every client is told, before any read
        // is waited on — a read that fails to land cannot leave the old thread
        // standing behind an answer that said it was cleared. The pass that
        // follows moves the cursors onto the new main.
        sync.applyClear(answer.openedAt);
        publish();
        yield* pollAfter;
        return { cleared: true };
      }),
    // The notebook read for the Settings page: the same gate as Clear, since a
    // run that sends nothing or an account whose capabilities are down has
    // nothing to ask, answered as the service's own record or, short of one,
    // an empty record the client reads as unreadable just now. Nothing of it
    // is kept here: the page that asked is the one place it is drawn.
    [GATEWAY_METHOD.NOTEBOOK_READ]: () =>
      Effect.gen(function* () {
        if (!gate()) return {};
        const answer = yield* Effect.provide(client.notebook(), FetchHttpClient.layer);
        return answer === undefined ? {} : carried<NotebookReadResult>(answer);
      }),
    [GATEWAY_METHOD.CONVERSATION_RATE_MESSAGE]: (params) =>
      Effect.gen(function* () {
        const read = readEither(conversationRateMessageParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read))
          return yield* invalid("a rating names one message and one verdict");
        const { messageId, rating } = read.success;
        // A rating names the device it came from, so before this installation's
        // row is registered there is nothing to send one as.
        const deviceId = devices.deviceId();
        if (!gate() || deviceId === undefined)
          return yield* rateAnswer(CONVERSATION_RATE_STATUS.UNAVAILABLE);
        const target = sync.rateable(messageId);
        if (target === undefined) return yield* rateAnswer(CONVERSATION_RATE_STATUS.NOT_FOUND);
        const written = yield* Effect.provide(
          client.rate(messageId, { rating, deviceId }),
          FetchHttpClient.layer,
        );
        if (!written.ok) return yield* rateAnswer(RATE_REFUSAL_STATUS[written.refusal]);
        sync.recordRating(messageId, written.answer.seq, { rating });
        publish();
        settings.recordProductEvent(PRODUCT_EVENT.CONVERSATION_RATED, {
          rating,
          message_kind: target.announcement
            ? PRODUCT_RATED_MESSAGE_KIND.ANNOUNCEMENT
            : PRODUCT_RATED_MESSAGE_KIND.REPLY,
        });
        return yield* rateAnswer(CONVERSATION_RATE_STATUS.RATED);
      }),
  };

  return {
    methods,
    loop,
    snapshot,
    reset,
    // The supervisor the account gate arms owns this loop's cadence, and its
    // disarm runs before any composer stops, so this concern holds nothing of
    // its own for the scope to give back.
    lifetime: Effect.void,
  };
}
