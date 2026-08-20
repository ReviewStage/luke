import type { Configuration } from "electron-builder";
import { createElectronBuilderConfig } from "./scripts/electron-builder-config.mjs";

const config: Configuration = createElectronBuilderConfig();

export default config;
