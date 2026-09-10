import type { SessionKey } from "../../core.js";
import type { HostedStore } from "../store/index.js";
import { BRAIN_HOST } from "./bounds.js";

/**
 * One request's or one wake's hold on a conversation. The lease is acquired
 * before the brain is opened and kept warm while it runs; a holder that
 * loses it — its heartbeat stalled past the lease's life — is told so, and a
 * holder that is done lets it go. A holder cut off by its function neither
 * releases nor heartbeats, so the row expires and the next holder takes it.
 */
export interface LeaseSeams {
  readonly store: Pick<HostedStore, "leases">;
  readonly userId: string;
  readonly sessionKey: SessionKey;
  readonly ownerId: string;
  readonly now: () => number;
  readonly ttlMs?: number;
  readonly heartbeatMs?: number;
  /** How the wait between attempts is spent; a timer unless a test says otherwise. */
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface HeldLease {
  readonly ownerId: string;
  /**
   * Starts the heartbeat: every interval the lease is moved along and `tick`
   * runs under it, and a lease this owner no longer holds ends the heartbeat
   * and tells `lost`. Answers the stop.
   */
  heartbeat(tick: () => Promise<void>, lost: () => void): () => void;
  /** Lets the lease go; a lease that has passed to another is left alone. */
  release(): Promise<void>;
}

function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function held(seams: LeaseSeams): HeldLease {
  const { store, userId, sessionKey, ownerId, now } = seams;
  const ttlMs = seams.ttlMs ?? BRAIN_HOST.LEASE_TTL_MS;
  return {
    ownerId,
    heartbeat(tick, lost) {
      let stopped = false;
      let beating = false;
      const timer = setInterval(() => {
        if (stopped || beating) return;
        beating = true;
        void (async () => {
          try {
            if (!(await store.leases.heartbeat(userId, sessionKey, ownerId, now(), ttlMs))) {
              stopped = true;
              clearInterval(timer);
              lost();
              return;
            }
            await tick();
          } catch {
            // A heartbeat that could not reach the store says nothing about
            // the lease; the next one asks again, and the row's own expiry
            // is the one judge of a holder that never reaches it.
          } finally {
            beating = false;
          }
        })();
      }, seams.heartbeatMs ?? BRAIN_HOST.HEARTBEAT_MS);
      timer.unref();
      return () => {
        stopped = true;
        clearInterval(timer);
      };
    },
    release: async () => {
      await store.leases.release(userId, sessionKey, ownerId);
    },
  };
}

/** Takes the lease now, or answers nothing while another holder's stands. */
export async function acquireLeaseNow(seams: LeaseSeams): Promise<HeldLease | undefined> {
  const taken = await seams.store.leases.acquire(
    seams.userId,
    seams.sessionKey,
    seams.ownerId,
    seams.now(),
    seams.ttlMs ?? BRAIN_HOST.LEASE_TTL_MS,
  );
  return taken ? held(seams) : undefined;
}

/**
 * Takes the lease, waiting a bounded while for a holder under way to finish:
 * an ask that arrives while a wake runs the conversation waits for it rather
 * than being refused, and one that would wait longer than the bound is told
 * the conversation is busy.
 */
export async function acquireLeaseWithin(
  seams: LeaseSeams,
  waitMs: number,
  pollMs: number = BRAIN_HOST.LEASE_POLL_MS,
): Promise<HeldLease | undefined> {
  const sleep = seams.sleep ?? realSleep;
  const deadline = seams.now() + waitMs;
  for (;;) {
    const lease = await acquireLeaseNow(seams);
    if (lease) return lease;
    if (seams.now() + pollMs > deadline) return undefined;
    await sleep(pollMs);
  }
}
