import type { ContractedRouter } from "@orpc/server";
import { Cause, Effect, Schema as EffectSchema, Option } from "effect";
import type { ActInput, ActOutput, AnyHostAct } from "../contract/index.js";
import type { ActHandler, HostActTable } from "../host-acts.js";
import { type ActPortContext, actPort } from "./base.js";

/**
 * declared-acts.ts -- every declared act's procedure, built once: the composer's handler answering the window directly.
 *
 * The port has refused an untrusted frame, and a window that is not a panel
 * where the act is the panel's alone (`base.ts`), and read the input whole,
 * before the handler is asked. What the handler ends in is the act's answer
 * as it declares: its output, checked against the act's schema; or, for a
 * refusal, a defect, or an answer the schema does not carry, the act's
 * `unanswered` where it declares one, and its refusal where it does not.
 * A defect is reported where it stands, as the Gateway reported one.
 */

/** The procedures of the acts `Names` names, as the port's router types them. */
type DeclaredProcedures<
  Acts extends Readonly<Record<string, AnyHostAct>>,
  Names extends keyof Acts,
> = ContractedRouter<
  { readonly [Name in Names as Acts[Name]["kind"]]: Acts[Name]["procedure"] },
  ActPortContext
>;

/** A procedure's body as `actPort`'s builder takes it, for an act read by its name rather than its kind. */
interface DeclaredProcedureBuilder {
  effect(
    body: (options: { readonly input: unknown }) => Generator<unknown, unknown, never>,
  ): unknown;
}

/** One act's answer to `input`, as the port gives it to the window. */
function answered<Act extends AnyHostAct>(
  act: Act,
  handler: ActHandler<Act>,
  input: ActInput<Act>,
): Effect.Effect<ActOutput<Act>, unknown> {
  const carries = EffectSchema.is(act.output);
  return Effect.suspend(() => handler(input)).pipe(
    Effect.withErrorReporting({ defectsOnly: true }),
    Effect.filterOrFail(carries, () => new Error(`${act.kind} answered a shape it cannot carry`)),
    Effect.catchCause((cause) =>
      // Note that an interrupted call is the window gone, so nothing is drawn for it.
      Cause.hasInterruptsOnly(cause)
        ? Effect.failCause(cause)
        : Option.match(act.unanswered, {
            onNone: () => Effect.failCause(cause),
            onSome: (unanswered) => Effect.succeed(unanswered),
          }),
    ),
  );
}

/**
 * The act port's procedure for each act `handlers` answers, keyed by the
 * act's kind. The host hands every act's handler (`HostActTable`), so its
 * router answers every declared kind; a test may hand only the ones it calls.
 */
export function declaredActProcedures<
  const Acts extends Readonly<Record<string, AnyHostAct>>,
  const Handlers extends Partial<HostActTable<Acts>>,
>(acts: Acts, handlers: Handlers): DeclaredProcedures<Acts, keyof Handlers & keyof Acts> {
  const procedures: Record<string, unknown> = {};
  for (const [name, handler] of Object.entries(handlers)) {
    const act = acts[name];
    if (act === undefined || handler === undefined) continue;
    // SAFETY: a declared act's kind keys its own procedure in the contract `actPort` implements.
    const builder = actPort[
      act.kind as keyof typeof actPort
    ] as unknown as DeclaredProcedureBuilder;
    procedures[act.kind] = builder.effect(function* ({ input }) {
      // SAFETY: the port read `input` with the act's own input schema before this body runs, and the handler is the act's own.
      return yield* answered(act, handler as ActHandler<typeof act>, input as ActInput<typeof act>);
    });
  }
  // SAFETY: the loop above built each handed act's procedure under its own kind.
  return procedures as DeclaredProcedures<Acts, keyof Handlers & keyof Acts>;
}
