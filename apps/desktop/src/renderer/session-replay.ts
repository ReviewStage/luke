import { PRODUCT_PLATFORM } from "@repo/features/analytics";
import { POSTHOG_PROXY } from "@repo/features/posthog-proxy";
import type { BundleImporter } from "@repo/panel/bundle-loader";
import {
  type ApplySessionReplay,
  sessionReplay,
  withoutOwnAddress,
} from "@repo/panel/session-replay";
import type { UnparsedWireValue } from "@repo/wire";

const RENDERER_ADDRESS = "app://desktop/panel";

const ACCOUNTS_DIRECTORY = "/Users/";

function loadedFrom(): string | undefined {
  const path = globalThis.location?.pathname;
  if (path === undefined) return undefined;
  const directory = path.slice(0, path.lastIndexOf("/") + 1);
  return directory.length > 1 ? directory : undefined;
}

function namesThisMachine(value: string): boolean {
  if (value.startsWith("file://") || value.startsWith(ACCOUNTS_DIRECTORY)) return true;
  const directory = loadedFrom();
  return directory !== undefined && value.startsWith(directory);
}

const ADDRESS = { address: RENDERER_ADDRESS, namesOwnAddress: namesThisMachine } as const;

export function withoutLocalAddress(value: UnparsedWireValue): UnparsedWireValue {
  return withoutOwnAddress(value, ADDRESS);
}

declare const PACKAGED_POSTHOG_PROJECT_API_KEY: string | undefined;

function projectApiKey(): string {
  try {
    return PACKAGED_POSTHOG_PROJECT_API_KEY ?? "";
  } catch {
    return "";
  }
}

const importSessionRecorder: BundleImporter<unknown> = () => import("./session-recorder/index");

const POSTHOG_HOST = { api: POSTHOG_PROXY.INGEST_ORIGIN, ui: POSTHOG_PROXY.UI_ORIGIN } as const;

export const applySessionReplay: ApplySessionReplay = sessionReplay({
  platform: PRODUCT_PLATFORM.DESKTOP,
  projectApiKey,
  host: POSTHOG_HOST,
  ...ADDRESS,
  importRecorder: importSessionRecorder,
});
