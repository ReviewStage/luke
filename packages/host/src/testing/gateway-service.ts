import { Effect, Exit, Scope } from "effect";
import {
  createGatewayService,
  type GatewayService,
  type GatewayServiceDependencies,
} from "../service.js";

/** A service a test holds, and the close of the scope the Gateway's layers were built in. */
export interface ScopedGatewayService {
  readonly service: GatewayService;
  /** Lets the layers and the server's fiber go; nothing answers after this. */
  readonly dispose: () => Promise<void>;
}

/**
 * The host's Gateway service composed in a scope of this harness's own, for
 * a test that holds it without a host to own it.
 *
 * @deprecated A strangler shim on the ADR's allowlist, deleted by P12-09:
 * the runs here are the test's own edge while these suites are plain `test`
 * bodies, and they go when each builds the service in the test's own scope
 * on `it.effect`.
 */
export async function scopedGatewayService(
  dependencies: GatewayServiceDependencies,
): Promise<ScopedGatewayService> {
  const scope = Effect.runSync(Scope.make());
  const service = await Effect.runPromise(
    Effect.provideService(createGatewayService(dependencies), Scope.Scope, scope),
  );
  return { service, dispose: () => Effect.runPromise(Scope.close(scope, Exit.void)) };
}
