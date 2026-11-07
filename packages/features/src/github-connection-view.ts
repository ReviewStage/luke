import { Schema as EffectSchema } from "effect";

/**
 * github-connection-view.ts -- whether the account has a GitHub account linked, as the window reads it.
 *
 * The view's copy of the connection the service answers, declared apart from
 * `github-connection-wire.ts`, which takes it from here, because the window
 * reads it and that one's claim vocabulary has no business in the window's
 * bundle; and apart from `tasks-view.ts`, which carries it, because the
 * contract tree reads it through the wire and `tasks-view.ts` reads the
 * contract tree.
 */

/** Whether the account has a GitHub account linked, and its login where the service holds one. */
export const githubConnectionSchema = EffectSchema.Struct({
  connected: EffectSchema.Boolean,
  login: EffectSchema.NullOr(EffectSchema.String),
});
