/**
 * host-acts.ts -- the table a composer answers the host's declared acts by: each act's handler, handed its input read and answering its output, a row write's built only from its write declaration.
 *
 * An act declared in the contract (`contract/declared-act.ts`) is answered
 * here directly, with no Gateway method between the window's port and the
 * composer: the port reads the input whole, the handler answers it, and
 * `act-port/declared-acts.ts` draws a refusal or a defect as the act
 * declares. A row write's handler is typed by `@repo/sync`'s brand, so only
 * `declaredWrite` builds one and the write is drawn over the pool the moment
 * it is asked, as a row write's Gateway method is (`gateway-door.ts`).
 * A live follow (`contract/live-follow.ts`) is answered by its read's
 * `{ hold, retry }` (`LiveFollowHandler`), and its slice is told through
 * `liveTold`, which the client writes into app state whatever read it is.
 */

import { carried, GATEWAY_EVENT } from "@repo/gateway";
import type { ACT, DeclaredHandler } from "@repo/sync";
import { Context, Data, type Effect, type Scope } from "effect";
import type { AppState } from "./app-state.js";
import type {
  ActInput,
  ActOutput,
  AnyHostAct,
  AnyHostActDeclaration,
  AnyLiveFollow,
  AnyLiveFollowDeclaration,
  FollowKey,
  HOST_ACTS,
} from "./contract/index.js";
import type { HostKernel } from "./host-kernel.js";

/**
 * A handler's refusal in words of its own: the window hears `sentence`, or
 * the act's own refusal where none is given, and never the act's
 * `unanswered`. It is an answer, not a failure, so nothing logs it.
 */
export class ActRefused extends Data.TaggedError("ActRefused")<{
  readonly sentence?: string;
}> {}

/**
 * The opaque reporter naming the window that asked an act, for a handler
 * whose change event is not echoed back to that window; none where the
 * port asked under no window of its own. Only a procedure written by hand
 * provides it, since the window's input never carries it.
 */
export const ActReporter = Context.Reference<string | undefined>("@repo/host/ActReporter", {
  defaultValue: () => undefined,
});

/** An act's handler: its input, read whole by the port, answered. `ActRefused` is refused as it says; any other failure is drawn as the act declares. */
export type ActHandler<Declaration extends AnyHostActDeclaration> = (
  input: ActInput<Declaration>,
) => Effect.Effect<ActOutput<Declaration>, unknown>;

/**
 * A live follow's read, as the composer that follows it hands it: the hold
 * a window's stream stands for, which counts its holders, so two windows
 * holding the same key share one follow, and its Try again.
 */
export interface LiveFollowHandler<Follow extends AnyLiveFollowDeclaration> {
  /** Holds the read `key` names for the caller's scope; none for a read the account holds. */
  readonly hold: (key: FollowKey<Follow>) => Effect.Effect<void, never, Scope.Scope>;
  /** Asks the read again at once, as Try again asks. */
  readonly retry: (key: FollowKey<Follow>) => Effect.Effect<void>;
}

/** One declared act's handler: a live follow's by its read, a row write's only from its write declaration, every other act's by any handler. */
type HandlerOf<Act> = Act extends AnyLiveFollow
  ? LiveFollowHandler<Act>
  : Act extends AnyHostAct
    ? Act["door"] extends typeof ACT.ROW_WRITE
      ? DeclaredHandler<ActHandler<Act>>
      : ActHandler<Act>
    : never;

/** The handlers of `Acts`, by name (`HandlerOf`). */
export type HostActTable<
  Acts extends Readonly<Record<string, AnyHostAct | AnyLiveFollow>> = typeof HOST_ACTS,
> = {
  readonly [Name in keyof Acts]: HandlerOf<Acts[Name]>;
};

/**
 * How a composer tells `follow`'s slice as it moves: one event every live
 * follow shares (`LIVE_READ_CHANGED`), named by its slice, which the client
 * writes into app state as it stands. Note that the slice is told as a
 * statement, on the stack it moved on, as a held read tells it.
 */
export function liveTold<Follow extends AnyLiveFollowDeclaration>(
  emit: HostKernel["emit"],
  follow: Follow,
): (held: AppState[Follow["slice"]]) => void;
/** How a composer tells one of the other slices `follow` is told on (`alsoTold`), as `liveTold` tells its own. */
export function liveTold<
  Follow extends AnyLiveFollowDeclaration,
  Slice extends Follow["told"][number],
>(emit: HostKernel["emit"], follow: Follow, slice: Slice): (held: AppState[Slice]) => void;
export function liveTold(
  emit: HostKernel["emit"],
  follow: AnyLiveFollowDeclaration,
  slice: AnyLiveFollowDeclaration["slice"] = follow.slice,
): (held: unknown) => void {
  return (held) => emit(GATEWAY_EVENT.LIVE_READ_CHANGED, carried({ read: slice, held }));
}
