import { isRecord, text, type UnparsedWireValue, type WireValue } from "@sidecar/wire";
import type { Properties } from "posthog-js";
import posthog from "posthog-js/dist/module.full.no-external";
import type { SessionReplayBootstrap } from "#shared/wire/session";

/**
 * Recording what Luke's own panel draws, on the library's own defaults.
 *
 * This is not the counted-event stream and does not share its guarantee. A
 * counted event can only say what `packages/analytics/src/product-events.ts`
 * declared, so a session title has no form it could travel in; those events
 * go to Luke's own service and are read against the allowlist a second time
 * there. This client is the analytics library configured as it ships, posting
 * straight to the processor, and everything it sends is outside that
 * allowlist: a recording is the rendered panel, so a session title, branch,
 * recap, error line, and the account's own name and address all travel
 * because they are drawn; autocapture puts the text of whatever was clicked
 * on an event; and an unhandled error travels with its message and stack.
 * Only what is typed into a field stays masked, which is the library's own
 * default rather than anything asked for here.
 *
 * `PRIVACY.md` says all of that plainly, and it has to keep saying it: this
 * file is the whole of what decides it, and there is nothing else standing
 * between what the panel draws and what leaves the machine.
 *
 * What this file decides on its own is only whether to record at all: the
 * main process says whether this run may, and the developer's two switches
 * say whether it does. No account is among those reasons. Recording begins at
 * the first paint of an ordinary launch, before anyone has signed in and
 * through the spoken introduction, because the launch is where what goes
 * wrong goes wrong and a recording that waited for a sign-in never saw it. A
 * session that reaches one is joined to the person there; a session that
 * never does stays anonymous, which is the part `PRIVACY.md` has to say
 * plainly, because such a recording cannot be erased with an account.
 */

/**
 * Where everything here posts. The processor's own address rather than Luke's
 * origin: nothing forwards on the user's behalf any more, so the processor
 * sees the address a request arrives from.
 *
 * Exported so the connect policy in `index.html` can be asserted against it.
 * The host and the policy are separate literals in separate files, and a
 * recording the policy refuses to send is indistinguishable from one that was
 * never started — which is exactly how this went unnoticed once already.
 */
export const POSTHOG_HOST = "https://us.i.posthog.com";

/**
 * The library's other host, which it derives from `POSTHOG_HOST`'s region
 * rather than taking as configuration: captured events go to the ingestion
 * host above, and the remote configuration saying whether recording is on
 * comes from this one.
 *
 * Named in the policy even though `preloadRemoteConfig` means nothing here
 * asks for it today. The preload rests on an undocumented global, and a
 * library that stopped reading it would fall through to fetching this — which
 * this entry lets succeed rather than fail the same silent way it did before.
 */
export const POSTHOG_ASSETS_HOST = "https://us-assets.i.posthog.com";

/**
 * What this window says its address is, in place of the one it has.
 *
 * The renderer is a `file://` page, so its real address is a path on the
 * developer's own disk — a packaged install sits under `/Users/<name>/`, which
 * names them. A logical address rather than an empty one, because these
 * properties also feed the library's own URL matching, and matching against
 * nothing is its own surprise.
 */
const RENDERER_ADDRESS = "app://luke/panel";

/**
 * Where macOS keeps home folders, and so where the account name sits in any
 * absolute path on this machine. A path under it is the thing this whole
 * parser exists to stop, whatever produced it.
 */
const ACCOUNTS_DIRECTORY = "/Users/";

/**
 * The directory this page was loaded from, which is also where its scripts
 * are — so it is where a captured exception's stack frames point, and those
 * name `renderer.js` rather than the document itself.
 *
 * Read off `globalThis` rather than `window` so the parser can be exercised
 * with no document at all, where there is no address to match and every value
 * passes through.
 */
function loadedFrom(): string | undefined {
  const path = globalThis.location?.pathname;
  if (path === undefined) return undefined;
  const directory = path.slice(0, path.lastIndexOf("/") + 1);
  // A page at the filesystem root would match everything, which is not a
  // narrowing at all; the two rules either side of this still cover it.
  return directory.length > 1 ? directory : undefined;
}

/**
 * Whether a value is an address on this machine, in any of the forms one takes
 * here: the whole `file://` address, a path under the directory this page and
 * its scripts were loaded from, or any absolute path under the accounts
 * directory.
 *
 * Three rules rather than one equality, because equality only ever matched the
 * document. The library also reports a bare path beside the address, an
 * exception names the script each frame came from, and either can be spelled
 * differently from `location.pathname` — encoded, or simply a sibling file —
 * and still name the same person.
 */
function namesThisMachine(value: string): boolean {
  if (value.startsWith("file://") || value.startsWith(ACCOUNTS_DIRECTORY)) return true;
  const directory = loadedFrom();
  return directory !== undefined && value.startsWith(directory);
}

