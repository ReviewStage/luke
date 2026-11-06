import { Effect, Result } from "effect";
import {
  LIST_ORDER,
  type ListedSandbox,
  type ListOrder,
  type VercelSandboxApi,
} from "../agents/vercel-sandbox-api.js";

const ORDER_PERIOD_MS = 60_000;

export function listOrderAt(now: Date): ListOrder {
  return Math.floor(now.getTime() / ORDER_PERIOD_MS) % 2 === 0
    ? LIST_ORDER.OLDEST_FIRST
    : LIST_ORDER.NEWEST_FIRST;
}

export const listRunningSandboxes = <Kept>(
  api: VercelSandboxApi,
  order: ListOrder,
  maxPages: number,
  pick: (sandbox: ListedSandbox) => Kept | undefined,
) =>
  Effect.gen(function* () {
    const found: Kept[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < maxPages; page += 1) {
      const asked = yield* Effect.result(api.listRunning(cursor, order));
      if (Result.isFailure(asked)) {
        if (page === 0) return yield* asked.failure;
        yield* Effect.logWarning(
          `a later page of the running sandboxes was not listed: ${asked.failure.message}`,
        );
        break;
      }
      const listed = asked.success;
      for (const sandbox of listed.sandboxes) {
        const kept = pick(sandbox);
        if (kept !== undefined) found.push(kept);
      }
      cursor = listed.next;
      if (cursor === undefined) break;
    }
    return found;
  });

export function windowAt<Listed>(found: readonly Listed[], width: number, now: Date): Listed[] {
  if (found.length <= width) return [...found];
  const sweepsFromThisEnd = Math.floor(now.getTime() / (2 * ORDER_PERIOD_MS));
  const start = (sweepsFromThisEnd * width) % found.length;
  return [...found.slice(start), ...found.slice(0, start)].slice(0, width);
}
