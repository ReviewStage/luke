import { type AnyContractProcedure, defineMeta } from "@orpc/contract";
import type { Act } from "@repo/sync";
import { Schema as EffectSchema, Option } from "effect";
import { actProcedure, exactInput } from "./base.js";
import { type ActUse, PORT_ACT_KIND, PORT_ACT_USE } from "./kinds.js";

/**
 * declared-act.ts -- a host act said once: what it takes and answers, its refusal, who may ask it, what it does, and what a failure is drawn as.
 *
 * A declaration is the one statement of a plain act. Its procedure in the
 * act port's contract is derived from it here, and the host answers it
 * directly from a composer's handler table (`host-acts.ts`), relayed by
 * `act-port/declared-acts.ts`, with no Gateway method between them. Its
 * kind and use are read from `kinds.ts` by the name a call site spells,
 * never restated, so `PORT_ACT_USE` stays the one place the lint rule
 * reads a kind's use from. An act that does work of its own at the window,
 * a follow's hold, a dialog, an address opened, keeps a procedure written
 * by hand. A live read is not a plain act: its variant is declared beside
 * this one, never by widening it.
 */

/** Marks a procedure only a panel may ask, which the act port reads before anything else of the procedure runs. */
const [panelOnlyMeta, panelOnlyOf] = defineMeta("panelOnly", (incoming: true) => incoming);

export { panelOnlyOf };

/** An act's name as a call site spells it, the key of its kind in `PORT_ACT_KIND`. */
type PortActName = keyof typeof PORT_ACT_KIND;

/** What a plain act is, said once, as `hostAct` is handed it. */
export interface HostActSpec<Input, InputEncoded, Output, OutputEncoded, Door extends Act> {
  /** What a window sends, read whole: a key the schema does not name is refused. */
  readonly input: EffectSchema.Codec<Input, InputEncoded>;
  /** What the host answers, encoded as it crosses the port. */
  readonly output: EffectSchema.Codec<Output, OutputEncoded>;
  /** The sentence the window draws when the act is refused. */
  readonly refusal: string;
  /** Whether only a panel may ask it, every other window refused in `refusal`. */
  readonly panelOnly: boolean;
  /** What the act does (`@repo/sync`'s `ACT`); a row write is answered only from its write declaration. */
  readonly door: Door;
  /** What a refusal or a defect of the host's is drawn as, where the window draws one; with none, the act is refused in `refusal`. */
  readonly unanswered?: NoInfer<Output>;
}

/** The act port's contract procedure for an act: its refusal, its panel mark, its exact input, and its output flipped so the answer is encoded as it crosses. */
function procedureOf<Input, InputEncoded, Output, OutputEncoded>(
  spec: HostActSpec<Input, InputEncoded, Output, OutputEncoded, Act>,
) {
  const refusing = actProcedure(spec.refusal);
  const marked = spec.panelOnly ? refusing.meta(panelOnlyMeta(true)) : refusing;
  return marked.input(exactInput(spec.input)).output(EffectSchema.flip(spec.output));
}

/** A plain act as declared, before `declaredActs` names it. */
export interface HostActDeclaration<Input, InputEncoded, Output, OutputEncoded, Door extends Act> {
  readonly input: EffectSchema.Codec<Input, InputEncoded>;
  readonly output: EffectSchema.Codec<Output, OutputEncoded>;
  readonly refusal: string;
  readonly panelOnly: boolean;
  readonly door: Door;
  readonly unanswered: Option.Option<Output>;
  readonly procedure: ReturnType<typeof procedureOf<Input, InputEncoded, Output, OutputEncoded>>;
}

/** Any plain act's declaration, whatever it takes and answers: the bound every table and relay is written over. */
export interface AnyHostActDeclaration {
  readonly input: EffectSchema.Top;
  readonly output: EffectSchema.Top;
  readonly refusal: string;
  readonly panelOnly: boolean;
  readonly door: Act;
  readonly unanswered: Option.Option<unknown>;
  readonly procedure: AnyContractProcedure;
}

/** A plain act as named by `declaredActs`: its declaration, its name, and the kind and use `kinds.ts` holds for that name. */
type HostAct<Name extends PortActName, Declaration extends AnyHostActDeclaration> = Declaration & {
  readonly name: Name;
  readonly kind: (typeof PORT_ACT_KIND)[Name];
  readonly use: (typeof PORT_ACT_USE)[Name];
};

/** Any named plain act. */
export type AnyHostAct = HostAct<PortActName, AnyHostActDeclaration>;

/** What an act's handler is handed: its input, read. */
export type ActInput<Declaration extends AnyHostActDeclaration> = Declaration["input"]["Type"];

/** What an act's handler answers. */
export type ActOutput<Declaration extends AnyHostActDeclaration> = Declaration["output"]["Type"];

/** A domain's declarations, each named by its key. */
type NamedActs<Declarations extends { readonly [Name in PortActName]?: AnyHostActDeclaration }> = {
  readonly [Name in keyof Declarations & PortActName]: HostAct<
    Name,
    NonNullable<Declarations[Name]>
  >;
};

/** The contract procedures of `Acts`, keyed by each act's kind. */
type ActsContract<Acts extends Readonly<Record<string, AnyHostAct>>> = {
  readonly [Name in keyof Acts as Acts[Name]["kind"]]: Acts[Name]["procedure"];
};

/** One plain act, declared: `spec`, with its procedure derived. Name it in a domain's `declaredActs`. */
export function hostAct<Input, InputEncoded, Output, OutputEncoded, const Door extends Act>(
  spec: HostActSpec<Input, InputEncoded, Output, OutputEncoded, Door>,
): HostActDeclaration<Input, InputEncoded, Output, OutputEncoded, Door> {
  return {
    input: spec.input,
    output: spec.output,
    refusal: spec.refusal,
    panelOnly: spec.panelOnly,
    door: spec.door,
    // Note that presence is read rather than the value, because `undefined` is the fallback of an act that answers nothing.
    unanswered: "unanswered" in spec ? Option.some(spec.unanswered as Output) : Option.none(),
    procedure: procedureOf(spec),
  };
}

/** A domain's plain acts, each named by the key it is declared under, its kind and use read from `kinds.ts`. */
export function declaredActs<
  const Declarations extends { readonly [Name in PortActName]?: AnyHostActDeclaration },
>(declarations: Declarations): NamedActs<Declarations> {
  const named: Record<string, AnyHostAct> = {};
  for (const [name, declaration] of Object.entries(declarations)) {
    if (declaration === undefined) continue;
    // SAFETY: the declarations' keys are port act names, by their type.
    const key = name as PortActName;
    const use: ActUse = PORT_ACT_USE[key];
    named[name] = { ...declaration, name: key, kind: PORT_ACT_KIND[key], use };
  }
  // SAFETY: the loop above named every declaration under its own key.
  return named as NamedActs<Declarations>;
}

/** The act port's contract for `acts`: each act's derived procedure, keyed by its kind. */
export function contractOf<const Acts extends Readonly<Record<string, AnyHostAct>>>(
  acts: Acts,
): ActsContract<Acts> {
  const procedures = Object.fromEntries(
    Object.values(acts).map((act) => [act.kind, act.procedure]),
  );
  // SAFETY: each procedure is keyed by its own act's kind, as the type maps it.
  return procedures as ActsContract<Acts>;
}
