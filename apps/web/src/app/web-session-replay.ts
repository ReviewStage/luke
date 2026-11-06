import { PRODUCT_PLATFORM } from "@repo/features/analytics";
import { POSTHOG_PROXY } from "@repo/features/posthog-proxy";
import type { AppPlatform } from "@repo/panel/app-platform";
import type { BundleImporter } from "@repo/panel/bundle-loader";
import { type ApplySessionReplay, sessionReplay } from "@repo/panel/session-replay";
import { PANEL_PATH } from "./web-address";
import { webDeployment } from "./web-sentry";

type SessionReplayBootstrap = Parameters<AppPlatform["applySessionReplay"]>[0];

const OWN_PATH = /^\/(?![/*])\S*$/u;

const RECORDING_STORAGE = {
  persistence: "app_replay",
  consent: "app_replay_consent",
} as const;

const AFTER_ORIGIN = new Set(["/", "?", "#"]);

const PRODUCTION_DEPLOYMENT = "production";

const RECORDING_CHANNEL = "app-session-replay";

const RECORDING_NOTICE = {
  ACCOUNT_DELETED: "account-deleted",
} as const;

function projectApiKey(): string {
  if (webDeployment() !== PRODUCTION_DEPLOYMENT) return "";
  return import.meta.env.VITE_POSTHOG_PROJECT_API_KEY ?? "";
}

function namesThisTab(value: string): boolean {
  if (OWN_PATH.test(value)) return true;
  if (!value.startsWith(location.origin)) return false;
  const next = value.charAt(location.origin.length);
  return next === "" || AFTER_ORIGIN.has(next);
}

function namesReferrer(value: string): boolean {
  const referrer = document.referrer;
  if (referrer === "") return false;
  if (value === referrer) return true;
  return URL.canParse(referrer) && value === new URL(referrer).host;
}

function namesAddress(value: string): boolean {
  return namesThisTab(value) || namesReferrer(value);
}

const importSessionRecorder: BundleImporter<unknown> = () => import("./session-recorder");

const recording: ApplySessionReplay = sessionReplay({
  platform: PRODUCT_PLATFORM.WEB,
  projectApiKey,
  host: { api: POSTHOG_PROXY.PATH, ui: POSTHOG_PROXY.UI_ORIGIN },
  address: `${location.origin}${PANEL_PATH}`,
  namesOwnAddress: namesAddress,
  importRecorder: importSessionRecorder,
  storage: RECORDING_STORAGE,
});

let latest: SessionReplayBootstrap | undefined;

let held: { signedOutSince: boolean } | undefined;

function underHold(bootstrap: SessionReplayBootstrap): SessionReplayBootstrap {
  if (held === undefined) return bootstrap;
  if (bootstrap.accountId === undefined) held.signedOutSince = true;
  else if (held.signedOutSince) held = undefined;
  return held === undefined ? bootstrap : { ...bootstrap, permitted: false };
}

const channel = new BroadcastChannel(RECORDING_CHANNEL);

channel.addEventListener("message", (event) => {
  if (event.data !== RECORDING_NOTICE.ACCOUNT_DELETED) return;
  held = { signedOutSince: latest !== undefined && latest.accountId === undefined };
  if (latest !== undefined) recording({ ...latest, permitted: false });
});

function deletionLanded(bootstrap: SessionReplayBootstrap): boolean {
  return !bootstrap.permitted && bootstrap.accountId === undefined;
}

export const applyWebSessionReplay: ApplySessionReplay = (bootstrap, importRecorder) => {
  if (deletionLanded(bootstrap) && (latest === undefined || !deletionLanded(latest))) {
    channel.postMessage(RECORDING_NOTICE.ACCOUNT_DELETED);
  }
  latest = bootstrap;
  recording(underHold(bootstrap), importRecorder);
};
