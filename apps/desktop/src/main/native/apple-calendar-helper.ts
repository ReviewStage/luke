import { execFile } from "node:child_process";
import path from "node:path";
import { app } from "electron";

/**
 * Where this Mac's EventKit helper stands, and how one invocation of it is
 * run. Only the process that holds the device can answer either: the bundle
 * is resolved against the packaged app around it, and LaunchServices is told
 * about it from here. What to ask the helper, and what to keep of its answer,
 * stays the host's.
 */

/** Named for what every fallback shows, like Chromium's helper bundles. */
const HELPER_BUNDLE_NAME = "Luke.app";

/**
 * Where LaunchServices takes registrations. System Settings resolves the
 * consent row's name and icon through LaunchServices, and a bundle buried
 * inside Resources is never seen by it unless told — untold, the row falls
 * back to whatever name the record was made under.
 */
const LSREGISTER_PATH =
  "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";

let helperBundleRegistered = false;

/**
 * Where the helper's executable stands this run, with the bundle taught to
 * LaunchServices on the way — once per process, converging like the hook
 * registrations. The helper lives in a minimal bundle of its own — its TCC
 * identity — so the executable sits one bundle deep where every other helper
 * sits bare, named Luke because the consent dialog may name the process by
 * this file.
 */
function appleCalendarHelperPath(): string {
  const bundlePath = app.isPackaged
    ? path.join(process.resourcesPath, HELPER_BUNDLE_NAME)
    : path.join(app.getAppPath(), ".build", "native", HELPER_BUNDLE_NAME);
  if (!helperBundleRegistered) {
    helperBundleRegistered = true;
    // What it teaches LaunchServices is the bundle's own name and icon,
    // nothing more, and a registration that fails costs only the row's
    // looks — but says so, because a fallback name is otherwise
    // indistinguishable from this line never having run.
    execFile(LSREGISTER_PATH, ["-f", bundlePath], (error) => {
      if (error) process.stderr.write(`Calendar helper registration failed: ${error.message}\n`);
    });
  }
  return path.join(bundlePath, "Contents", "MacOS", "Luke");
}

/**
 * Resolves the packaged helper the way every native helper is resolved, and
 * refuses to run anywhere but a Mac: on any other platform the calendar
 * simply cannot answer, which the reader reports rather than hides.
 */
export function runAppleCalendarHelper(
  helperArguments: readonly string[],
  timeoutMs: number,
): Promise<string> {
  if (process.platform !== "darwin") {
    return Promise.reject(new Error("Apple Calendar is only readable on macOS"));
  }
  return new Promise((resolve, reject) => {
    execFile(
      appleCalendarHelperPath(),
      [...helperArguments],
      { encoding: "utf8", timeout: timeoutMs },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout);
      },
    );
  });
}
