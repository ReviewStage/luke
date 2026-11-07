import { createORPCErrorConstructorMap } from "@orpc/contract";
import type { ContractedRouter } from "@orpc/server";
import { Cause, Effect, Schema as EffectSchema, Option } from "effect";
import { ACT_ERROR, type ActInput, type ActOutput, type AnyHostAct } from "../contract/index.js";
import { type ActHandler, ActRefused, type HostActTable } from "../host-acts.js";
import { type ActPortContext, actPort } from "./base.js";

/**
 * declared-acts.ts -- every declared act's procedure, built once: the composer's handler answering the window directly.
 *
 * The port has refused an untrusted frame, and a window that is not a panel
 * where the act is the panel's alone (`base.ts`), and read the input whole,
 * before the handler is asked. What the handler ends in is the act's answer
 * as it declares: its output, checked against the act's schema; its refusal,
 * in the handler's own sentence where it gives one, for an `ActRefused`; or,
 * for any other failure, a defect, or an answer the schema does not carry,
 * the act's `unanswered` where it declares one, and its refusal where it
 * does not.
 * A defect is reported where it stands, as the Gateway reported one.
 */

/** The procedures of the acts `Names` names that are relayed, as the port's router types them; an act written by hand has none here. */
type DeclaredProcedures<
  Acts extends Readonly<Record<string, AnyHostAct>>,
  Names extends keyof Acts,
> = ContractedRouter<
  {
    readonly [Name in Names as Acts[Name]["byHand"] extends true
      ? never
      : Acts[Name]["kind"]]: Acts[Name]["procedure"];
  },
  ActPortContext
>;

/** A procedure's body as `actPort`'s builder takes it, for an act read by its name rather than its kind. */
interface DeclaredProcedureBuilder {
  effect(
    body: (options: { readonly input: unknown }) => Generator<unknown, unknown, never>,
  ): unknown;
}

/** Whether a handler's failure is its own refusal. */
function isActRefused(error: unknown): error is ActRefused {
  return error instanceof ActRefused;
}

/** The act's own refusal, in `sentence` where one is given, as the error its contract declares. */
function refusalOf(act: AnyHostAct, sentence: string | undefined) {
  const refused = createORPCErrorConstructorMap(act.procedure["~orpc"].errorMap)[ACT_ERROR.REFUSED];
  // Note that every act contract declares the refusal (`contract/base.ts`), so this is an invariant rather than a branch.
  if (refused === undefined) throw new Error(`${act.kind} declares no refusal.`);
  return refused(sentence === undefined ? undefined : { message: sentence });
}

/** One act's answer to `input`, as the port gives it to the window; a procedure written by hand answers through it too, so it keeps the act's fallback. */
export function declaredAnswer<Act extends AnyHostAct>(
  act: Act,
  handler: ActHandler<Act>,
  input: ActInput<Act>,
): Effect.Effect<ActOutput<Act>, unknown> {
  const carries = EffectSchema.is(act.output);
  return Effect.suspend(() => handler(input)).pipe(
    Effect.withErrorReporting({ defectsOnly: true }),
    Effect.filterOrFail(carries, () => new Error(`${act.kind} answered a shape it cannot carry`)),
    Effect.catchCause((cause) => {
      // Note that an interrupted call is the window gone, so nothing is drawn for it.
      if (Cause.hasInterruptsOnly(cause)) return Effect.failCause(cause);
      const refused = Option.filter(Cause.findErrorOption(cause), isActRefused);
      if (Option.isSome(refused)) return Effect.fail(refusalOf(act, refused.value.sentence));
      return Option.match(act.unanswered, {
        onNone: () => Effect.failCause(cause),
        onSome: (unanswered) => Effect.succeed(unanswered),
      });
    }),
  );
}

/**
 * The act port's procedure for each act `handlers` answers, keyed by the
 * act's kind, but an act written by hand, whose own procedure calls its
 * handler. The host hands every act's handler (`HostActTable`), so its
 * router answers every declared kind; a test may hand only the ones it calls.
 */
export function declaredActProcedures<
  const Acts extends Readonly<Record<string, AnyHostAct>>,
  const Handlers extends Partial<HostActTable<Acts>>,
>(acts: Acts, handlers: Handlers): DeclaredProcedures<Acts, keyof Handlers & keyof Acts> {
  const procedures: Record<string, unknown> = {};
  for (const [name, handler] of Object.entries(handlers)) {
    const act = acts[name];
    if (act === undefined || handler === undefined || act.byHand) continue;
    // SAFETY: a declared act's kind keys its own procedure in the contract `actPort` implements.
    const builder = actPort[
      act.kind as keyof typeof actPort
    ] as unknown as DeclaredProcedureBuilder;
    procedures[act.kind] = builder.effect(function* ({ input }) {
      // SAFETY: the port read `input` with the act's own input schema before this body runs, and the handler is the act's own.
      return yield* declaredAnswer(
        act,
        handler as ActHandler<typeof act>,
        input as ActInput<typeof act>,
      );
    });
  }
  // SAFETY: the loop above built each handed act's procedure under its own kind.
  return procedures as DeclaredProcedures<Acts, keyof Handlers & keyof Acts>;
}
