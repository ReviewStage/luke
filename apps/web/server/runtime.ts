import { type Layer, ManagedRuntime } from "effect";
import { HostedLive } from "./services/hosted-live.js";
import type { HostedServices } from "./services/tags.js";

let hostedRuntime: ManagedRuntime.ManagedRuntime<HostedServices, never> | undefined;

/**
 * One module-scoped runtime per warm Vercel isolate. Request-scoped resources
 * stay in the handler; the max-one Drizzle pool remains runtime-scoped here.
 */
export function getHostedRuntime(): ManagedRuntime.ManagedRuntime<HostedServices, never> {
  if (!hostedRuntime) {
    hostedRuntime = ManagedRuntime.make(HostedLive as Layer.Layer<HostedServices, never, never>);
  }
  return hostedRuntime;
}

/** Tests own and dispose their runtimes; production isolates keep one warm copy. */
export function makeHostedRuntime(
  layer: Layer.Layer<HostedServices, never, never> = HostedLive as Layer.Layer<
    HostedServices,
    never,
    never
  >,
): ManagedRuntime.ManagedRuntime<HostedServices, never> {
  return ManagedRuntime.make(layer);
}

export function disposeHostedRuntime(): void {
  hostedRuntime?.dispose();
  hostedRuntime = undefined;
}
