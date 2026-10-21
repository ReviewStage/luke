import { Effect } from "effect";
import { confirmWrite, type TxWait } from "./live-follow.js";

/**
 * inbox-tx-waits.ts -- the waits the followed inboxes hand out, raced, so a member's mark, answer, or close is answered once an inbox that shows it has its transaction.
 *
 * A member's write on an item names the item alone, and the item may show
 * in any inbox the windows follow: its plan's, its agent's, and the
 * account's. Each of those follows hands its wait here while it is
 * subscribed over Realtime (`liveRows`'s `onTxWait`) and takes it back
 * once it is let go or polled. A write is confirmed once the first of them
 * has its transaction, as a read's own parts settle a wait by the first
 * that has it, since a transaction reaches only the subscriptions whose
 * rows it changed. With none standing, or no txid, it is confirmed at once
 * (`confirmWrite`), so a polled inbox never holds a write's answer.
 */

/** The followed inboxes' waits, and the one confirmation every inbox write waits on. */
export interface InboxTxWaits {
  /** A follow's own hook for `liveRows`'s `onTxWait`, which stands its wait while it is handed and takes back only its own. */
  readonly hook: () => (wait: TxWait | undefined) => void;
  /** Settles once a followed inbox has the transaction, or at once with none to wait on, or once the bound passes. */
  readonly confirm: (txid: string | undefined) => Effect.Effect<void>;
}

/** The composer's one set of inbox waits, for as long as it stands. */
export function inboxTxWaits(): InboxTxWaits {
  // Note that each follow's wait is kept under a token of its own, because a follow sealed again stands beside the one it replaces until that one's release runs.
  const standing = new Map<object, TxWait>();
  const raced: TxWait = (txid, timeout) =>
    Effect.raceAll([...standing.values()].map((wait) => wait(txid, timeout)));
  return {
    hook: () => {
      const token = {};
      return (wait) => {
        if (wait === undefined) standing.delete(token);
        else standing.set(token, wait);
      };
    },
    confirm: (txid) =>
      Effect.suspend(() => confirmWrite(standing.size === 0 ? undefined : raced, txid)),
  };
}
