/**
 * session-replay.ts -- recording the shape of what the panel draws, and none of its words: the masking every shell records under, and the one controller that starts and stops it.
 *
 * This is not the counted-event stream and does not share its guarantee. A
 * counted event can only say what `packages/features/src/analytics/product-events.ts`
 * declared; this client is the analytics library posting straight to the
 * processor, and a recording is the rendered panel. What keeps a session
 * title, a branch, an error line, a caption, or the account's own name out of
 * it is `SESSION_REPLAY_MASKING` below, not a declared list of events: every
 * text node and every input is masked, every attribute but the few the replay
 * lays out by is asterisked, and autocapture is off; and the stylesheets the
 * panel builds from a person's words are emptied before a recording leaves
 * (`withoutWithheldSheets`). What leaves is layout, pointer
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
import { opensWithheldSheet } from "@luke/ui/session-replay-marks";
import { isRecord, text, type UnparsedWireValue, type WireValue } from "@luke/wire";
import type { PostHog, Properties } from "posthog-js/dist/module.no-external";
import type { BundleImporter } from "./bundle-loader.js";
import { sessionRecorderLoaded } from "./session-recorder/contract.js";

/**
 * Where everything here posts. The processor's own address rather than our
 * origin: nothing forwards on the user's behalf, so the processor sees the
 * address a request arrives from. Each shell's connect policy names it, and
 * the assets host beside it.
 */
const POSTHOG_HOST = "https://us.i.posthog.com";

/**
 * The panel's own `data-*` attributes its styles select on by their value,
 * each holding a keyword or a flag, never an id or a person's words: a
 * button's variant, the window's theme, a pane's state. One the styles come
 * to select on by value joins here, or the replay draws it as if it were
 * absent; an id such as `data-threads` never does.
 */
const LAYOUT_DATA = `
  above action actions actions-shown active aligned arrival at axis band
  brightens busy capture carried cell chart closable columns corner current
  current-look cut default denied density detail disabled disclosure done
  dot dragging drop-after drop-before drop-target dropping edge editing
  empty enabled end expanding extent fade fade-inset fill finger-tall fixed
  fold folded folds font frame full full-screen gap-control glide gone
  ground gutter-buffer height held here hold hover hug icon-only idle image
  inbox-comment inbox-shown indent indeterminate indicators inherit ink
  inset issue-state item-section item-selected keyboard kind labels-control
  landed late layer layout lead leaving legible level lifted lights line
  lines lit loaded look luke-boot-sidebar luke-density luke-profile
  luke-room luke-theme marked measure menu-open meta min-width mobile-bar
  mode motion move moves muted name narrow narrowest nudge numbered open
  opened orientation overflow page pane-beside pane-over panel-open
  panel-toggle pending picked place placed placement playing pointer-opens
  preview primary priority pull-request-state pulse rail-beside reach
  read-only refused removable repeat review-state risk roll room ruled
  sections selected separator shown side sidebar-collapsed sidebar-overlay
  single size slot stand start state status style submit surface swiped
  thumb tone truncate-container truncate-group-container turn turned type
  under under-more unread variant whole wide width worded wrap-heading
  wrapped zoom
`
  .trim()
  .split(/\s+/u)
  .map((name) => `data-${name}`);

/**
 * The attributes the replay lays a page out by, whose values leave as they
 * stand: every other attribute's value is asterisked, so an attribute nobody
 * named here is masked from the day it is first drawn. An attribute masked
 * this way still stands, empty where it was empty, so a selector that asks
 * only whether it is there still draws; what is listed is what draws by its
 * value. That is an element's classes and its own style, the sizes and
 * shapes an element takes from its attributes, the kind and the state a
 * control is drawn in, which the panel's styles select on, and what the
 * recorder writes for itself: the rules of a stylesheet it copied in, and
 * where a box left out of the recording stands. Each is a keyword, a number,
 * a colour, or a path, and never a person's words. Note that an element's own
 * style leaves whole, so nothing may write a person's words into one: the one
 * style built from a config, a chart's series colours (`@luke/ui/chart`), is
 * drawn from a module's constants, and only on the admin page, which the
 * recording leaves out. Names are lowercase, since the recorder hands an SVG
 * attribute over in the case it was written.
 */
