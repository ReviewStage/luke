/**
 * session-replay.ts -- recording the shape of what the panel draws, and none of its words: the masking every shell records under, and the one controller that starts and stops it.
 *
 * This is not the counted-event stream and does not share its guarantee. A
 * counted event can only say what `packages/features/src/analytics/product-events.ts`
 * declared; this client is the analytics library posting straight to the
 * processor, and a recording is the rendered panel. What keeps a session
 * title, a branch, an error line, a caption, or the account's own name out of
 * it is `SESSION_REPLAY_MASKING` below, not an allowlist: every text node and
 * every input is masked, the attributes that carry words or an image are
 * asterisked, and autocapture is off. What leaves is layout, pointer
 * positions, and asterisks of the right length. The surfaces that hold the
 * most of a person's words also block their whole subtree with the library's
 * fixed `ph-no-capture` class as a second line, each named where it is drawn
 * and listed in `PRIVACY.md`: the feedback dialog, whose screenshots are
 * pictures of the person's screen, a task's title and the editor its document
 * is edited in, whose masked value would still record the rhythm of the
 * typing, and its transcript, Work, Code, File, and page tabs,
 * version history, Inbox, and coding agents' tabs and their Terminal tabs,
 * Browser tabs with the still of a page they draw and a cloud Browser
 * tab's live view, and ⌃Tab's previews, each a still of a tab, among others. A Terminal tab and a cloud
 * Browser tab's live view are the surfaces that draw
 * their words on a canvas, which the text masking cannot reach, so their
 * block is their only line, and canvas recording is held off by name rather
 * than by the library's default.
 *
 * `PRIVACY.md` says all of that plainly, and it has to keep saying it: the
 * masking and those blocks are the whole of what decides it. Every shell that
 * records (the desktop's panel window, `apps/desktop/src/renderer/session-replay.ts`,
 * and the web app's tab, `apps/web/src/app/web-session-replay.ts`) records
 * through `sessionReplay` here, so the masking is stated once and no shell can
 * record under any other.
 *
 * What a shell decides is only what is its own: the platform it is, the
 * project key its build carries (none, and nothing records), the address its
 * window says it has in place of the one it has, and where its recorder's
 * bundle is. Whether a run may record at all is the host's word
 * (`SessionReplayBootstrap`): there is no switch. Where it may, recording
 * waits for an account: nothing loads and nothing records while signed out,
 * so a visit that never signs in sends nothing, and every recording is filed
 * under a person, named by the account's name and email, from its first
 * frame, and can be erased with the account. `PRIVACY.md` says so.
 */

import type { ProductPlatform } from "@luke/features/analytics";
import type { SessionReplayBootstrap } from "@luke/gateway/window-session";
import { isRecord, text, type UnparsedWireValue, type WireValue } from "@luke/wire";
import type { PostHog, Properties } from "posthog-js/dist/module.no-external";
import type { BundleImporter } from "./bundle-loader.js";
import { sessionRecorderLoaded } from "./session-recorder/contract.js";

/**
 * Where everything here posts. The processor's own address rather than Luke's
 * origin: nothing forwards on the user's behalf, so the processor sees the
 * address a request arrives from. Each shell's connect policy names it, and
 * the assets host beside it.
 */
const POSTHOG_HOST = "https://us.i.posthog.com";

/**
 * What keeps the words out of the recording: every text node masked (there is
 * no `maskAllText` for recordings, and the recorder drops an option it does
 * not know without a word, so the names are asserted against the installed
 * bundle), inputs masked by the library's default, the attributes that carry
 * words or an image asterisked (a `<meta>`'s `content` among them, which the
 * web app's document carries its description in) while `class` and `style`
 * still lay out, every
 * `href` among them but the two the replay lays out by (a stylesheet's and an
 * icon's symbol), because a link in a transcript or an Inbox item may go to
 * any page and its address can carry a token, autocapture off, since a click event carries the text of what was clicked,
 * and canvas recording off, since a canvas carries its words as pixels. Note
 * that the canvas option is set here rather than left to the library's
 * default, because the library reads it before the remote configuration and a
 * project that switched canvas recording on would otherwise turn it on here.
 * The console and the network are kept out on the same terms, because a
 * request's address or a console line can carry a token as freely as a link.
 */
const WORDS = new Set([
  "title",
  "aria-label",
  "aria-description",
  "aria-roledescription",
  "aria-valuetext",
  "aria-placeholder",
  "alt",
  "placeholder",
  "src",
  "content",
]);
const LAYOUT_HREFS = new Set(["link", "use"]);
const SESSION_REPLAY_MASKING = {
  autocapture: false,
  capture_dead_clicks: false,
  capture_performance: false,
  enable_recording_console_log: false,
  mask_all_text: true,
  session_recording: {
    captureCanvas: { recordCanvas: false },
    maskTextSelector: "*",
    maskAttributeFn: (name: string, value: string, element?: Element): string =>
      WORDS.has(name) || (name === "href" && !LAYOUT_HREFS.has(element?.localName ?? ""))
        ? "*".repeat(value.length)
        : value,
  },
} as const;

