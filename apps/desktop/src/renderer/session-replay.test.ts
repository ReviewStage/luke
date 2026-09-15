import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "vitest";
import type { SessionReplayBootstrap } from "#shared/messages/session";
import {
  maskWordBearingAttribute,
  POSTHOG_ASSETS_HOST,
  POSTHOG_HOST,
  SESSION_REPLAY_MASKING,
  sessionReplayWanted,
  withoutLocalAddress,
} from "./session-replay";

/**
 * The gate, on its own. Recording is the one thing Luke sends that a fixed
 * vocabulary does not bound, and no switch stands in front of it, so the one
 * reason it must not start is asserted here rather than left to be read off
 * the run mode it arrives from.
 */

function bootstrap(over: Partial<SessionReplayBootstrap> = {}): SessionReplayBootstrap {
  return {
    permitted: true,
    appVersion: "1.2.3",
    accountId: "user-1",
    ...over,
  };
}

test("an ordinary run records", () => {
  assert.equal(sessionReplayWanted(bootstrap()), true);
});

test("a fixture or capture run records nothing", () => {
  // `permitted` is where `runMode.sendsNetwork` arrives, so this is the same
  // suppression the event sender takes — and the reason an evidence run
  // reaches no network. A deleted account arrives here too, standing
  // recording down for the rest of the run.
  assert.equal(sessionReplayWanted(bootstrap({ permitted: false })), false);
});

test("no account is no reason not to record: the launch is what it is there for", () => {
  // The signed-out panel and the spoken introduction before it are where a
  // first run goes wrong, and a recording that waited for a sign-in never saw
  // any of it. What the id decides is whom the recording is filed under, not
  // whether there is one.
  assert.equal(sessionReplayWanted(bootstrap({ accountId: undefined })), true);
});

/**
 * The recorder's hosts and the renderer's connect policy are separate
 * literals in separate files, and nothing at run time reconciles them: a host
 * the policy does not name is refused by the browser, which looks exactly like
 * a recording that never started — which is what it looked like for every
 * build before the assets host was named here. Asserted as the whole list
 * rather than as containment, so widening what this renderer may reach at all
 * has to be done deliberately here as well.
 */
test("the connect policy names both recorder hosts, and nothing else", () => {
  const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
  const connectSrc = html.match(/connect-src ([^;"]+)/)?.[1];
  assert.deepEqual(connectSrc?.split(" "), [POSTHOG_HOST, POSTHOG_ASSETS_HOST]);
});

/**
 * The hidden voice window loads the panel's own bundle from a document of its
 * own, so the recorder is in it. What keeps a recording from ever leaving that
 * window is that `App`, where recording starts, is never mounted for the voice
 * role — and, behind that, this policy: a document that may reach no host
 * cannot post a recording however the bundle is configured.
 */
test("the voice document loads the one bundle and may reach no host at all", () => {
  const voice = readFileSync(new URL("./voice.html", import.meta.url), "utf8");
  const panel = readFileSync(new URL("./index.html", import.meta.url), "utf8");
  assert.equal(voice.match(/connect-src ([^;"]+)/)?.[1], "'none'");
  assert.ok(voice.includes('<script src="renderer.js"></script>'));
  assert.ok(panel.includes('<script src="renderer.js"></script>'));
});

/**
 * The recording is layout and asterisks, and this is the whole of what makes
 * it so. Asserted as one value so a field going missing is a failed equality
 * rather than a recording that quietly carries words again.
 */
test("the recorder is told to mask every word and to capture no click", () => {
  assert.deepEqual(SESSION_REPLAY_MASKING, {
    autocapture: false,
    capture_dead_clicks: false,
    mask_all_text: true,
    session_recording: {
      maskTextSelector: "*",
      maskAttributeFn: maskWordBearingAttribute,
    },
  });
});

test("an attribute that carries words or a picture is asterisked to its length", () => {
  for (const name of ["title", "aria-label", "aria-description", "alt", "placeholder", "src"]) {
    assert.equal(maskWordBearingAttribute(name, "Open in Cursor"), "**************", name);
  }
});

test("an attribute that carries structure comes through as it came", () => {
  // `class` and `style` are what let the recording lay out at all; masking
  // them would leave nothing to look at, which is the argument against the
  // library's `maskAllElementAttributes`.
  for (const name of ["class", "style", "id", "role", "data-hit-region", "href", "type"]) {
    assert.equal(maskWordBearingAttribute(name, "session-row open"), "session-row open", name);
  }
});

/**
 * The recorder copies from `session_recording` only the option names it
 * already knows and drops the rest without a word, and the preloaded config
 * rests on a global the library does not declare — so a rename of either
 * would look exactly like masking that works, or recording that is off. The
 * names are read off the installed bundle, the one the renderer is built from.
 */
test("the installed bundle still knows every name the masking rests on", () => {
  const bundle = readFileSync(
    createRequire(import.meta.url).resolve("posthog-js/dist/module.full.no-external"),
    "utf8",
  );
  for (const name of [
    "maskTextSelector",
    "maskAttributeFn",
    "mask_all_text",
    "capture_dead_clicks",
    "ph-no-capture",
    "_POSTHOG_REMOTE_CONFIG",
  ]) {
    assert.ok(bundle.includes(name), name);
  }
});

/**
 * The renderer is a `file://` page, so its address is a path on the
 * developer's own disk and a packaged install sits under `/Users/<name>/`.
 * Switching pageviews off stops it reaching one event; this is what stops it
 * reaching everything else the library puts it in.
 */
const LOCAL = "file:///Users/someone/Applications/Luke.app/renderer/index.html";
/** What the scrub puts in the address's place, as the library will report it. */
const PANEL = "app://luke/panel";

test("the address goes from an event's own properties", () => {
  const scrubbed = withoutLocalAddress({ $current_url: LOCAL, $browser: "Chrome" });
  // What is not the address is left exactly as the library reported it.
  assert.deepEqual(scrubbed, { $current_url: "app://luke/panel", $browser: "Chrome" });
});

test("the address goes from the frames the recorder opens with", () => {
  assert.deepEqual(
    withoutLocalAddress([
      { type: 4, data: { href: LOCAL, width: 640 }, timestamp: 1 },
      { type: 5, data: { tag: "$url_changed", payload: { href: LOCAL } }, timestamp: 2 },
    ]),
    [
      { type: 4, data: { href: PANEL, width: 640 }, timestamp: 1 },
      { type: 5, data: { tag: "$url_changed", payload: { href: PANEL } }, timestamp: 2 },
    ],
  );
});

test("a bare path names the machine as surely as a whole address does", () => {
  // The library reports a path beside the address, and an exception names the
  // script each frame came from rather than the document — so matching the
  // document's own address exactly would have let both through.
  assert.deepEqual(
    withoutLocalAddress({
      $pathname: "/Users/someone/Applications/Luke.app/renderer/index.html",
      nested: { script: "/Users/someone/Applications/Luke.app/renderer/renderer.js" },
    }),
    { $pathname: PANEL, nested: { script: PANEL } },
  );
});

test("everything that is not the address comes through as it came", () => {
  // A page opened as a file has no referrer, so the library reports the same
  // `$direct` any unreferred visit gets, and that says nothing about anyone.
  const properties = { $referrer: "$direct", $screen_height: 900, nested: { list: [1, "two"] } };
  assert.deepEqual(withoutLocalAddress(properties), properties);
  assert.equal(withoutLocalAddress(undefined), undefined);
});
