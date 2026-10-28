import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { createElectronBuilderConfig } from "./electron-builder-config.mjs";

/** Each way the app is packaged: ad hoc on a developer's Mac, and Developer ID for a release. */
const SIGNING_ENVIRONMENTS = {
  adHoc: {},
  developerId: { LUKE_CODESIGN_IDENTITY: "Developer ID Application: Example (TEAMID)" },
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

test("the packaged app carries luke-host's release with its Node signed, and a login item that runs the command packaging puts in the app", () => {
  const config = createElectronBuilderConfig({});
  const shipped = (files, to) => files.find((file) => file.to === to)?.from;
  const release = shipped(config.extraResources, "luke-host");
  const command = shipped(config.extraFiles, "MacOS/luke-host");
  const job = shipped(config.extraFiles, "Library/LaunchAgents/dev.reviewstage.luke.host.plist");

  expect(release).toMatch(/\.build\/luke-host$/);
  expect(config.mac.binaries).toEqual(
    expect.arrayContaining([
      "Contents/MacOS/luke-host",
      "Contents/Resources/luke-host/node/bin/node",
    ]),
  );
  expect(command).toBeDefined();
  const program = /<key>BundleProgram<\/key>\s*<string>([^<]+)<\/string>/u.exec(
    readFileSync(job, "utf8"),
  )?.[1];
  expect(program).toBe("Contents/MacOS/luke-host");
});