/**
 * Takes this machine's path out of anything on its way to the processor.
 *
 * Switching pageviews off withholds the address from one event and no others.
 * The library puts it on every event as `$current_url` and `$pathname`, onto
 * the person as the first-seen twins of those, inside a captured exception as
 * the file each stack frame came from, and inside a recording as the frame
 * rrweb opens with. Naming those one by one is a list somebody has to keep in
 * step with the library, and three rounds of finding another one is the
 * argument against it: this matches the address itself, wherever it sits.
 *
 * Written against the wire vocabulary because that is what these values are —
 * built by the library rather than declared by this build, so they are parsed
 * here rather than trusted. Anything that is not this address is passed back
 * exactly as it came.
 *
 * The referrer properties come through untouched of their own accord. A page
 * opened as a file has no referrer, so the library records the same `$direct`
 * any unreferred visit gets, and that says nothing about the machine.
 */
export function withoutLocalAddress(value: UnparsedWireValue): UnparsedWireValue {
  return value === undefined ? undefined : addressless(value);
}

/**
 * The walk itself, over a value that is present. Split from the entry point so
 * that a missing property stays missing rather than becoming one of the nulls
 * a nested array would otherwise need to carry it.
 */
function addressless(value: WireValue): WireValue {
  const asText = text(value);
  if (asText !== undefined) return namesThisMachine(asText) ? RENDERER_ADDRESS : value;
  if (Array.isArray(value)) return value.map(addressless);
  if (!isRecord(value)) return value;
  const scrubbed: Record<string, WireValue> = {};
  for (const [key, entry] of Object.entries(value)) scrubbed[key] = addressless(entry);
  return scrubbed;
}

/**
 * The bridge between the library's own property bag and the parser above.
 * `Properties` types its values as `any`, which is what an unvalidated wire
 * value is; this is the one place that is said out loud.
 */
function scrubbedProperties(properties: Properties): Properties {
  const scrubbed: Properties = {};
  for (const [key, value] of Object.entries(properties)) {
    // SAFETY: the library built this bag, so its values are unvalidated wire
    // values by construction; the parser establishes any shape it acts on.
    scrubbed[key] = withoutLocalAddress(value as UnparsedWireValue);
  }
  return scrubbed;
}

/**
 * The project the recording is filed under, fixed at build time the way the
 * calendar client's secret is. A build packaged without one records nothing —
 * the same kill switch the site's own counting has, so a local run or an
 * unconfigured build measures nothing rather than measuring into a stranger's
 * project.
 */
declare const PACKAGED_POSTHOG_PROJECT_API_KEY: string | undefined;

function projectApiKey(): string {
  try {
    // SAFETY: esbuild replaces this free identifier when it bundles the
    // renderer; a run that never went through the bundler has no such global,
    // and reading one throws rather than answering undefined.
    return PACKAGED_POSTHOG_PROJECT_API_KEY ?? "";
  } catch {
    return "";
  }
}

/**
 * The library's own preloaded-configuration global, which its
 * `RemoteConfigLoader` reads before it fetches anything: a config found here
 * is used as it stands, and the fetch never happens.
 *
 * Declared here because posthog-js does not declare it — it is assigned by
 * the hosted `/array/<token>/config.js` bundle rather than by anything in the
 * package's own types, so the shape is documented by what the loader reads
 * and nothing in the type system holds it still. `session-replay.test.ts`
 * asserts both halves against the installed bundle, because a library that
 * renamed either would take recording out silently.
 */
declare global {
  interface Window {
    _POSTHOG_REMOTE_CONFIG?: Record<
      string,
      { config: { sessionRecording: object; hasFeatureFlags: boolean } }
    >;
  }
}

/**
 * Says recording is on, without asking.
 *
 * The library splits its traffic by kind: what it captures goes to the
 * ingestion host, and the configuration deciding whether to record at all
 * comes from `POSTHOG_ASSETS_HOST`, which it derives from the region rather
 * than taking as configuration. A renderer policy naming only the first
 * refuses that read, and the refusal is silent — recording is gated on a
 * property only that response writes, so a blocked config reads exactly like
 * a project with recording switched off. It was, for every build until this
 * one.
 *
 * Preloading answers it here instead. `sessionRecording` decides the gate by
 * truthiness alone, so an empty object turns recording on and leaves every
 * field the library's own default, including the input masking documented
 * above. `hasFeatureFlags: false` declines the flag fetch Luke has no use for.
 *
 * What this omits is deliberate and costs nothing: unhandled errors are
 * forced on by `capture_exceptions` client-side, and autocapture answers to a
 * disable flag rather than to a remote yes — which is why clicks and errors
 * arrived throughout, and recordings never did.
 */
function preloadRemoteConfig(key: string): void {
  window._POSTHOG_REMOTE_CONFIG = {
    [key]: { config: { sessionRecording: {}, hasFeatureFlags: false } },
  };
}

let started = false;
let initialized = false;

/**
 * Brings recording into line with what the developer has just asked for, in
 * either direction. Called at bootstrap and again whenever a settings change
 * lands, so a switch turned off stops the recording where it stands rather
 * than at the next launch — and one turned back on starts a new one.
 *
 * Both switches are read live and both are required: `shareUsageData` is the
 * outer consent and a recording is a thing sent, so recording cannot outlive
 * the sharing it travels under.
 */
