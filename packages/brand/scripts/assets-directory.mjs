import { fileURLToPath } from "node:url";

export const BRAND_ASSETS_DIRECTORY = fileURLToPath(new URL("../assets", import.meta.url));
