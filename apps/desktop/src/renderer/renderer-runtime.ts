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
import { scheduleTask } from "@effect-atom/atom-react/RegistryContext";
import { Layer } from "effect";

/**
 * No service stands yet: what the runtime is for is holding the fibers the
 * atoms fork, and a layer arrives here when a surface needs one.
 */
export const rendererRuntime = Atom.runtime(Layer.empty);

/**
 * The registry both roots provide, so a hook reading an atom and a callback
 * reading the same atom outside React read the one value rather than two.
 * Its `scheduleTask` is the React binding's own, which is what batches a
 * delivery's redraws into one.
 */
export const rendererRegistry = Registry.make({ scheduleTask });
