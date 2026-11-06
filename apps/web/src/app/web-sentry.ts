import { type EarlyReports, reportsOnceStarted } from "@repo/features/sentry-early-reports";
import { type SentryCapture, sentryReporterLayer } from "@repo/features/sentry-reporting";
import type { ShownFailureSent } from "@repo/features/shown-failure";
import type { ShownFailureReporter } from "@repo/panel/failure-report";
import { queryClient } from "@repo/panel/query-client";
import type { Layer } from "effect";

export interface WebSentryBuild {
  readonly dsn: string;
  readonly environment: string;
  readonly release: string;
}

export interface WebSentry {
  readonly reportBlankTab: (error: Error) => void;
  readonly captureException: SentryCapture["captureException"];
  readonly reportRefusal: (directive: string, origin: string) => void;
  readonly reportShownFailure: ShownFailureReporter;
}

export interface WebSentryReports {
  readonly reportBlankTab: (error: Error) => void;
  readonly reportShownFailure: ShownFailureReporter;
  readonly errorReporting: Layer.Layer<never>;
  readonly settled: Promise<void>;
}

const EARLY_REPORTS_KEPT = 20;

const EXTENSION_SCHEME = {
  CHROME: "chrome-extension",
  FIREFOX: "moz-extension",
  SAFARI: "safari-web-extension",
} as const;
const EXTENSION_SCHEMES: ReadonlySet<string> = new Set(Object.values(EXTENSION_SCHEME));

const REFUSAL_KEYWORD = {
  INLINE: "inline",
  EVAL: "eval",
  WASM_EVAL: "wasm-eval",
  DATA: "data",
  BLOB: "blob",
  TRUSTED_TYPES_POLICY: "trusted-types-policy",
  TRUSTED_TYPES_SINK: "trusted-types-sink",
} as const;
const REFUSAL_KEYWORDS: ReadonlySet<string> = new Set(Object.values(REFUSAL_KEYWORD));

const UNREADABLE_ADDRESS = "an unreadable address";

const UNNAMED_DEPLOYMENT = "development";

declare const WEB_SENTRY_DSN: string | undefined;
declare const WEB_DEPLOYMENT: string | undefined;
declare const WEB_SENTRY_RELEASE: string | undefined;

function buildDefine(read: () => string | undefined, fallback: string): string {
  try {
    return read() || fallback;
  } catch {
    return fallback;
  }
}

export function webDeployment(): string {
  return buildDefine(() => WEB_DEPLOYMENT, "");
}

export function webSentryBuild(): WebSentryBuild {
  return {
    dsn: buildDefine(() => WEB_SENTRY_DSN, ""),
    environment: webDeployment() || UNNAMED_DEPLOYMENT,
    release: buildDefine(() => WEB_SENTRY_RELEASE, ""),
  };
}

async function loadedSentry(build: WebSentryBuild): Promise<WebSentry | undefined> {
  try {
    const { initWebSentry } = await import("./web-sentry-sdk");
    return initWebSentry(build, queryClient);
  } catch (error) {
    console.warn("Sentry's SDK could not load; this tab reports nothing.", error);
    return undefined;
  }
}

function isExtensionAddress(address: string): boolean {
  return EXTENSION_SCHEMES.has(address.split(":", 1)[0] ?? "");
}

function refusedOrigin(blockedURI: string): string {
  if (REFUSAL_KEYWORDS.has(blockedURI)) return blockedURI;
  try {
    const { origin } = new URL(blockedURI);
    return origin === "null" ? UNREADABLE_ADDRESS : origin;
  } catch {
    return UNREADABLE_ADDRESS;
  }
}

const refusalsSaid = new Map<string, Set<string>>();

let refusalsSaidTo: EarlyReports<WebSentry>["say"] | undefined;

function listenForRefusals(say: EarlyReports<WebSentry>["say"]): void {
  const listening = refusalsSaidTo !== undefined;
  refusalsSaidTo = say;
  if (listening) return;
  document.addEventListener("securitypolicyviolation", (event) => {
    if (isExtensionAddress(event.blockedURI) || isExtensionAddress(event.sourceFile)) return;
    const directive = event.effectiveDirective;
    const origin = refusedOrigin(event.blockedURI);
    const origins = refusalsSaid.get(directive) ?? new Set<string>();
    if (origins.has(origin)) return;
    if (refusalsSaidTo?.((sentry) => sentry.reportRefusal(directive, origin))) {
      refusalsSaid.set(directive, origins.add(origin));
    }
  });
}

export function startWebSentry(build: WebSentryBuild): WebSentryReports {
  const { say, settled } = reportsOnceStarted(
    build.dsn ? loadedSentry(build) : Promise.resolve(undefined),
    EARLY_REPORTS_KEPT,
  );
  if (build.dsn) listenForRefusals(say);
  return {
    reportBlankTab: (error) => say((sentry) => sentry.reportBlankTab(error)),
    reportShownFailure: (report) => {
      let sent: ShownFailureSent | undefined;
      say((sentry) => {
        sent = sentry.reportShownFailure(report);
      });
      return sent;
    },
    errorReporting: sentryReporterLayer({
      captureException: (error, hint) => {
        say((sentry) => sentry.captureException(error, hint));
        return "";
      },
    }),
    settled,
  };
}
