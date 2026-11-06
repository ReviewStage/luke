import { expect, test } from "vitest";
import { createElectronBuilderConfig } from "./electron-builder-config.mjs";

const SIGNING_ENVIRONMENTS = {
  adHoc: {},
  developerId: { APP_CODESIGN_IDENTITY: "Developer ID Application: Example (TEAMID)" },
};

test.each(Object.entries(SIGNING_ENVIRONMENTS))(
  "the app packaged %s cannot be run as Node, preloaded, or debugged, and loads only its checked asar",
  (_name, env) => {
    expect(createElectronBuilderConfig(env).electronFuses).toEqual({
      runAsNode: false,
      enableNodeOptionsEnvironmentVariable: false,
      enableNodeCliInspectArguments: false,
      enableEmbeddedAsarIntegrityValidation: true,
      onlyLoadAppFromAsar: true,
      enableCookieEncryption: true,
    });
  },
);