/**
 * The library's own preloaded-configuration global, which its
 * `RemoteConfigLoader` reads before it fetches anything: a config found here
 * is used as it stands, and the fetch never happens.
 *
 * Declared here because posthog-js does not declare it — it is assigned by
 * the hosted `/array/<token>/config.js` bundle rather than by anything in the
 * package's own types, so the shape is documented by what the loader reads
 * and nothing in the type system holds it still. `session-replay.test.ts`
 * asserts the name against the installed bundle.
 */
declare global {
  interface Window {
    _POSTHOG_REMOTE_CONFIG?: Record<
      string,
      { config: { sessionRecording: object; hasFeatureFlags: boolean } }
    >;
  }
}

/** What a shell that records answers for itself; everything else is decided here. */
export interface SessionReplayShell {
  /**
   * The shell it is, `PRODUCT_PLATFORM.DESKTOP` for the desktop's panel window
   * and `PRODUCT_PLATFORM.WEB` for the web app's tab: registered on what it
   * sends and set on the person, beside the build's version.
   */
  readonly platform: ProductPlatform;
  /**
   * The analytics project its recordings are filed under, fixed by its build;
   * empty for a build that records nothing, such as a development one.
   */
  readonly projectApiKey: () => string;
  /** The address the window says it has, in place of the one it has, which may name a person or carry their words. */
  readonly address: string;
  /**
   * Whether a value names an address the window must not report, its own in
   * any form it takes, or one that names a person or their words beside it;
   * such a value leaves as `address`.
   */
  readonly namesOwnAddress: (value: string) => boolean;
  /** The recorder's bundle, imported where the shell's bundler put it; it registers itself as it runs. */
  readonly importRecorder: BundleImporter<unknown>;
  /**
   * Where the client keeps its person and its consent in the window's
   * storage, in place of the library's names for them, which are its
   * project key's. A shell whose origin runs another client of the same
   * project names its own, so a stop's opt-out and reset never reach that
   * client; a shell with the origin to itself leaves them as they are.
   */
  readonly storage?: { readonly persistence: string; readonly consent: string };
}

/** The run's word on recording where it names a signed-in account, the only word that records. */
type SignedInBootstrap = SessionReplayBootstrap & { accountId: string };

/** The word as one that names a signed-in account, or none while signed out. */
function signedIn(bootstrap: SessionReplayBootstrap): SignedInBootstrap | undefined {
  const accountId = bootstrap.accountId;
  return accountId ? { ...bootstrap, accountId } : undefined;
}

/** Brings recording into line with the run's word on it; a test may stand its own recorder bundle in. */
export type ApplySessionReplay = (
  bootstrap: SessionReplayBootstrap,
  importRecorder?: BundleImporter<unknown>,
) => void;

/**
 * Takes the window's own address out of a value on its way to the processor.
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
 * here rather than trusted. Anything that is not the address is passed back
 * exactly as it came, and a missing value stays missing.
 */
export function withoutOwnAddress(
  value: UnparsedWireValue,
  shell: Pick<SessionReplayShell, "address" | "namesOwnAddress">,
): UnparsedWireValue {
  return value === undefined ? undefined : addressless(value, shell);
}

function addressless(
  value: WireValue,
  shell: Pick<SessionReplayShell, "address" | "namesOwnAddress">,
): WireValue {
  const asText = text(value);
  if (asText !== undefined) return shell.namesOwnAddress(asText) ? shell.address : value;
  if (Array.isArray(value)) return value.map((entry) => addressless(entry, shell));
  if (!isRecord(value)) return value;
  const scrubbed: Record<string, WireValue> = {};
  for (const [key, entry] of Object.entries(value)) scrubbed[key] = addressless(entry, shell);
  return scrubbed;
}

/**
 * The bridge between the library's own property bag and the parser above.
 * `Properties` types its values as `any`, which is what an unvalidated wire
 * value is; this is the one place that is said out loud.
 */
function scrubbedProperties(properties: Properties, shell: SessionReplayShell): Properties {
  const scrubbed: Properties = {};
  for (const [key, value] of Object.entries(properties)) {
    // SAFETY: the library built this bag, so its values are unvalidated wire
    // values by construction; the parser establishes any shape it acts on.
    scrubbed[key] = withoutOwnAddress(value as UnparsedWireValue, shell);
  }
  return scrubbed;
}

