/**
 * The built-ins table and the configuration door in Effect's own terms.
 * `registry.ts` states both directly — it is not an OpenClaw port and
 * already imports `effect` for `resolveConfigurationEither` — so this
 * sibling carries only what a host composition needs beyond that: the
 * table as a `Context.Tag` a host can hand down through a `Layer`, and the
 * resolution door restated as an `Effect` over it, for P7's host composer
 * to build the agent's runtime on.
 */
import { Context, Effect, Either, Layer } from "effect";
import {
  type AgentConfiguration,
  BUILTINS,
  type ConfigurationRefused,
  resolveConfigurationEither,
} from "../registry.js";

/** The built-ins this build compiled in, read as a service rather than the module-level constant. */
export class Builtins extends Context.Tag("@sidecar/runtime/Builtins")<
  Builtins,
  typeof BUILTINS
>() {}

/** The one table this build compiles in, handed down as a `Layer`. */
export const BuiltinsLive: Layer.Layer<Builtins> = Layer.succeed(Builtins, BUILTINS);

/**
 * `resolveConfigurationEither` restated as an `Effect`, for a caller
 * composing a turn's other seams the same way rather than matching an
 * `Either` by hand.
 */
export const resolveConfigurationEffect = (
  names: AgentConfiguration,
): Effect.Effect<AgentConfiguration, ConfigurationRefused> =>
  Either.match(resolveConfigurationEither(names), { onLeft: Effect.fail, onRight: Effect.succeed });
