/**
 * hosted-failure.ts -- a hosted procedure's failures as its domain spells them: the set a domain draws from, and the answer that crosses to a window.
 *
 * A procedure's contract declares the refusals it may answer
 * (`contract/base.ts`). A domain reads each refusal its procedures declare
 * as a failure spelled as the refusal's slug, or as the older spelling it
 * shipped where the domain renames it (`as`); a refusal any procedure may
 * answer (`ANY_PROCEDURE_REFUSALS`) is read as no answer unless the domain
 * renames it; and a live read reads a bearer refused as signed out
 * (`live`). Beside them stands no answer at all, `unanswered`, for every
 * call that ended without one.
 *
 * `failureSetOf` derives a domain's failures from its contract, as the
 * constant object every `*_CALL_FAILURE` is, and `answerView` derives the
 * schema of a procedure's answer as it crosses to a window: its output, or
 * a failure with the fields its refusal carries and the facts of what
 * failed beneath it. `hostedCall` (`hosted-call.ts`) reads a call's failure
 * the same way, so the three always agree.
 *
 * It names no client and no transport, so a window's bundle reads it.
 */

import {
  type AnyProcedureContract,
  type InferSchemaInput,
  type InferSchemaOutput,
  ProcedureContract,
} from "@orpc/contract";
import { Schema } from "effect";
import { ANY_PROCEDURE_REFUSALS } from "./contract/base.js";
import { HOSTED_REFUSAL_DATA, refusalCarriesData } from "./contract/errors.js";
import { procedureOutputWire } from "./contract/output-wire.js";
import { type FailureFacts, failureFactsSchema } from "./failure-facts.js";
import { LIVE_SIGNED_OUT } from "./live-wire.js";
import type { HostedApiError } from "./service-wire.js";

/** The failure every hosted call may end with: it reached no answer a domain names. */
export const HOSTED_CALL_FAILURE = {
  UNANSWERED: "unanswered",
} as const;

/** The failures a domain renames, by the refusal each stands for, where an older spelling shipped. */
export type HostedRenames = Readonly<Partial<Record<HostedApiError, string>>>;

/** No renames. */
type NoRenames = Readonly<Record<never, never>>;

/**
 * How a domain reads its procedures' refusals: each renamed where `as`
 * names it, and a refused bearer as signed out where `live` is set.
 */
export interface HostedReading<As extends HostedRenames = NoRenames, Live extends boolean = false> {
  readonly as?: As;
  readonly live?: Live;
}

/** A refusal any procedure may answer. */
type AnyProcedureRefusal = (typeof ANY_PROCEDURE_REFUSALS)[number];

/** The refusals a procedure declares that it is read as failing with: its own, and any procedure's that the domain renames. */
type Named<Declared, As> = Exclude<Declared, AnyProcedureRefusal> | Extract<Declared, keyof As>;

/** A refusal's failure as the domain spells it. */
type Spelled<Slug, As> = Slug extends keyof As ? Extract<As[Slug], string> : Extract<Slug, string>;

/** The fields a refusal carries beside its slug, by its slug. */
type DataOf<Slug> = Slug extends keyof typeof HOSTED_REFUSAL_DATA
  ? (typeof HOSTED_REFUSAL_DATA)[Slug]["Type"]
  : NoRenames;

/** The schema fields a refusal carries beside its slug, by its slug. */
type DataFieldsOf<Slug> = Slug extends keyof typeof HOSTED_REFUSAL_DATA
  ? (typeof HOSTED_REFUSAL_DATA)[Slug]["fields"]
  : never;

/** A union of records as the one record that holds each of their fields. */
type Merged<Union> = (Union extends unknown ? (record: Union) => void : never) extends (
  record: infer Record,
) => void
  ? Record
  : never;

/** A call that reached no answer, with the facts of what failed beneath it, which a window reports and never draws (`failure-facts.ts`). */
interface HostedUnansweredFailure {
  readonly failure: typeof HOSTED_CALL_FAILURE.UNANSWERED;
  readonly cause?: FailureFacts;
}

/** A refusal read as its domain's failure, with the fields it carries beside its slug. */
type Refused<Slug, As> = Slug extends string
  ? { readonly failure: Spelled<Slug, As> } & DataOf<Slug>
  : never;

/** How a call of a procedure that declares the refusals `Declared` fails, as its domain reads it. */
export type HostedFailed<Declared, As = NoRenames, Live = false> =
  | Refused<Named<Declared, As>, As>
  | HostedUnansweredFailure
  | (Live extends true ? typeof LIVE_SIGNED_OUT : never);

/** The failure values a call of such a procedure may end with. */
type FailureOf<Declared, As, Live> =
  | Spelled<Named<Declared, As>, As>
  | typeof HOSTED_CALL_FAILURE.UNANSWERED
  | (Live extends true ? typeof LIVE_SIGNED_OUT.failure : never);

/** The refusals a procedure, or every procedure of a group, declares. */
type DeclaredIn<Group> =
  Group extends ProcedureContract<infer _Input, infer _Output, infer Errors>
    ? keyof Errors & HostedApiError
    : { [Key in keyof Group]: DeclaredIn<Group[Key]> }[keyof Group];

/** A failure's spelling as the name of its constant: `not-found` is `NOT_FOUND`. */
type ConstantName<Spelling extends string> = Spelling extends `${infer Head}-${infer Tail}`
  ? `${Uppercase<Head>}_${ConstantName<Tail>}`
  : Uppercase<Spelling>;

