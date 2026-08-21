import posthog from "posthog-js/dist/module.full.no-external";
import type { SessionReplayBootstrap } from "#shared/contracts";
import { REPLAY_MASKING } from "./session-replay-masking";

/**
 * Recording what Luke's own panel draws, and the masking that is the whole
 * reason it may be drawn at all.
 *
 * This is the second of the two things Luke sends about his own use, and it is
 * the opposite shape from the first. A counted event can only say what
 * `packages/analytics/src/product-events.ts` declared, so a session title has
 * no form it could travel in. A recording is the rendered surface: everything
 * on screen travels *unless* it is masked. The allowlist protects the events
 * by construction; only `session-replay-masking.ts` protects a recording, and
 * it is load-bearing in a way no other configuration in this app is.
 *
 * This file decides only whether to record, and it decides nothing on its own:
 * the main process says whether this run may, and the developer's two switches
 * say whether it does.
 */

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
    // it, so a recording resumed after the switch came back on is started
    // rather than re-configured.
    posthog.startSessionRecording();
    return;
  }
  initialized = true;
  posthog.init(key, {
    api_host: bootstrap.ingestHost,
    // The desktop's counted events travel through Luke's own service, where
    // the allowlist is read a second time. This client sends recordings and
    // nothing else, so every other way it could produce an event is off: an
    // autocapture would collect the text and attributes of whatever was
    // clicked, and a pageview from a `file://` renderer names a path on the
    // developer's own disk.
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    disable_surveys: true,
    // The account is known before anything is recorded, so there is never an
    // anonymous person to merge afterwards.
    person_profiles: "identified_only",
    // Location is resolved from the address a request arrives from, and by the
    // time one does it is the proxy's rather than the user's — so this asks
    // for the honest answer rather than a resolved one.
    ip: false,
    session_recording: REPLAY_MASKING,
  });
  // The same opaque id the counted events resolve to, so a recording and the
  // counts around it belong to one person — which is also what makes deleting
  // the account erase the recordings with it.
  posthog.identify(bootstrap.accountId);
}

function stopSessionReplay(): void {
  started = false;
  if (initialized) posthog.stopSessionRecording();
}