export function applySessionReplay(
  bootstrap: SessionReplayBootstrap,
  sharesUsageData: boolean,
  recordsSurface: boolean,
): void {
  const wanted = sessionReplayWanted(bootstrap, sharesUsageData, recordsSurface);
  if (wanted === started) return;
  if (wanted) startSessionReplay(bootstrap);
  else stopSessionReplay();
}

/**
 * Whether recording should be running, given what the run allows and where
 * the developer's two switches stand. Named and exported so the reasons can
 * be asserted one at a time: this decides whether the one thing Luke sends
 * that no vocabulary bounds happens at all.
 */
export function sessionReplayWanted(
  bootstrap: SessionReplayBootstrap,
  sharesUsageData: boolean,
  recordsSurface: boolean,
): boolean {
  return bootstrap.permitted && sharesUsageData && recordsSurface;
}

function startSessionReplay(bootstrap: SessionReplayBootstrap): void {
  const key = projectApiKey();
  if (!key) return;
  started = true;
  if (initialized) {
    // The client is built once per window. A second `init` would not rebuild
    // it, so a recording resumed after a switch or an account change is
    // started rather than re-configured — but it must still be told whose
    // recording it is, because the person may have changed since the last one.
    optIn();
    registerBuild(bootstrap);
    identifyAccount(bootstrap);
    posthog.startSessionRecording();
    return;
  }
  initialized = true;
  preloadRemoteConfig(key);
  posthog.init(key, {
    api_host: POSTHOG_HOST,
    defaults: "2025-11-30",
    // The one place the library's defaults cannot stand: both of these carry
    // the page's own address, and this page is a `file://` one, so its address
    // names a path on the developer's own disk rather than anything about
    // Luke. Switching them off is only half of it — see `before_send`, which
    // is what takes that path off everything else.
    capture_pageview: false,
    capture_pageleave: false,
    capture_exceptions: true,
    person_profiles: "always",
    persistence: "localStorage",
    debug: false,
    get_current_url: () => RENDERER_ADDRESS,
    before_send: (event) => {
      if (!event) return event;
      // `$set` and `$set_once` carry the address too, as the person's
      // first-seen properties, where it would outlive every event holding it.
      // SAFETY: `Properties` types its values as `any`; each is handed to the
      // parser above as the unvalidated wire value it actually is, and comes
      // back either replaced or exactly as it came.
      return {
        ...event,
        properties: scrubbedProperties(event.properties),
        ...(event.$set ? { $set: scrubbedProperties(event.$set) } : undefined),
        ...(event.$set_once ? { $set_once: scrubbedProperties(event.$set_once) } : undefined),
      };
    },
  });
  // Stopping opts out, and that is written into the same storage this client
  // reads at launch — so without opting back in here, a run that had ever
  // been stopped would come up recording nothing while every switch said it
  // was recording.
  optIn();
  registerBuild(bootstrap);
  identifyAccount(bootstrap);
}

/**
 * Files what is being recorded under the account, when there is one.
 *
 * The id is the same opaque one the counted events resolve to, so a recording
 * and the counts around it belong to one person — which is what makes
 * deleting the account erase the recordings with it.
 *
 * Signed out there is no id and none is invented: the recording runs under
 * the anonymous id the library made for itself, and a sign-in that lands
 * later calls this, which is where the library joins that anonymous session
 * to the person. What never reaches a sign-in stays anonymous, and so cannot
 * be erased with an account — `PRIVACY.md` says so, because it is now true.
 */
function identifyAccount(bootstrap: SessionReplayBootstrap): void {
  if (bootstrap.accountId) posthog.identify(bootstrap.accountId);
}

/**
 * Opting in and out rather than only starting and stopping the recorder,
 * because this client sends more than recordings. On the library's own
 * configuration it also autocaptures what was clicked and reports unhandled
 * errors, and neither answers to `stopSessionRecording`. The switch says
 * "record my screen", so everything this client would send has to stop with
 * it — otherwise the developer turns off the one thing they were shown and
 * the rest keeps travelling.
 *
 * The opt-in names no event, because the `$opt_in` the library captures by
 * default is a count of the switch moving, which Luke's own counted events
 * already hold.
 */
function optIn(): void {
  posthog.opt_in_capturing({ captureEventName: false });
}

/**
 * Which build these came from, registered on every start rather than once at
 * init: stopping calls `reset`, which clears the registered properties along
 * with the person, so a recording resumed afterwards would otherwise say
 * nothing about the version it came from.
 */
function registerBuild(bootstrap: SessionReplayBootstrap): void {
  posthog.register({
    app_name: "desktop",
    app_version: bootstrap.appVersion,
    platform: navigator.platform,
  });
}

function stopSessionReplay(): void {
  started = false;
  if (!initialized) return;
  posthog.stopSessionRecording();
  // The person goes with the recording. Without this the client keeps the
  // previous account's id and its anonymous session, so signing in as someone
  // else would file their recordings under the person who signed out — which
  // is the one thing filing under an account is supposed to prevent.
  posthog.reset();
  posthog.opt_out_capturing();
}
