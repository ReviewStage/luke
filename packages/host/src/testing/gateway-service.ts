import type { Effect, Scope } from "effect";
import {
  createGatewayService,
  type GatewayService,
  type GatewayServiceDependencies,
} from "../service.js";

/**
 * The host's Gateway service composed in the scope a test gives it, for a
 * test that holds it without a host to own it.
 */
export function scopedGatewayService(
  dependencies: GatewayServiceDependencies,
): Effect.Effect<GatewayService, never, Scope.Scope> {
  return createGatewayService(dependencies);
}
