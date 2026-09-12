import type { Effect } from "effect";
import type { StoreWriter } from "../../server/hosted/store";
import { type AskDeliveryBinding, type AskRecord, askRecord } from "../../server/hosted/store/asks";
import type { HostedStoreTestRun } from "./hosted-store-database";

/**
 * An effect-shaped collaborator as a promise-shaped suite takes it. It lived
 * in `server/hosted/fiber-runner.ts` until P12-18c took `StreamRelay` and
 * `carryStop` onto effects, which left no module under `server/` holding a
 * promise-shaped seam; what is left of it is here, for the suites that
 * predate `it.effect`, and it goes with the last of them.
 *
 * @deprecated A strangler shim, test support only. It goes with each suite as
 * it moves onto `it.effect`.
 */
type Promised<Methods> = {
  [Name in keyof Methods]: Methods[Name] extends (
    ...args: infer Args
  ) => Effect.Effect<infer Value, infer _Failure, infer _Services>
    ? (...args: Args) => Promise<Value>
    : never;
};

/**
 * The ask record as a suite still written on promises takes it: every method
 * run to a promise over the suite's own database runner, so a test reads
 * `await asks.named(...)` where the module it tests composes the effect
 * instead. New assertions belong on the effects themselves, through
 * `it.effect`; this is for the suites that predate them.
 */
/** The ask record as a promise-era suite holds it. */
type PromisedAskRecord = Promised<AskRecord & AskDeliveryBinding>;

/** The store writer as a promise-era suite holds it. */
type PromisedStoreWriter = Promised<StoreWriter>;

export function promisedAsks(run: HostedStoreTestRun): PromisedAskRecord {
  const asks = askRecord();
  return {
    record: (ask) => run(asks.record(ask)),
    named: (userId, id) => run(asks.named(userId, id)),
    latestSession: (userId, conversationId) => run(asks.latestSession(userId, conversationId)),
    dispatchOnce: (target, id, dispatch) => run(asks.dispatchOnce(target, id, dispatch)),
    cancelRequested: (id, at) => run(asks.cancelRequested(id, at)),
    bindDeliveries: (target, deliveryIds, turnId) =>
      run(asks.bindDeliveries(target, deliveryIds, turnId)),
    stoppedOn: (target, turnId) => run(asks.stoppedOn(target, turnId)),
  };
}

/** The store writer, composed on the suite's runner, with every method run to a promise. */
export function promisedWriter(run: HostedStoreTestRun, writer: StoreWriter): PromisedStoreWriter {
  return {
    consume: (target, event) => run(writer.consume(target, event)),
    enqueueTurn: (target, enqueue) => run(writer.enqueueTurn(target, enqueue)),
    dequeueTurn: (target, turnId) => run(writer.dequeueTurn(target, turnId)),
    requestTurnCancel: (target, cancel) => run(writer.requestTurnCancel(target, cancel)),
    recordCompaction: (target, compaction) => run(writer.recordCompaction(target, compaction)),
    recordEvent: (target, event) => run(writer.recordEvent(target, event)),
    recordUserMessage: (target, message) => run(writer.recordUserMessage(target, message)),
    attachAskLines: (target, turnId) => run(writer.attachAskLines(target, turnId)),
    spokenAskEnd: (target, end) => run(writer.spokenAskEnd(target, end)),
  };
}
