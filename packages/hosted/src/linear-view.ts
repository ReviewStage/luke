import { Schema as EffectSchema } from "effect";
import { linearStatusAnswerSchema } from "./linear-wire.js";

/**
 * linear-view.ts -- an account's Linear connection as one Mac's window hears it: where it stands, or why there is no answer.
 *
 * The host asks the service on the window's behalf and answers the window
 * one of the shapes here. A Connect's answer is only whether the browser
 * was sent to sign in: the address the service answered is opened by the
 * host and never reaches a window, since it begins a grant for the account.
 */

/** Why a Linear call answered nothing a window can draw. */
export const LINEAR_CALL_FAILURE = {
  /** The call never reached an answer: no credential, the network, a shape not read. */
  UNANSWERED: "unanswered",
  /** The service could not do it now: no Linear on this deployment, or Vercel Connect unreachable. */
  UNAVAILABLE: "unavailable",
  /** The sign-in address could not be opened on this Mac. */
  NOT_OPENED: "not-opened",
} as const;

export type LinearCallFailure = (typeof LINEAR_CALL_FAILURE)[keyof typeof LINEAR_CALL_FAILURE];

const failed = EffectSchema.Struct({
  failure: EffectSchema.Literals(Object.values(LINEAR_CALL_FAILURE)),
});

/** Where the connection stands, read or left by a Disconnect, as the window hears it. */
export const linearStatusViewSchema = EffectSchema.Union([linearStatusAnswerSchema, failed]);

export type LinearStatusView = typeof linearStatusViewSchema.Type;

/** A Connect as the window hears it: the browser sent to sign in, or why not. */
export const linearConnectViewSchema = EffectSchema.Union([
  EffectSchema.Struct({ opened: EffectSchema.Literal(true) }),
  failed,
]);

export type LinearConnectView = typeof linearConnectViewSchema.Type;
