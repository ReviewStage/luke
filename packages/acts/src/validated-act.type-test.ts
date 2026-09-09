/**
 * The claim `admit` exists to make, checked by the compiler rather than by a
 * run: a `ValidatedAct` cannot be written down anywhere but inside `admit`.
 * Its brand is `@sidecar/wire`'s module-private `unique symbol`, so nothing
 * anywhere can spell the key an object literal would need, and no payload flows
 * into a performer's or an adapter's parameter on its own.
 *
 * What the type cannot stop is a deliberate `as ValidatedAct` assertion, since
 * the brand makes the admitted act a subtype of the payload and TypeScript
 * permits an assertion between the two. That one is caught by reading the diff
 * and by `git grep "as ValidatedAct"` answering with `admit` itself and nothing
 * else, which is the one place the repository enters the admitted set.
 *
 * This file exports nothing and runs nowhere. It fails by an `@ts-expect-error`
 * that stops erroring, which `tsc` reports as an error of its own.
 */

import type { ACT_KIND, CarriedAct } from "./act-kinds.js";
import { admit, type ValidatedAct } from "./admit.js";

declare const carried: CarriedAct<typeof ACT_KIND.MESSAGE>;
declare const admittedMessage: ValidatedAct<typeof ACT_KIND.MESSAGE>;
declare function takesAdmitted(act: ValidatedAct<typeof ACT_KIND.MESSAGE>): void;

// @ts-expect-error a plain payload is not admitted: the brand is a module-private symbol.
takesAdmitted(carried);

// @ts-expect-error nothing outside admit.ts can spell the brand, so no literal satisfies it.
takesAdmitted({ ...carried, origin: "user" });

declare const words: string;
// @ts-expect-error a value of another shape is not an act, admitted or otherwise.
takesAdmitted(words);

// @ts-expect-error one kind's admission is not another's.
const wrongKind: ValidatedAct<typeof ACT_KIND.CONTROL> = admittedMessage;
void wrongKind;

// The one producer typechecks, and what it mints is what a performer takes.
declare const request: Parameters<typeof admit<typeof ACT_KIND.MESSAGE>>[0];
declare const context: Parameters<typeof admit<typeof ACT_KIND.MESSAGE>>[1];
void (async () => {
  const result = await admit(request, context);
  if (result.kind !== undefined) takesAdmitted(result);
});
