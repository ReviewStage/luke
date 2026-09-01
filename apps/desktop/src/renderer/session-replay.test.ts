import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import type { UnparsedWireValue } from "@sidecar/wire";
import type { SessionReplayBootstrap } from "#shared/wire/session";
import {
  POSTHOG_ASSETS_HOST,
  POSTHOG_HOST,
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
test("the connect policy names both recorder hosts, and only what else is reached", () => {
  const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
  const connectSrc = html.match(/connect-src ([^;"]+)/)?.[1];
  assert.deepEqual(connectSrc?.split(" "), [
    "https://api.openai.com",
    POSTHOG_HOST,
    POSTHOG_ASSETS_HOST,
  ]);
});

/**
 * What the preload rests on, read out of the bundle it rests on.
 *
 * `preloadRemoteConfig` writes a global posthog-js does not declare, and the
 * whole of what turns recording on is that the library finds a truthy
 * `sessionRecording` there. Nothing in the type system holds either half
 * still, and an upgrade that moved one would take recording out in exactly
 * the silence this change exists to end — so both are asserted against the
 * installed bundle instead of trusted.
 *
 * Read around the member names rather than as bare substrings, because
 * `sessionRecording` alone appears throughout the surveys code and an
 * assertion that cannot fail is worse than none. The names survive
 * minification; the locals beside them do not, which is what the windows and
 * the `\w` are for.
 */
function posthogBundle(): string {
  return readFileSync(
    createRequire(import.meta.url).resolve("posthog-js/dist/module.full.no-external"),
    "utf8",
  );
}

function bodyAfter(bundle: string, member: string): string {
  const start = bundle.indexOf(member);
  assert.notEqual(start, -1, `posthog-js no longer defines ${member}`);
  return bundle.slice(start, start + 1400);
}

test("the library still reads the preloaded config", () => {
  const loader = bodyAfter(posthogBundle(), "get remoteConfig()");
  // The token index and `.config` are the shape `preloadRemoteConfig` writes;
  // the loader returning nothing from this is what makes it fetch instead.
  assert.match(loader, /_POSTHOG_REMOTE_CONFIG/);
  assert.match(loader, /\.config\b/);
});

test("recording is still on for any truthy sessionRecording, which is why {} does", () => {
  const persist = bodyAfter(posthogBundle(), "_persistRemoteConfig(");
  assert.match(persist, /sessionRecording/);
  // The gate itself. A release that asked the remote config for a field —
  // `enabled === true`, a sample rate, anything — rather than for truthiness
  // would read the preload's `{}` as a no and record nothing.
  assert.match(persist, /enabled:!!\w/);
});

/**
 * The renderer is a `file://` page, so its address is a path on the
 * developer's own disk and a packaged install sits under `/Users/<name>/`.
 * Switching pageviews off stops it reaching one event; this is what stops it
 * reaching everything else the library puts it in.
 */
const LOCAL = "file:///Users/someone/Applications/Luke.app/renderer/index.html";

function namesNobody(value: UnparsedWireValue): void {
  assert.doesNotMatch(JSON.stringify(value) ?? "", /someone|file:\/\//);
}

test("the address goes from an event's own properties", () => {
  const scrubbed = withoutLocalAddress({ $current_url: LOCAL, $browser: "Chrome" });
  namesNobody(scrubbed);
  // What is not the address is left exactly as the library reported it.
  assert.deepEqual(scrubbed, { $current_url: "app://luke/panel", $browser: "Chrome" });
});

test("the address goes from the frames the recorder opens with", () => {
  namesNobody(
    withoutLocalAddress([
      { type: 4, data: { href: LOCAL, width: 640 }, timestamp: 1 },
      { type: 5, data: { tag: "$url_changed", payload: { href: LOCAL } }, timestamp: 2 },
    ]),
  );
});

test("a bare path names the machine as surely as a whole address does", () => {
  // The library reports a path beside the address, and an exception names the
  // script each frame came from rather than the document — so matching the
  // document's own address exactly would have let both through.
  namesNobody(
    withoutLocalAddress({
      $pathname: "/Users/someone/Applications/Luke.app/renderer/index.html",
      nested: { script: "/Users/someone/Applications/Luke.app/renderer/renderer.js" },
    }),
  );
});

test("everything that is not the address comes through as it came", () => {
  // A page opened as a file has no referrer, so the library reports the same
  // `$direct` any unreferred visit gets, and that says nothing about anyone.
  const properties = { $referrer: "$direct", $screen_height: 900, nested: { list: [1, "two"] } };
  assert.deepEqual(withoutLocalAddress(properties), properties);
  assert.equal(withoutLocalAddress(undefined), undefined);
});