/**
 * Says recording is on, without asking.
 *
 * The library splits its traffic by kind: what it captures goes to the
 * ingestion host, and the configuration deciding whether to record at all
 * comes from its assets host, which it derives from the region rather
 * than taking as configuration. A policy naming only the first refuses that
 * read, and the refusal is silent — recording is gated on a property only
 * that response writes, so a blocked config reads exactly like a project
 * with recording switched off.
 *
 * Preloading answers it here instead. `sessionRecording` decides the gate by
 * truthiness alone, so an empty object turns recording on and supplies no
 * masking: `init`'s `session_recording` is read first and this response
 * second, so `SESSION_REPLAY_MASKING` stands. `hasFeatureFlags: false`
 * declines the flag fetch Luke has no use for.
 */
function preloadRemoteConfig(key: string): void {
  window._POSTHOG_REMOTE_CONFIG = {
    [key]: { config: { sessionRecording: {}, hasFeatureFlags: false } },
  };
}

/**
 * Opting in and out rather than only starting and stopping the recorder,
 * because this client sends more than recordings: the registered build and
 * the identified person travel on their own, and neither answers to
 * `stopSessionRecording`. A stop has to reach all of it — a deleted account
 * whose client kept talking would be the erasure failing to erase.
 *
 * The opt-in names no event: `$opt_in` counts a consent moving, and nothing
 * here moves one.
 */
function optIn(posthog: PostHog): void {
  posthog.opt_in_capturing({ captureEventName: false });
}

/**
 * Which build these came from, registered on every start rather than once at
 * init: stopping calls `reset`, which clears the registered properties along
 * with the person, so a recording resumed afterwards would otherwise say
 * nothing about the version it came from. `app_version`, `packaged`, and
 * `platform` are the names the counted events are stamped with, so one filter
 * separates both; `app_name` says the same as `platform`, under the name the
 * recordings made before it were filed by.
 */
function registerBuild(
  posthog: PostHog,
  bootstrap: SessionReplayBootstrap,
  platform: ProductPlatform,
): void {
  posthog.register({
    app_name: platform,
    app_version: bootstrap.appVersion,
    packaged: bootstrap.packaged,
    platform,
  });
}

/**
 * Who the person a recording is filed under is, as the analytics project
 * shows them: the account's name and email, which the host already holds for
 * the signed-in account, and the shell it was last seen on.
 */
function personProperties(
  bootstrap: SessionReplayBootstrap,
  platform: ProductPlatform,
): Properties {
  return {
    platform,
    ...(bootstrap.name ? { name: bootstrap.name } : undefined),
    ...(bootstrap.email ? { email: bootstrap.email } : undefined),
  };
}

/**
 * The window's one recording controller, over what its shell answers. The
 * shell calls this once per window and hands the answer to the panel as its
 * platform's `applySessionReplay`, which the panel calls at bootstrap and
 * again on every account transition, so a deletion or a sign-out stops the
 * recording where it stands rather than at the next launch, and a sign-in
 * starts one at once. Note that recording waits for an account even where the
 * host permits it, because a recording of nobody is one no deletion can
 * reach and nobody can find.
 */
