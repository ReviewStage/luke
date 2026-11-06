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
 */

import type { ACT, DeclaredHandler } from "@repo/sync";
import { Data, type Effect } from "effect";
import type {
  ActInput,
  ActOutput,
  AnyHostAct,
  AnyHostActDeclaration,
  HOST_ACTS,
} from "./contract/index.js";

/**
 * A handler's refusal in words of its own: the window hears `sentence`, or
 * the act's own refusal where none is given, and never the act's
 * `unanswered`. It is an answer, not a failure, so nothing logs it.
 */
export class ActRefused extends Data.TaggedError("ActRefused")<{
  readonly sentence?: string;
}> {}

/** An act's handler: its input, read whole by the port, answered. `ActRefused` is refused as it says; any other failure is drawn as the act declares. */
export type ActHandler<Declaration extends AnyHostActDeclaration> = (
  input: ActInput<Declaration>,
) => Effect.Effect<ActOutput<Declaration>, unknown>;

/** The handlers of `Acts`, by name: a row write's only from its write declaration, every other act's by any handler. */
export type HostActTable<Acts extends Readonly<Record<string, AnyHostAct>> = typeof HOST_ACTS> = {
  readonly [Name in keyof Acts]: Acts[Name]["door"] extends typeof ACT.ROW_WRITE
    ? DeclaredHandler<ActHandler<Acts[Name]>>
    : ActHandler<Acts[Name]>;
};
