import { type AnyContractProcedure, eventIterator, type } from "@orpc/contract";
import type { LiveRead } from "@repo/features/live-wire";
import { Schema as EffectSchema } from "effect";
import type { HostReadSlice } from "../app-state.js";
import { actProcedure, exactInput } from "./base.js";
import { panelOnlyMeta } from "./declared-act.js";
import { type ACT_USE, PORT_ACT_KIND, type PORT_ACT_USE } from "./kinds.js";

/**
 * live-follow.ts -- a live read the host follows for the windows said once: the slice it is told on, what a window holds it by, who may hold it, and its Try again.
 *
 * A window holds a live read by a stream it keeps open, which carries
 * nothing, since what the host holds reaches every window on app state; and
 * asks it again by its Try again. Both procedures are derived here from one
 * declaration, their kinds read from `kinds.ts` by the names a call site
 * spells, never restated, so `PORT_ACT_USE` stays the one place the lint
 * rule reads a kind's use from. The host answers both from the composer's
 * `{ hold, retry }` (`host-acts.ts`), relayed by `act-port/live-follows.ts`,
 * and writes the slice into app state itself. A follow is not a plain act
 * (`declared-act.ts`): its stream answers nothing, and letting it go is the
 * stream closing, which no act carries.
 */

/** What a window holds a live read by: a key of its own, or the account signed in, one hold for every window. */
export const HOLD = { WINDOW: "window", ACCOUNT: "account" } as const;

export type Hold = (typeof HOLD)[keyof typeof HOLD];

/** A port act a window reads by, as `kinds.ts` declares its use: a follow and its Try again are each one. */
type ReadActName = {
  [Name in keyof typeof PORT_ACT_USE]: (typeof PORT_ACT_USE)[Name] extends typeof ACT_USE.READ
    ? Name
    : never;
}[keyof typeof PORT_ACT_USE];

/** A slice a live follow is told on: a held read of app state. */
type FollowedSlice = LiveRead & HostReadSlice;

/** What every live follow says, whatever it is held by. */
interface LiveFollowSpecBase<Slice extends FollowedSlice> {
  /** The app-state slice the read is told on (`LIVE_READ`). */
  readonly slice: Slice;
  /** The sentence the window draws when its hold is refused. */
  readonly refusal: string;
  /** Whether only a panel may hold it, every other window refused. */
  readonly panelOnly: boolean;
}

/** A follow's Try again: the name a call site spells it by, and the sentence drawn when it is refused. */
interface RetrySpec<Retry extends ReadActName> {
  readonly retry: { readonly name: Retry; readonly refusal: string };
}

/** A follow with no Try again, whose window asks its read again by no act of its own. */
interface NoRetrySpec {
  readonly retry?: never;
}

/** A read held once for the account signed in, by every window that holds it. */
interface AccountFollowSpec<Slice extends FollowedSlice> extends LiveFollowSpecBase<Slice> {
  readonly hold: typeof HOLD.ACCOUNT;
  readonly key?: never;
}

/** A read each window holds by a key it names, read whole. */
interface WindowFollowSpec<Slice extends FollowedSlice, Key, KeyEncoded>
  extends LiveFollowSpecBase<Slice> {
  readonly hold: typeof HOLD.WINDOW;
  readonly key: EffectSchema.Codec<Key, KeyEncoded>;
}

/** A procedure's refusal and panel mark, as every act's are (`declared-act.ts`). */
function refusing(refusal: string, panelOnly: boolean) {
  const refused = actProcedure(refusal);
  return panelOnly ? refused.meta(panelOnlyMeta(true)) : refused;
}

/** The hold's procedure: the key read whole, and a stream that carries nothing, standing for as long as the window holds it. */
function followProcedureOf<Key, KeyEncoded>(
  refusal: string,
  panelOnly: boolean,
  key: EffectSchema.Codec<Key, KeyEncoded>,
) {
  return refusing(refusal, panelOnly).input(exactInput(key)).output(eventIterator(type<never>()));
}

/** The Try again's procedure: the same key, answered once the read is asked again. */
function retryProcedureOf<Key, KeyEncoded>(
  refusal: string,
  panelOnly: boolean,
  key: EffectSchema.Codec<Key, KeyEncoded>,
) {
  return refusing(refusal, panelOnly).input(exactInput(key)).output(EffectSchema.Void);
}

/** A live follow as declared, before `liveFollows` names it. */
export interface LiveFollowDeclaration<
  Slice extends FollowedSlice,
  Held extends Hold,
  Key,
  KeyEncoded,
  Retry extends ReadActName,
> {
  readonly slice: Slice;
  readonly hold: Held;
  readonly key: EffectSchema.Codec<Key, KeyEncoded>;
  readonly panelOnly: boolean;
  /** Its Try again's name, where it has one. */
  readonly retryName?: Retry;
  readonly procedure: ReturnType<typeof followProcedureOf<Key, KeyEncoded>>;
  readonly retryProcedure?: ReturnType<typeof retryProcedureOf<Key, KeyEncoded>>;
}

/** Any live follow's declaration, whatever it is keyed by: the bound every table and relay is written over. */
export interface AnyLiveFollowDeclaration {
  readonly slice: FollowedSlice;
  readonly hold: Hold;
  readonly key: EffectSchema.Top;
  readonly panelOnly: boolean;
  readonly retryName?: ReadActName;
  readonly procedure: AnyContractProcedure;
  readonly retryProcedure?: AnyContractProcedure;
}

/** A live follow as named by `liveFollows`: its declaration, its name, and the kinds `kinds.ts` holds for it and its Try again. */
type LiveFollow<
  Name extends ReadActName,
  Declaration extends AnyLiveFollowDeclaration,