export function sessionReplay(shell: SessionReplayShell): ApplySessionReplay {
  let started = false;
  let initialized = false;
  let loading = false;
  /** The client, once its module has landed after the recorder. */
  let client: PostHog | undefined;
  /** The run's latest word asking for a recording, which a recorder that finishes loading starts under. */
  let latest: SignedInBootstrap | undefined;
  /** The account the running recording is filed under, as last identified, cleared with the person on a stop. */
  let identified: SignedInBootstrap | undefined;

  /**
   * Files what is being recorded under the signed-in account, and sets the
   * name, email, and platform the person is shown by.
   *
   * The id is the same opaque one the counted events resolve to, so a recording
   * and the counts around it belong to one person — which is what makes
   * deleting the account erase the recordings with it.
   *
   * A sign-out or a deletion stops the recording and resets the person
   * (`stop`). Someone else signing in in place of the account, with no
   * sign-out between, resets it here: the library is given a new anonymous id,
   * and the build registered again, since `reset` clears it, so nothing
   * recorded after is filed under the person who left.
   * Note that an account already identified is not identified again, because
   * every account transition re-answers recording, most of them for nothing
   * that moved; where its name or email moved (a cookie session re-read when
   * a tab comes back), only the person's properties are set again, so the
   * recording stays findable by what the account is called now.
   */
  const followAccount = (posthog: PostHog, bootstrap: SignedInBootstrap): void => {
    const before = identified;
    identified = bootstrap;
    if (before?.accountId === bootstrap.accountId) {
      if (before.name !== bootstrap.name || before.email !== bootstrap.email) {
        posthog.setPersonProperties(personProperties(bootstrap, shell.platform));
      }
      return;
    }
    if (before !== undefined) {
      posthog.reset();
      registerBuild(posthog, bootstrap, shell.platform);
    }
    posthog.identify(bootstrap.accountId, personProperties(bootstrap, shell.platform));
  };

  /** Starts the client over a recorder already loaded: built once per window, resumed after that. */
  const record = (posthog: PostHog, key: string, bootstrap: SignedInBootstrap): void => {
    if (initialized) {
      // The client is built once per window. A second `init` would not rebuild
      // it, so a recording resumed after an account change is started rather
      // than re-configured — but it must still be told whose recording it is,
      // because the person may have changed since the last one.
      optIn(posthog);
      registerBuild(posthog, bootstrap, shell.platform);
      followAccount(posthog, bootstrap);
      posthog.startSessionRecording();
      return;
    }
    initialized = true;
    preloadRemoteConfig(key);
    posthog.init(key, {
      api_host: POSTHOG_HOST,
      defaults: "2025-11-30",
      // Both of these carry the window's own address, which is the shell's to
      // replace. Switching them off is only half of it — see `before_send`,
      // which is what takes that address off everything else.
      capture_pageview: false,
      capture_pageleave: false,
      capture_exceptions: false,
      // Neither the campaign a link carried nor the page that sent someone
      // here is kept on the person: both are other addresses, which the
      // shell's own address replacement does not reach.
      save_campaign_params: false,
      save_referrer: false,
      ...SESSION_REPLAY_MASKING,
      person_profiles: "always",
      persistence: "localStorage",
      ...(shell.storage
        ? {
            persistence_name: shell.storage.persistence,
            consent_persistence_name: shell.storage.consent,
          }
        : undefined),
      debug: false,
      get_current_url: () => shell.address,
      before_send: (event) => {
        if (!event) return event;
        // `$set` and `$set_once` carry the address too, as the person's
        // first-seen properties, where it would outlive every event holding it.
        return {
          ...event,
          properties: scrubbedProperties(event.properties, shell),
          ...(event.$set ? { $set: scrubbedProperties(event.$set, shell) } : undefined),
          ...(event.$set_once
            ? { $set_once: scrubbedProperties(event.$set_once, shell) }
            : undefined),
        };
      },
    });
    // Stopping opts out, and that is written into the same storage this client
    // reads at launch — so without opting back in here, a run that had ever
    // been stopped would come up recording nothing for the rest of the install.
    optIn(posthog);
    registerBuild(posthog, bootstrap, shell.platform);
    followAccount(posthog, bootstrap);
  };

  /**
   * Loads what recording needs, the recorder's bundle
   * (`session-recorder/contract.ts`) and then the client, a chunk of its own
   * that the bundle every window parses leaves out, and starts the client
   * under the run's word as it stands by then, unless a stop arrived while
   * they loaded. Note that the client is loaded only once the recorder is
   * there, because the "no-external" client never fetches a recorder of its
   * own: started first, it would find none and silently record nothing.
   * Either failing to load, or a recorder that loaded and registered nothing,
   * records nothing and stands recording down, so the run's next word on it
   * tries again.
   */
  const loadRecording = (key: string, importRecorder: BundleImporter<unknown>): void => {
    if (loading) return;
    loading = true;
    const failed = () => {
      loading = false;
      started = false;
    };
    const loadClient = () => {
      if (!sessionRecorderLoaded()) {
        failed();
        return;
      }
      // The "no-external" client: the full build without the surveys, product
      // tours, web vitals, and the rest Luke never turns on, and without the
      // recorder, which is a bundle of its own.
      void import("posthog-js/dist/module.no-external").then((module) => {
        loading = false;
        client = module.default;
        if (started && latest) record(client, key, latest);
      }, failed);
    };
    void importRecorder().then(loadClient, failed);
  };

  const start = (bootstrap: SignedInBootstrap, importRecorder: BundleImporter<unknown>) => {
    const key = shell.projectApiKey();
    if (!key) return;
    started = true;
    if (client !== undefined) record(client, key, bootstrap);
    else loadRecording(key, importRecorder);
  };

  const stop = (): void => {
    started = false;
    identified = undefined;
    const posthog = initialized ? client : undefined;
    if (posthog === undefined) return;
    posthog.stopSessionRecording();
    // The person goes with the recording. Without this the client keeps the
    // previous account's id and its anonymous session, so signing in as someone
    // else would file their recordings under the person who signed out — which
    // is the one thing filing under an account is supposed to prevent.
    posthog.reset();
    posthog.opt_out_capturing();
  };

  return (bootstrap, importRecorder = shell.importRecorder) => {
    // Whether recording should be running: the host's word, and an account to file it under.
    const wanted = bootstrap.permitted ? signedIn(bootstrap) : undefined;
    if (wanted === undefined) {
      if (started) stop();
      return;
    }
    latest = wanted;
    if (!started) {
      start(wanted, importRecorder);
      return;
    }
    // A client still loading starts under `latest`, which already names the account.
    if (initialized && client !== undefined) followAccount(client, wanted);
  };
}