const LAYOUT = new Set([
  "class",
  "style",
  "type",
  "role",
  "dir",
  "rel",
  "media",
  "tabindex",
  "contenteditable",
  "draggable",
  "width",
  "height",
  "colspan",
  "rowspan",
  "span",
  "cols",
  "rows",
  "size",
  // The state a control is drawn in, which the panel's styles select on.
  "aria-busy",
  "aria-checked",
  "aria-current",
  "aria-disabled",
  "aria-expanded",
  "aria-haspopup",
  "aria-invalid",
  "aria-pressed",
  "aria-selected",
  ...LAYOUT_DATA,
  // An SVG's geometry and paint.
  "viewbox",
  "preserveaspectratio",
  "xmlns",
  "d",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "fx",
  "fy",
  "points",
  "pathlength",
  "transform",
  "transform-origin",
  "offset",
  "gradientunits",
  "gradienttransform",
  "spreadmethod",
  "clippathunits",
  "maskunits",
  "patternunits",
  "fill",
  "fill-opacity",
  "fill-rule",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-opacity",
  "stop-color",
  "stop-opacity",
  "opacity",
  "clip-path",
  "clip-rule",
  "mask",
  "filter",
  "marker-start",
  "marker-mid",
  "marker-end",
  "vector-effect",
  "shape-rendering",
  "overflow",
  "visibility",
  "display",
  "color",
  "font-size",
  "font-weight",
  "text-anchor",
  "dominant-baseline",
  // What the recorder writes for itself.
  "_csstext",
  "rr_width",
  "rr_height",
  "rr_left",
  "rr_top",
  "rr_position",
  "rr_transform",
  "rr_display",
  "rr_mediastate",
  "rr_open_mode",
]);

/** Where a link's address is layout rather than a destination: a stylesheet's, and an icon's symbol. */
const LAYOUT_HREFS = new Set(["link", "use"]);

/** The SVG elements another element draws through by id, whose ids are the panel's own: an icon's symbol, a gradient, a clip, a mask. */
const SVG_RESOURCES = new Set([
  "symbol",
  "lineargradient",
  "radialgradient",
  "clippath",
  "mask",
  "pattern",
  "filter",
  "marker",
]);

/** The id the window's page mounts the panel on, whose box every pane's height is laid out from. */
const MOUNT_ID = "root";

/** Whether an attribute's value lays the replay out, and leaves as it stands. */
function laysOut(name: string, value: string, element: Element | undefined): boolean {
  const tag = element?.localName.toLowerCase() ?? "";
  if (name === "href") return LAYOUT_HREFS.has(tag);
  if (name === "id") return value === MOUNT_ID || SVG_RESOURCES.has(tag);
  return LAYOUT.has(name);
}

