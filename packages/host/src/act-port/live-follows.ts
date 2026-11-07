import type { ContractedRouter } from "@orpc/server";
import { Stream } from "effect";
import type { AnyHostAct, AnyLiveFollow, FollowKey } from "../contract/index.js";
import { isLiveFollow } from "../contract/index.js";
import type { HostActTable, LiveFollowHandler } from "../host-acts.js";
import { type ActPortContext, actPort } from "./base.js";
import { streamed } from "./followed-stream.js";

/**
 * live-follows.ts -- every live follow's two procedures, built once: a window's hold as the scope of its read's own hold, and its Try again.
 *
 * The port has refused an untrusted frame, and a window that is not a panel
 * where the follow is the panel's alone (`base.ts`), and read the key whole,
 * before the read is held. A window's stream carries nothing and stands for
 * as long as the window holds it; its scope is the composer's own hold of
 * the read (`LiveFollowHandler`), which counts its holders, so two windows
 * holding the same key share one follow and the last to close lets it go.
 * What the read holds reaches every window on app state (`liveTold`), never
 * down the stream.
 */

/** The procedures of the follows `Names` names, a hold's and a Try again's each, as the port's router types them. */
type FollowProcedures<
  Acts extends Readonly<Record<string, AnyHostAct | AnyLiveFollow>>,
  Names extends keyof Acts,
> = ContractedRouter<
  {
    readonly [Name in Names as Acts[Name] extends AnyLiveFollow
      ? Acts[Name]["kind"]
      : never]: Acts[Name] extends AnyLiveFollow ? Acts[Name]["procedure"] : never;
  } & {
    readonly [Name in Names as Acts[Name] extends AnyLiveFollow
      ? Acts[Name]["retryKind"]
      : never]: Acts[Name] extends AnyLiveFollow ? Acts[Name]["retryProcedure"] : never;
  },
  ActPortContext
>;

/** A procedure's body as `actPort`'s builder takes it, for a follow read by its name rather than its kind. */
interface FollowProcedureBuilder {
  effect(
    body: (options: { readonly input: unknown }) => Generator<unknown, unknown, never>,
  ): unknown;
}

/** `actPort`'s builder of the procedure `kind` keys. */
function builderOf(kind: string): FollowProcedureBuilder {
  // SAFETY: a declared follow's kinds key its own procedures in the contract `actPort` implements.
  return actPort[kind as keyof typeof actPort] as unknown as FollowProcedureBuilder;
}

/**
 * The act port's hold and Try again for each live follow `handlers`
 * answers, keyed by their kinds. The host hands every follow's read
 * (`HostActTable`), so its router answers every declared kind; a test may
 * hand only the ones it holds.
 */
export function liveFollowProcedures<
  const Acts extends Readonly<Record<string, AnyHostAct | AnyLiveFollow>>,
  const Handlers extends Partial<HostActTable<Acts>>,
>(acts: Acts, handlers: Handlers): FollowProcedures<Acts, keyof Handlers & keyof Acts> {
  const procedures: Record<string, unknown> = {};
  for (const [name, handler] of Object.entries(handlers)) {
    const follow = acts[name];
    if (follow === undefined || handler === undefined || !isLiveFollow(follow)) continue;
    // SAFETY: a follow's handler is its read's, by `HostActTable`'s mapping.
    const read = handler as LiveFollowHandler<typeof follow>;
    procedures[follow.kind] = builderOf(follow.kind).effect(function* ({ input }) {
      // SAFETY: the port read `input` with the follow's own key schema before this body runs.
      const key = input as FollowKey<typeof follow>;
      return streamed(
        yield* Stream.toAsyncIterableEffect(Stream.callback<never>(() => read.hold(key))),
      );
    });
    procedures[follow.retryKind] = builderOf(follow.retryKind).effect(function* ({ input }) {
      // SAFETY: as the hold's, the key was read with the follow's own schema.
      yield* read.retry(input as FollowKey<typeof follow>);
    });
  }
  // SAFETY: the loop above built each handed follow's two procedures under their own kinds.
  return procedures as FollowProcedures<Acts, keyof Handlers & keyof Acts>;
}
