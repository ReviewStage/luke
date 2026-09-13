/**
 * The renderer's Effect edge: the browser runtime the atoms' own work runs on,
 * and the registry that holds them.
 *
 * There is one of each per bundle rather than one per window, because the
 * panel and the voice window are two bundles of the same modules: each
 * instantiates this one, so each root provides its own registry and each holds
 * the one browser `ManagedRuntime` the factory builds inside it. Nothing here
 * may reach a layer that reaches `node:` — the renderer is a sandboxed browser
 * context, and a runtime is exactly the place a Node-reaching service would
 * arrive unnoticed.
 */

import { scheduleTask } from "@effect/atom-react/RegistryContext";
import { type Context, Layer } from "effect";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Atom from "effect/unstable/reactivity/Atom";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";

/**
 * No service stands yet: what the runtime is for is holding the fibers the
 * atoms fork, and a layer arrives here when a surface needs one. It is kept
 * alive because it is the bundle's one edge: a runtime the registry disposed
 * between two readings would be a second runtime to whatever it handed out.
 */
export const rendererRuntime = Atom.keepAlive(Atom.runtime(Layer.empty));

/**
 * The registry both roots provide, so a hook reading an atom and a callback
 * reading the same atom outside React read the one value rather than two.
 * Its `scheduleTask` is the React binding's own, which is what batches a
 * delivery's redraws into one.
 */
export const rendererRegistry = AtomRegistry.make({ scheduleTask });

/**
 * The services that runtime was built over, for work that is a fiber of its
 * own rather than an atom's: the voice window's call runs its session's life
 * and every bound of it under these, and `LiveVoiceOrchestrator` runs the
 * standing call's own lifecycle under them too, so a fiber outside the atoms
 * still stands on the one set of services this bundle has. The layer is built
 * synchronously, so there is nothing to wait for.
 */
export const rendererServicesNow = (): Context.Context<never> =>
  AsyncResult.getOrThrow(rendererRegistry.get(rendererRuntime));
