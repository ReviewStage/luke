/**
 * world-as-of.ts -- a snapshot wound back to an instant on the scrubber.
 *
 * The scrubber runs over the window the snapshot looks back on, from
 * `shippedSince` to `snapshotAt`, and an instant outside it is held to its
 * nearer end. Note that a snapshot whose `shipped` is full names only the
 * newest merges, so before the oldest of them it cannot say what merged,
 * nor when an agent's pull request missing from the list did. Its window
 * opens at that oldest merge instead (`scrubberOpenOf`). Winding back to an instant keeps what the snapshot can say
 * was so then:
 *
 *   - the pull requests merged by then, and no later ones;
 *   - an agent's pull request merged after then reads as still open;
 *   - an agent's pull request opened after then is not yet there;
 *   - an agent that moved after then reads as moving at that instant, since
 *     the snapshot keeps only its latest move.
 *
 * An agent's status, the planned issues, and the defects are kept as they
 * are now, since the snapshot holds no history of them.
 */

import { PULL_REQUEST_STATE } from "@luke/features/coding-agent-wire";
import {
  FACTORY_WORLD_BOUNDS,
  type FactoryAgent,
  type FactoryWorld,
} from "@luke/features/factory-world-wire";

function agentAsOf(
  agent: FactoryAgent,
  at: number,
  mergedLater: ReadonlySet<number>,
): FactoryAgent {
  const activityAt = Math.min(agent.activityAt, at);
  const pullRequest = agent.pullRequest;
  if (pullRequest === null) return { ...agent, activityAt };
  if (pullRequest.openedAt !== undefined && pullRequest.openedAt > at) {
    return { ...agent, activityAt, pullRequest: null };
  }
  if (mergedLater.has(pullRequest.number)) {
    return {
      ...agent,
      activityAt,
      pullRequest: { ...pullRequest, state: PULL_REQUEST_STATE.OPEN },
    };
  }
  return { ...agent, activityAt };
}

/** Where the scrubber's window opens: `shippedSince`, or the oldest merge named where `shipped` is full. */
export function scrubberOpenOf(world: FactoryWorld): number {
  if (world.shipped.length < FACTORY_WORLD_BOUNDS.MAX_SHIPPED) return world.shippedSince;
  const oldest = Math.min(...world.shipped.map((merged) => merged.mergedAt));
  return Math.min(world.snapshotAt, Math.max(world.shippedSince, oldest));
}

/**
 * The snapshot as of `instant`, held within its window: its `snapshotAt` is
 * that instant, and its `shippedSince` where the window opens, so a
 * snapshot wound back twice keeps the window it began with.
 */
export function factoryWorldAsOf(world: FactoryWorld, instant: number): FactoryWorld {
  const shippedSince = scrubberOpenOf(world);
  const at = Math.min(world.snapshotAt, Math.max(shippedSince, instant));
  const mergedLater = new Set(
    world.shipped.filter((merged) => merged.mergedAt > at).map((merged) => merged.number),
  );
  return {
    ...world,
    snapshotAt: at,
    shippedSince,
    shipped: world.shipped.filter((merged) => merged.mergedAt <= at),
    agents: world.agents.map((agent) => agentAsOf(agent, at, mergedLater)),
  };
}
