import { Context, Layer } from "effect";

/** Where durable desktop files live; paths are fixed at launch. */
export interface DesktopStorage {
  readonly userDataPath: string;
  readonly lastRunVersionPath: string;
}

export class DesktopStorageTag extends Context.Tag("@luke/desktop/DesktopStorage")<
  DesktopStorageTag,
  DesktopStorage
>() {}

export function desktopStorageLayer(storage: DesktopStorage): Layer.Layer<DesktopStorageTag> {
  return Layer.succeed(DesktopStorageTag, storage);
}
