import type { Properties } from "posthog-js";
import posthog from "posthog-js/dist/module.full.no-external";
import type { SessionReplayBootstrap } from "#shared/contracts";

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
 * say whether it does.
 */

/**
 * Where everything here posts. The processor's own address rather than Luke's
 * origin: nothing forwards on the user's behalf any more, so the processor
 * sees the address a request arrives from.
 *
 * Exported so the connect policy in `index.html` can be asserted against it.
 * The two are separate literals, and a recording the policy refuses to send
 * is indistinguishable from one that was never started.
 */
export const POSTHOG_HOST = "https://us.i.posthog.com";

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
 * The properties the library fills with this page's address. On a `file://`
 * page every one of them is that path and nothing else, so each is replaced
 * outright rather than inspected.
 *
 * Named one by one because a value set is what this repository keeps rather
 * than a walk over whatever arrived — but unlike the counted events, nothing
 * here is compile-enforced: a library that starts recording the address under
 * a seventh name would carry it until this list learns the name too. That is
 * the cost of the stock configuration, and it is why the list sits beside the
 * comment explaining it.
 */
const ADDRESS_PROPERTIES = [
  "$current_url",
  "$pathname",
  "$initial_current_url",
  "$initial_pathname",
  "$session_entry_url",
  "$session_entry_pathname",
] as const;

/**
 * Takes this machine's path out of everything on its way to the processor.
 *
 * Switching pageviews off withholds the address from one event and no others:
 * the library attaches it to every event it sends and to the person's
 * first-seen properties. This is where it actually stops.
 *
 * The referrer properties are left alone deliberately. A page opened as a file
 * has no referrer, so the library records the same `$direct` it would for any
 * unreferred visit, and that says nothing about the machine.
 */
function withoutLocalAddress(properties: Properties): Properties {
  const scrubbed: Properties = { ...properties };
  for (const property of ADDRESS_PROPERTIES) {
    if (property in scrubbed) scrubbed[property] = RENDERER_ADDRESS;
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
  return (
    bootstrap.permitted && sharesUsageData && recordsSurface && bootstrap.accountId !== undefined
  );
}

function startSessionReplay(bootstrap: SessionReplayBootstrap): void {
  const key = projectApiKey();
  if (!key || !bootstrap.accountId) return;
  started = true;
  if (initialized) {
    // The client is built once per window. A second `init` would not rebuild
    // it, so a recording resumed after a switch or an account change is
    // started rather than re-configured — but it must still be told whose
    // recording it is, because the person may have changed since the last one.
    optIn();
    registerBuild(bootstrap);
    posthog.identify(bootstrap.accountId);
    posthog.startSessionRecording();
    return;
  }
  initialized = true;
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
      return {
        ...event,
        properties: withoutLocalAddress(event.properties),
        ...(event.$set ? { $set: withoutLocalAddress(event.$set) } : undefined),
        ...(event.$set_once ? { $set_once: withoutLocalAddress(event.$set_once) } : undefined),
      };
    },
  });
  // Stopping opts out, and that is written into the same storage this client
  // reads at launch — so without opting back in here, a run that had ever
  // been stopped would come up recording nothing while every switch said it
  // was recording.
  optIn();
  registerBuild(bootstrap);
  // The same opaque id the counted events resolve to, so a recording and the
  // counts around it belong to one person — which is also what makes deleting
  // the account erase the recordings with it.
  posthog.identify(bootstrap.accountId);
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
