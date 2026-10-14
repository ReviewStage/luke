// assets-directory.mjs -- where the brand's committed artwork sits on disk.
//
// The desktop's build and packaging scripts copy the icon PNGs and the DMG
// background from here; they reach it through the package rather than a path
// into the repository, so moving the artwork moves one line.

import { fileURLToPath } from "node:url";

export const BRAND_ASSETS_DIRECTORY = fileURLToPath(new URL("../assets", import.meta.url));