/**
 * What keeps the words out of the recording: every text node masked (there is
 * no `maskAllText` for recordings, and the recorder drops an option it does
 * not know without a word, so the names are asserted against the installed
 * bundle), every input masked, every attribute but those the replay lays out
 * by (`LAYOUT`) asterisked, autocapture off, since a click event carries the
 * text of what was clicked, and canvas recording off, since a canvas carries
 * its words as pixels.
 *
 * An allowlist rather than a list of the attributes that carry words,
 * because that list kept missing one: an element's `id` and the ids that
 * point at it, a `name`, a `value` off a field, a link's address written as
 * `xlink:href`, and every `data-*` attribute, where a row keeps its
 * repository's name and a list its options' ids. A link's address is masked
 * like the rest, because a link in a transcript or an Inbox item may go to
 * any page and its address can carry a token, but for the two the replay
 * lays out by: a stylesheet's and an icon's symbol. So is an `id`, but the
 * one the page mounts the panel on and those of an icon's symbol and the
 * gradients, clips, and masks an icon draws through, which are the panel's
 * own.
 *
 * Note that inputs are masked by name rather than by the library's default,
 * because the project's setting would otherwise decide; and that the
 * recorder masks no radio's, checkbox's, or file input's value at all,
 * whatever this says, so those are kept out where they are drawn
 * (`@luke/ui/session-replay-marks`, and the file picker's `ph-no-capture`).
 * The canvas option is set here rather than left to the library's default
 * on the same terms, because the library reads it before the remote
 * configuration and a project that switched canvas recording on would
 * otherwise turn it on here. The console and the network are kept out on the
 * same terms, because a request's address or a console line can carry a
 * token as freely as a link. A request's headers and body are off by name
 * too: the library sends them where this says so or the project does, and the
 * remote configuration this window preloads names neither.
 */
const SESSION_REPLAY_MASKING = {
  autocapture: false,
  capture_dead_clicks: false,
  capture_performance: false,
  enable_recording_console_log: false,
  mask_all_text: true,
  session_recording: {
    captureCanvas: { recordCanvas: false },
    maskAllInputs: true,
    maskTextSelector: "*",
    maskAttributeFn: (name: string, value: string, element?: Element): string =>
      laysOut(name.toLowerCase(), value, element) ? value : "*".repeat(value.length),
    recordHeaders: false,
    recordBody: false,
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
 * Empties every withheld sheet (`@luke/ui/session-replay-marks`) in what a
 * recording sends: the panel built it from a person's words, which its
 * selectors name in clear, since no masking reaches CSS.
 *
 * The recorder sends a sheet a document adopts as its list of rules, and a
 * sheet written again as its whole text, and the mark opens either: a list
 * holding the mark is sent empty, and a text opening with it is sent as
 * none. Anything else is passed back exactly as it came. Note that the
 * recorder sends a rule added on its own compressed, where no mark can be
 * read, which is why a withheld sheet is only ever written whole.
 */
function withoutWithheldSheets(value: WireValue): WireValue {
  const asText = text(value);
  if (asText !== undefined) return opensWithheldSheet(asText) ? "" : value;
  if (Array.isArray(value)) return value.map(withoutWithheldSheets);
  if (!isRecord(value)) return value;
  const rules = value.rules;
  if (Array.isArray(rules) && rules.some((each) => isRecord(each) && withheldRule(each.rule))) {
    return { ...value, rules: [] };
  }
  const scrubbed: Record<string, WireValue> = {};
  for (const [key, entry] of Object.entries(value)) scrubbed[key] = withoutWithheldSheets(entry);
  return scrubbed;
}

/** Whether a rule, as the recorder copied it, is a withheld sheet's mark. */
function withheldRule(rule: UnparsedWireValue): boolean {
  const asText = rule === undefined ? undefined : text(rule);
  return asText !== undefined && opensWithheldSheet(asText);
}

/**
 * The bridge between the library's own property bag and the parsers above.
 * `Properties` types its values as `any`, which is what an unvalidated wire
 * value is; this is the one place that is said out loud.
 */
function scrubbedProperties(properties: Properties, shell: SessionReplayShell): Properties {
  const scrubbed: Properties = {};
  for (const [key, value] of Object.entries(properties)) {
    // SAFETY: the library built this bag, so its values are unvalidated wire
    // values by construction; the parsers establish any shape they act on.
    const addressless = withoutOwnAddress(value as UnparsedWireValue, shell);
    scrubbed[key] = addressless === undefined ? undefined : withoutWithheldSheets(addressless);
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
 * declines the flag fetch we have no use for.
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
        // A name taken away is unset, since setting only what is there would leave the old one standing.
        if (before.name && !bootstrap.name) posthog.unsetPersonProperties(["name"]);
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
      // tours, web vitals, and the rest we never turn on, and without the
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
