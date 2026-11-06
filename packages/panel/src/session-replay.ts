import type { ProductPlatform } from "@repo/features/analytics";
import type { SessionReplayBootstrap } from "@repo/gateway/window-session";
import { opensWithheldSheet, showsInReplay } from "@repo/ui/session-replay-marks";
import { isRecord, text, type UnparsedWireValue, type WireValue } from "@repo/wire";
import type { PostHog, Properties } from "posthog-js/dist/module.no-external";
import type { BundleImporter } from "./bundle-loader.js";
import { sessionRecorderLoaded } from "./session-recorder/contract.js";

const WORKSPACE_GROUP_TYPE = "workspace";

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
  lines lit loaded look marked measure menu-open meta min-width mobile-bar
  mode motion move moves muted name narrow narrowest nudge numbered open
  opened orientation overflow page pane-beside pane-over panel-open
  panel-toggle pending picked place placed placement playing pointer-opens
  preview primary priority pull-request-state pulse rail-beside reach
  read-only refused removable repeat review-state risk roll room ruled
  sections selected separator shown side sidebar-collapsed sidebar-overlay
  single size slot stand start state status style submit surface swiped
  thumb tone truncate-container truncate-group-container turn turned type
  ui-density ui-profile ui-room ui-theme under under-more
  unread variant whole wide width worded wrap-heading
  wrapped zoom
`
  .trim()
  .split(/\s+/u)
  .map((name) => `data-${name}`);

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

const LAYOUT_HREFS = new Set(["link", "use"]);

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

const MOUNT_ID = "root";

function laysOut(name: string, value: string, element: Element | undefined): boolean {
  const tag = element?.localName.toLowerCase() ?? "";
  if (name === "href") return LAYOUT_HREFS.has(tag);
  if (name === "id") return value === MOUNT_ID || SVG_RESOURCES.has(tag);
  return LAYOUT.has(name);
}

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
    maskTextFn: (text: string, element?: HTMLElement | null): string =>
      showsInReplay(element) ? text : text.replace(/\S/g, "*"),
    maskAttributeFn: (name: string, value: string, element?: Element): string =>
      laysOut(name.toLowerCase(), value, element) ? value : "*".repeat(value.length),
    slimDOMOptions: { comment: true },
    recordHeaders: false,
    recordBody: false,
  },
} as const;

declare global {
  interface Window {
    _POSTHOG_REMOTE_CONFIG?: Record<
      string,
      { config: { sessionRecording: object; hasFeatureFlags: boolean } }
    >;
  }
}

export interface SessionReplayShell {
  readonly platform: ProductPlatform;
  readonly projectApiKey: () => string;
  readonly host: { readonly api: string; readonly ui: string };
  readonly address: string;
  readonly namesOwnAddress: (value: string) => boolean;
  readonly importRecorder: BundleImporter<unknown>;
  readonly storage?: { readonly persistence: string; readonly consent: string };
}

type SignedInBootstrap = SessionReplayWord & { accountId: string };

function signedIn(bootstrap: SessionReplayWord): SignedInBootstrap | undefined {
  const accountId = bootstrap.accountId;
  return accountId ? { ...bootstrap, accountId } : undefined;
}

export type SessionReplayWord = SessionReplayBootstrap & { workspaceId?: string | undefined };

export type ApplySessionReplay = (
  bootstrap: SessionReplayWord,
  importRecorder?: BundleImporter<unknown>,
) => void;

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

function withheldRule(rule: UnparsedWireValue): boolean {
  const asText = rule === undefined ? undefined : text(rule);
  return asText !== undefined && opensWithheldSheet(asText);
}

function scrubbedProperties(properties: Properties, shell: SessionReplayShell): Properties {
  const scrubbed: Properties = {};
  for (const [key, value] of Object.entries(properties)) {
    const addressless = withoutOwnAddress(value as UnparsedWireValue, shell);
    scrubbed[key] = addressless === undefined ? undefined : withoutWithheldSheets(addressless);
  }
  return scrubbed;
}

function preloadRemoteConfig(key: string): void {
  window._POSTHOG_REMOTE_CONFIG = {
    [key]: { config: { sessionRecording: {}, hasFeatureFlags: false } },
  };
}

function optIn(posthog: PostHog): void {
  posthog.opt_in_capturing({ captureEventName: false });
}

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

export function sessionReplay(shell: SessionReplayShell): ApplySessionReplay {
  let started = false;
  let initialized = false;
  let loading = false;
  let client: PostHog | undefined;
  let latest: SignedInBootstrap | undefined;
  let identified: SignedInBootstrap | undefined;
  let grouped: string | undefined;

  const followWorkspace = (posthog: PostHog, workspaceId: string | undefined): void => {
    if (grouped === workspaceId) return;
    grouped = workspaceId;
    if (workspaceId === undefined) posthog.resetGroups();
    else posthog.group(WORKSPACE_GROUP_TYPE, workspaceId);
  };

  const followAccount = (posthog: PostHog, bootstrap: SignedInBootstrap): void => {
    const before = identified;
    identified = bootstrap;
    if (before?.accountId === bootstrap.accountId) {
      if (before.name !== bootstrap.name || before.email !== bootstrap.email) {
        if (before.name && !bootstrap.name) posthog.unsetPersonProperties(["name"]);
        posthog.setPersonProperties(personProperties(bootstrap, shell.platform));
      }
      return;
    }
    if (before !== undefined) {
      posthog.reset();
      grouped = undefined;
      registerBuild(posthog, bootstrap, shell.platform);
    }
    posthog.identify(bootstrap.accountId, personProperties(bootstrap, shell.platform));
  };

  const follow = (posthog: PostHog, bootstrap: SignedInBootstrap): void => {
    followAccount(posthog, bootstrap);
    followWorkspace(posthog, bootstrap.workspaceId);
  };

  const record = (posthog: PostHog, key: string, bootstrap: SignedInBootstrap): void => {
    if (initialized) {
      optIn(posthog);
      registerBuild(posthog, bootstrap, shell.platform);
      follow(posthog, bootstrap);
      posthog.startSessionRecording();
      return;
    }
    initialized = true;
    preloadRemoteConfig(key);
    posthog.init(key, {
      api_host: shell.host.api,
      ui_host: shell.host.ui,
      defaults: "2025-11-30",
      capture_pageview: false,
      capture_pageleave: false,
      capture_exceptions: false,
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
    optIn(posthog);
    registerBuild(posthog, bootstrap, shell.platform);
    follow(posthog, bootstrap);
  };

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
    grouped = undefined;
    const posthog = initialized ? client : undefined;
    if (posthog === undefined) return;
    posthog.stopSessionRecording();
    posthog.reset();
    posthog.opt_out_capturing();
  };

  return (bootstrap, importRecorder = shell.importRecorder) => {
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
    if (initialized && client !== undefined) follow(client, wanted);
  };
}
