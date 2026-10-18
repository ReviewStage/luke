import type { FactorySceneModule } from "../contract";
import { mountScene } from "./scene-host";

/**
 * index.ts -- the scene bundle's entry: the host every Factory world is drawn in, which the page imports the first time a world is chosen (`../../bundle-loader.ts`).
 */

export const factoryScene: FactorySceneModule = { mount: mountScene };