> = Declaration & {
  readonly name: Name;
  readonly kind: (typeof PORT_ACT_KIND)[Name];
  readonly retryKind?: (typeof PORT_ACT_KIND)[NonNullable<Declaration["retryName"]>];
};

/** Any named live follow. */
export type AnyLiveFollow = LiveFollow<ReadActName, AnyLiveFollowDeclaration>;

/** What a live follow's hold and Try again are handed: the key its window named, read; none for one the account holds. */
export type FollowKey<Follow extends AnyLiveFollowDeclaration> = Follow["key"]["Type"];

/** A domain's live follows, each named by the key it is declared under. */
type NamedFollows<
  Declarations extends { readonly [Name in ReadActName]?: AnyLiveFollowDeclaration },
> = {
  readonly [Name in keyof Declarations & ReadActName]: LiveFollow<
    Name,
    NonNullable<Declarations[Name]>
  >;
};

/** The contract procedures of `Follows`: each hold's and each Try again's, keyed by its kind; a follow with no Try again has none. */
type FollowsContract<Follows extends Readonly<Record<string, AnyLiveFollow>>> = {
  readonly [Name in keyof Follows as Follows[Name]["kind"]]: Follows[Name]["procedure"];
} & {
  readonly [Name in keyof Follows as NonNullable<Follows[Name]["retryKind"]>]: NonNullable<
    Follows[Name]["retryProcedure"]
  >;
};

/** One live follow, declared: `spec`, with its hold's and its Try again's procedures derived. Name it in a domain's `liveFollows` under its hold's name. */
export function liveFollow<
  const Slice extends FollowedSlice,
  const Retry extends ReadActName,
  Key,
  KeyEncoded,
>(
  spec: WindowFollowSpec<Slice, Key, KeyEncoded> & RetrySpec<Retry>,
): LiveFollowDeclaration<Slice, typeof HOLD.WINDOW, Key, KeyEncoded, Retry>;
export function liveFollow<const Slice extends FollowedSlice, Key, KeyEncoded>(
  spec: WindowFollowSpec<Slice, Key, KeyEncoded> & NoRetrySpec,
): LiveFollowDeclaration<Slice, typeof HOLD.WINDOW, Key, KeyEncoded, never>;
export function liveFollow<const Slice extends FollowedSlice, const Retry extends ReadActName>(
  spec: AccountFollowSpec<Slice> & RetrySpec<Retry>,
): LiveFollowDeclaration<Slice, typeof HOLD.ACCOUNT, undefined, undefined, Retry>;
export function liveFollow<const Slice extends FollowedSlice>(
  spec: AccountFollowSpec<Slice> & NoRetrySpec,
): LiveFollowDeclaration<Slice, typeof HOLD.ACCOUNT, undefined, undefined, never>;
export function liveFollow<Slice extends FollowedSlice, Retry extends ReadActName, Key, KeyEncoded>(
  spec: (WindowFollowSpec<Slice, Key, KeyEncoded> | AccountFollowSpec<Slice>) &
    (RetrySpec<Retry> | NoRetrySpec),
): LiveFollowDeclaration<Slice, Hold, Key | undefined, KeyEncoded | undefined, Retry> {
  // Note that a read the account holds is held by no key of a window's, so its hold takes none.
  const key: EffectSchema.Codec<Key | undefined, KeyEncoded | undefined> =
    spec.hold === HOLD.WINDOW ? spec.key : EffectSchema.Undefined;
  const declared = {
    slice: spec.slice,
    hold: spec.hold,
    key,
    panelOnly: spec.panelOnly,
    procedure: followProcedureOf(spec.refusal, spec.panelOnly, key),
  };
  // Note that a follow with no Try again declares no procedure for one, so the port answers none.
  return spec.retry === undefined
    ? declared
    : {
        ...declared,
        retryName: spec.retry.name,
        retryProcedure: retryProcedureOf(spec.retry.refusal, spec.panelOnly, key),
      };
}

/** A domain's live follows, each named by its hold's name, its kind and its Try again's read from `kinds.ts`. */
export function liveFollows<
  const Declarations extends { readonly [Name in ReadActName]?: AnyLiveFollowDeclaration },
>(declarations: Declarations): NamedFollows<Declarations> {
  const named: Record<string, AnyLiveFollow> = {};
  for (const [name, declaration] of Object.entries(declarations)) {
    if (declaration === undefined) continue;
    // SAFETY: the declarations' keys are read act names, by their type.
    const key = name as ReadActName;
    const { retryName } = declaration;
    named[name] = {
      ...declaration,
      name: key,
      kind: PORT_ACT_KIND[key],
      ...(retryName === undefined ? undefined : { retryKind: PORT_ACT_KIND[retryName] }),
    };
  }
  // SAFETY: the loop above named every declaration under its own key.
  return named as NamedFollows<Declarations>;
}

/** Whether a declared act is a live follow rather than a plain act. */
export function isLiveFollow(act: object): act is AnyLiveFollow {
  return "slice" in act;
}

/** The act port's contract for `follows`: each hold's and each Try again's derived procedure, keyed by its kind. */
export function followsContractOf<const Follows extends Readonly<Record<string, AnyLiveFollow>>>(
  follows: Follows,
): FollowsContract<Follows> {
  const procedures = Object.fromEntries(
    Object.values(follows).flatMap((follow) =>
      follow.retryKind === undefined
        ? [[follow.kind, follow.procedure]]
        : [
            [follow.kind, follow.procedure],
            [follow.retryKind, follow.retryProcedure],
          ],
    ),
  );
  // SAFETY: each procedure is keyed by its own follow's kind, or its Try again's, as the type maps them.
  return procedures as FollowsContract<Follows>;
}
