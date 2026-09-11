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

import * as Atom from "@effect-atom/atom/Atom";
import * as Registry from "@effect-atom/atom/Registry";
import * as Result from "@effect-atom/atom/Result";
import { scheduleTask } from "@effect-atom/atom-react/RegistryContext";
import { Layer, type Runtime } from "effect";

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
export const rendererRegistry = Registry.make({ scheduleTask });

/**
 * The same runtime, for work that is a fiber of its own rather than an atom's:
 * the voice window's call forks its session's life and every bound of it here,
 * so a fiber outside the atoms still runs on the one runtime this bundle has.
 * The layer is built synchronously, so there is nothing to wait for.
 */
export const rendererRuntimeNow = (): Runtime.Runtime<never> =>
  Result.getOrThrow(rendererRegistry.get(rendererRuntime));
