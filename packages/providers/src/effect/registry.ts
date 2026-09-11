/**
 * The provider registry as a `Layer`. Each plugin this package ships
 * contributes one layer built from the registration object `registrations.ts`
 * already declares for it, and the merge of those layers is what a
 * `Providers` service is read out of, so which providers stand is decided
 * where the layers are merged rather than by whoever asks first.
 *
 * The duplicate refusal moves with it. A registration claims its provider's
 * id while its own layer builds, so a second registration naming an id
 * already claimed fails the build with `DuplicateProviderRegistration`
 * instead of quietly replacing the first one at a lookup nobody watches.
 */
import { Context, Data, Effect, Layer, Ref, type Scope } from "effect";
import type { ProviderRegistration } from "../registrations.js";

/** Two registrations named the same provider id, so neither may stand. */
export class DuplicateProviderRegistration extends Data.TaggedError(
  "DuplicateProviderRegistration",
)<{
  readonly providerId: string;
}> {}

/**
 * Every provider registration that stands, by the id its plugin publishes.
 * The key is that id as the plugin seam states it, so a workspace manager's
 * own plugin id claims a place here on the same terms a session provider's
 * does rather than having to be one the provider catalog names.
 */
export class Providers extends Context.Tag("@sidecar/providers/Providers")<
  Providers,
  ReadonlyMap<string, ProviderRegistration>
>() {}

/**
 * The ids claimed so far in one build. It is private on purpose: the claim is
 * an artifact of building the merge, and nothing outside this module has a
 * reason to hold a half-assembled registry.
 */
class ClaimedProviders extends Context.Tag("@sidecar/providers/ClaimedProviders")<
  ClaimedProviders,
  Ref.Ref<ReadonlyMap<string, ProviderRegistration>>
>() {}

const claimedProvidersLayer = Layer.effect(
  ClaimedProviders,
  Ref.make<ReadonlyMap<string, ProviderRegistration>>(new Map()),
);

const claimProvider = (
  registration: ProviderRegistration,
): Effect.Effect<void, DuplicateProviderRegistration, ClaimedProviders> =>
  Effect.flatMap(ClaimedProviders, (claimed) =>
    Effect.flatMap(
      Ref.modify(
        claimed,
        (held): readonly [string | undefined, ReadonlyMap<string, ProviderRegistration>] => {
          const providerId = registration.plugin.provider.id;
          if (held.has(providerId)) return [providerId, held];
          return [undefined, new Map(held).set(providerId, registration)];
        },
      ),
      (duplicate) =>
        duplicate === undefined
          ? Effect.void
          : Effect.fail(new DuplicateProviderRegistration({ providerId: duplicate })),
    ),
  );

/**
 * One registration's layer. It publishes no service of its own: what it
 * contributes is the claim, which is what the merged build refuses a
 * duplicate of.
 */
const providerLayer = (
  registration: ProviderRegistration,
): Layer.Layer<never, DuplicateProviderRegistration, ClaimedProviders> =>
  Layer.effectDiscard(claimProvider(registration));

/**
 * The merge of every registration's layer, read out as the `Providers`
 * service. The claims are merged first and the service is built over them, so
 * a duplicate id is refused before anything can read the registry, and the
 * claim ledger is provided once for the whole merge so every layer in it
 * claims against the same one.
 */
export const providersLayer = (
  registrations: readonly ProviderRegistration[],
): Layer.Layer<Providers, DuplicateProviderRegistration> =>
  Layer.provide(
    Layer.provide(
      Layer.effect(
        Providers,
        Effect.flatMap(ClaimedProviders, (claimed) => Ref.get(claimed)),
      ),
      registrations.reduce<Layer.Layer<never, DuplicateProviderRegistration, ClaimedProviders>>(
        (merged, registration) => Layer.merge(merged, providerLayer(registration)),
        Layer.empty,
      ),
    ),
    claimedProvidersLayer,
  );

/** The registry those layers build, for a caller that holds a `Scope` already. */
export const builtProviders = (
  registrations: readonly ProviderRegistration[],
): Effect.Effect<
  ReadonlyMap<string, ProviderRegistration>,
  DuplicateProviderRegistration,
  Scope.Scope
> =>
  Effect.map(Layer.build(providersLayer(registrations)), (context) =>
    Context.get(context, Providers),
  );
