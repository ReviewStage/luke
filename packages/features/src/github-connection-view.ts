import { Schema as EffectSchema } from "effect";

/**
 * github-connection-view.ts -- whether the account has a GitHub account linked, as the view and the wire both read it.
 *
 * Its own module, so the tasks view, which the window reads, takes it
 * without `github-connection-wire.ts`'s claim vocabulary, and the GitHub
 * contract takes it without the tasks view, which reads the workspace
 * failures derived from the contracts (`workspace-call.ts`).
 */

/** Whether the account has a GitHub account linked, and its login where the service holds one. */
export const githubConnectionSchema = EffectSchema.Struct({
  connected: EffectSchema.Boolean,
  login: EffectSchema.NullOr(EffectSchema.String),
});