/** A domain's failures as one constant object, each under its constant's name. */
export type HostedFailureSet<Failure extends string> = {
  readonly [Spelling in Failure as ConstantName<Spelling>]: Spelling;
};

/**
 * The schema a procedure's answer is read with as it crosses to a window:
 * its output, or how it failed. The output is typed from the contract as
 * oRPC reads it, its decoded side the handler's answer (the contract
 * declares the wire schema flipped).
 */
export type HostedAnswerView<Procedure, As, Live> =
  Procedure extends ProcedureContract<infer _Input, infer Output, infer _Errors>
    ? Schema.Union<
        readonly [
          Schema.Codec<InferSchemaInput<Output>, InferSchemaOutput<Output>>,
          Schema.Struct<
            {
              readonly failure: Schema.Literals<
                ReadonlyArray<FailureOf<DeclaredIn<Procedure>, As, Live>>
              >;
              readonly cause: Schema.optionalKey<Schema.Codec<FailureFacts>>;
            } & Merged<DataFieldsOf<Named<DeclaredIn<Procedure>, As>>>
          >,
        ]
      >
    : never;

/**
 * A refusal's failure as the reading spells it: its rename, its own slug
 * where any procedure would not answer it, and nothing where it is any
 * procedure's refusal the domain does not name.
 */
export function spelledFailure(
  refusal: HostedApiError,
  reading: HostedReading<HostedRenames, boolean>,
): string | undefined {
  const renamed = reading.as?.[refusal];
  if (renamed !== undefined) return renamed;
  return ANY_PROCEDURE_REFUSALS.some((any) => any === refusal) ? undefined : refusal;
}

/** Every procedure of a group, the group's nested groups' among them. */
function proceduresIn(group: unknown): readonly AnyProcedureContract[] {
  if (group instanceof ProcedureContract) return [group];
  if (typeof group !== "object" || group === null) return [];
  return Object.values(group).flatMap(proceduresIn);
}

/** The refusals the procedures declare, each once. */
function declaredBy(procedures: readonly AnyProcedureContract[]): readonly HostedApiError[] {
  const declared = new Set<HostedApiError>();
  for (const procedure of procedures) {
    for (const refusal of Object.keys(procedure["~orpc"].errorMap)) {
      // SAFETY: every hosted procedure declares its refusals from the one map, keyed by `HostedApiError`.
      declared.add(refusal as HostedApiError);
    }
  }
  return [...declared];
}

/** The failures the procedures may end with, each once: their refusals as spelled, signed out for a live read, and no answer. */
function failuresOf(
  procedures: readonly AnyProcedureContract[],
  reading: HostedReading<HostedRenames, boolean>,
): readonly string[] {
  const spelled = declaredBy(procedures).flatMap((refusal) => {
    const failure = spelledFailure(refusal, reading);
    return failure === undefined ? [] : [failure];
  });
  const live = reading.live === true ? [LIVE_SIGNED_OUT.failure] : [];
  return [...new Set([...spelled, ...live, HOSTED_CALL_FAILURE.UNANSWERED])];
}

/**
 * A domain's failures, derived from its contract group: every refusal its
 * procedures declare as the domain reads it, and no answer, each under its
 * constant's name (`not-found` is `NOT_FOUND`), as an `as const` object.
 */
export function failureSetOf<
  Group,
  const As extends HostedRenames = NoRenames,
  Live extends boolean = false,
>(
  group: Group,
  reading: HostedReading<As, Live> = {},
): HostedFailureSet<FailureOf<DeclaredIn<Group>, As, Live>> {
  const entries = failuresOf(proceduresIn(group), reading).map(
    (failure) => [failure.toUpperCase().replaceAll("-", "_"), failure] as const,
  );
  // SAFETY: each entry is a failure the group's refusals spell, under its constant's name, as the type spells them.
  return Object.fromEntries(entries) as HostedFailureSet<FailureOf<DeclaredIn<Group>, As, Live>>;
}

/**
 * The schema of a procedure's answer as it crosses to a window: its output
 * as the wire schema reads it, or a failure the domain spells, with the
 * fields its refusal carries and the facts of what failed beneath it.
 */
export function answerView<
  Procedure extends AnyProcedureContract,
  const As extends HostedRenames = NoRenames,
  Live extends boolean = false,
>(
  procedure: Procedure,
  reading: HostedReading<As, Live> = {},
): HostedAnswerView<Procedure, As, Live> {
  const output = procedureOutputWire(procedure);
  if (output === undefined) throw new TypeError("A hosted procedure's output is a wire schema");
  const named = declaredBy([procedure]).filter(
    (refusal) => spelledFailure(refusal, reading) !== undefined,
  );
  const dataFields = named.flatMap((refusal) =>
    refusalCarriesData(refusal) ? Object.entries(HOSTED_REFUSAL_DATA[refusal].fields) : [],
  );
  const failed = Schema.Struct({
    failure: Schema.Literals(failuresOf([procedure], reading)),
    cause: Schema.optionalKey(failureFactsSchema),
    ...Object.fromEntries(dataFields),
  });
  // SAFETY: the union is the output and the failures the procedure's declaration spells, as the type spells them.
  return Schema.Union([output, failed]) as unknown as HostedAnswerView<Procedure, As, Live>;
}
