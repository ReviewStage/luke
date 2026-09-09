import type { UnparsedWireValue } from "@sidecar/wire";
import type { WebContents } from "electron";
import {
  ACT_OUTCOME_STATUS,
  ACT_REFUSAL,
  ACT_RESULT,
  ACT_SCHEMA,
  type Act,
  type ActKind,
  type ActOutcome,
  type ActPayload,
  type ActResultFor,
} from "#shared/messages/acts";

/**
 * Who is asking, as this process alone can tell: which window sent the act,
 * and which of the three surfaces that window is. A renderer cannot claim any
 * of it — the standing is read from the windows this process opened.
 */
export interface ActSender {
  sender: WebContents;
  /** A panel: the surface beside the housing, which types asks and presses rows. */
  panel: boolean;
  /** The hidden window the conversation lives in, and the one receiver of replies. */
  voice: boolean;
  /** The one-time introduction takeover, which stands before any account exists. */
  introduction: boolean;
}

/**
 * A row's own refusal, with the sentence the window that asked will draw. A
 * row raises this where the act is admissible but cannot be carried for a
 * reason worth saying; every other throw is answered with the kind's fixed
 * sentence instead, so nothing an exception happened to carry crosses back.
 */
export class ActRefused extends Error {}

/** What one kind does. The payload is the one its own schema admitted. */
export type ActRow<Kind extends ActKind> = (
  payload: ActPayload<Kind>,
  sender: ActSender,
) => ActResultFor<Kind> | Promise<ActResultFor<Kind>>;

/**
 * Every kind's row, total by construction: a kind added to the vocabulary
 * with no row does not build, which is the whole reason the dispatch is a
 * table rather than a switch.
 */
export type ActRows = { readonly [Kind in ActKind]: ActRow<Kind> };

export interface ActRouter {
  performAct<Kind extends ActKind>(
    act: Extract<Act, { kind: Kind }>,
    sender: ActSender,
  ): Promise<ActOutcome<Kind>>;
}

/** Any one kind's payload, which is what the union index below hands a row. */
type AnyActPayload = ActPayload<ActKind>;

/** The erased row shape the dispatch below calls; the kind's own types are checked by `ActRows`. */
// oxlint-disable-next-line anti-slop/no-unknown-returns -- This is the erased callable shape of one act's row.
type ErasedRow = (payload: AnyActPayload, sender: ActSender) => unknown;

function refused(reason: string): ActOutcome {
  return { status: ACT_OUTCOME_STATUS.REFUSED, reason };
}

/**
 * The one place a window's act becomes an effect. Four steps, in this order,
 * for every kind alike: the kind's payload schema is read again — the window's
 * preload read it before the invoke left, and reading it here is what makes
 * the schema the boundary rather than a courtesy a main-process caller could
 * skip; then that kind's row runs, which is where its trust checks live; then
 * the answer is checked against the kind's own guard; and a row that threw is
 * answered with the kind's fixed sentence. Nothing here refuses on a reason of
 * its own, and nothing dispatches on anything but the kind.
 */
export function createActRouter(rows: ActRows): ActRouter {
  async function perform(act: Act, sender: ActSender): Promise<ActOutcome> {
    if (!Object.hasOwn(ACT_SCHEMA, act.kind)) {
      return { status: ACT_OUTCOME_STATUS.UNKNOWN_ACT };
    }
    // SAFETY: an act's payload is the structured-clone value its own schema
    // admitted, which is what reading it again takes.
    const sent = ("payload" in act ? act.payload : undefined) as UnparsedWireValue;
    const read = ACT_SCHEMA[act.kind].read(sent);
    if (!read.ok) return refused(ACT_REFUSAL[act.kind]);
    try {
      // SAFETY: ActRows types every row by its own kind; the erasure is the
      // union index this dispatch is, and the answer is guarded below.
      const value = await (rows[act.kind] as ErasedRow)(read.value, sender);
      if (ACT_RESULT[act.kind](value) === false) return refused(ACT_REFUSAL[act.kind]);
      // SAFETY: the kind's own result guard admitted this value.
      return { status: ACT_OUTCOME_STATUS.DONE, value: value as ActResultFor<ActKind> };
    } catch (error) {
      return refused(error instanceof ActRefused ? error.message : ACT_REFUSAL[act.kind]);
    }
  }

  return {
    performAct: <Kind extends ActKind>(act: Extract<Act, { kind: Kind }>, sender: ActSender) =>
      // SAFETY: `perform` answers the outcome of the kind it was handed, which
      // is the kind this call named; the dispatch above erases the union.
      perform(act, sender) as Promise<ActOutcome<Kind>>,
  };
}
