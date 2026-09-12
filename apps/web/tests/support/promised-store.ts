import type { Promised } from "../../server/hosted/fiber-runner";
import type { StoreWriter } from "../../server/hosted/store";
import { type AskDeliveryBinding, type AskRecord, askRecord } from "../../server/hosted/store/asks";
import type { HostedStoreTestRun } from "./hosted-store-database";

/**
 * The ask record as a suite still written on promises takes it: every method
 * run to a promise over the suite's own database runner, so a test reads
 * `await asks.named(...)` where the module it tests composes the effect
 * instead. New assertions belong on the effects themselves, through
 * `it.effect`; this is for the suites that predate them.
 */
export function promisedAsks(run: HostedStoreTestRun): Promised<AskRecord & AskDeliveryBinding> {
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
export function promisedWriter(
  run: HostedStoreTestRun,
  writer: StoreWriter,
): Promised<StoreWriter> {
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
