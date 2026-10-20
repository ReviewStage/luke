/**
 * web-sentry.ts -- the web app's error and performance reports: Sentry's browser SDK, loaded and started only where the build carries a DSN, on the desktop renderer's terms.
 *
 * The tab reports to the `luke-web` project, the deployment it is served
 * from, under the same DSN, environment, and release the deployment's own
 * functions report under (`packages/service/src/observability/sentry.ts`),
 * read from the build's environment as the desktop reads its own: Vercel's
 * `SENTRY_DSN`, `VERCEL_ENV`, and `VERCEL_GIT_COMMIT_SHA`, written into the
 * bundle by `vite.config.ts`. A build without a DSN, a development server
 * among them unless its shell sets one, loads nothing and sends nothing.
 * The SDK runs with its default data collection, as the desktop's does
 * (root `AGENTS.md`), and traces the share of page loads the desktop does
 * (`SENTRY_TRACES_SAMPLE_RATE`).
 *
 * Note that the SDK is a chunk of its own (`web-sentry-sdk.ts`), imported
 * the moment the root starts rather than carried in the entry, because the entry is held to its
 * budget (`bundle-budget.json`) and a tab with no DSN should not parse it at
 * all. What is reported before it lands, a failure an Effect boundary of the
 * tab's runtime reported, a tab that could draw nothing, or a refusal of the
 * page's policy, is kept for it, a few at most, and sent once it stands.
 */

import { type SentryCapture, sentryReporterLayer } from "@luke/features/sentry-reporting";
import type { Layer } from "effect";

/** What the build says about where the tab reports. */
export interface WebSentryBuild {
  /** The project's DSN; empty for a build that reports nothing. */
  readonly dsn: string;
  /** Vercel's name for the deployment: `production`, `preview`, or `development`. */
  readonly environment: string;
  /** The deployment's commit, the release its functions report under; empty where the build names none. */
  readonly release: string;
}

/** What the root reports through once the SDK stands. */
export interface WebSentry {
  /** Reports a tab whose host could not stand or whose state could not be read, so nothing is drawn. */
  readonly reportBlankTab: (error: Error) => void;
  /** Captures a failure an Effect boundary of the tab's runtime reported (`@luke/features/sentry-reporting`). */
  readonly captureException: SentryCapture["captureException"];
  /** Sends one kind of request the page's policy refused, by its directive and the origin it was refused. */
  readonly reportRefusal: (directive: string, origin: string) => void;
}

/** What the root reports through from the moment it starts, whether the SDK stands yet or not. */
export interface WebSentryReports {
  /** Reports a tab that could draw nothing. */
  readonly reportBlankTab: (error: Error) => void;
  /** Effect's reporters with Sentry's beside them, for the tab's runtime to stand on. */
  readonly errorReporting: Layer.Layer<never>;
  /** Settles once the SDK stands, or never will, and what was said before then was sent or dropped. */
  readonly settled: Promise<void>;
}

/** One report, said to the SDK once it stands. */
type Report = (sentry: WebSentry) => void;

/**
 * How many reports said before the SDK's chunk lands are kept for it; the
 * rest are dropped, so a tab failing in a loop while the chunk loads holds
 * no more than these.
 */
const EARLY_REPORTS_KEPT = 20;

/** The schemes a browser extension's own addresses are on: what one refused is the extension's, not the page's. */
const EXTENSION_SCHEMES: ReadonlySet<string> = new Set([
  "chrome-extension",
  "moz-extension",
  "safari-web-extension",
]);

/** The browser's own words for what it refused that names no address, said as they are. */
const REFUSAL_KEYWORDS: ReadonlySet<string> = new Set([
  "inline",
  "eval",
  "wasm-eval",
  "data",
  "blob",
  "trusted-types-policy",
  "trusted-types-sink",
]);

/** What a refusal says of an address it could not read, in place of the address. */
const UNREADABLE_ADDRESS = "an unreadable address";

/** The environment a report names where the build names none, as the deployment's functions do. */
const UNNAMED_DEPLOYMENT = "development";

declare const WEB_SENTRY_DSN: string | undefined;
declare const WEB_DEPLOYMENT: string | undefined;
declare const WEB_SENTRY_RELEASE: string | undefined;

/**
 * What this build carries, from the free identifiers `vite.config.ts`
 * replaces. A module that never went through the bundler, as in a test, has
 * none of them, and reading one throws, which is a build with no DSN.
 */
export function webSentryBuild(): WebSentryBuild {
  try {
    return {
      dsn: WEB_SENTRY_DSN ?? "",
      environment: WEB_DEPLOYMENT || UNNAMED_DEPLOYMENT,
      release: WEB_SENTRY_RELEASE ?? "",
    };
  } catch {
    return { dsn: "", environment: UNNAMED_DEPLOYMENT, release: "" };
  }
}

/** Loads and starts the SDK, answering nothing where it could not load, which leaves the tab running and reporting nothing. */
async function loadedSentry(build: WebSentryBuild): Promise<WebSentry | undefined> {
  try {
    const { initWebSentry } = await import("./web-sentry-sdk");
    return initWebSentry(build);
  } catch (error) {
    console.warn("Sentry's SDK could not load; this tab reports nothing.", error);
    return undefined;
  }
}

/**
 * Says each report to the SDK once `started` settles: at once where it
 * stands, kept until then where it does not yet (the first
 * `EARLY_REPORTS_KEPT` of them), and dropped where it never will.
 */
function reportsOnceStarted(started: Promise<WebSentry | undefined>): {
  readonly say: (report: Report) => void;
  readonly settled: Promise<void>;
} {
  let standing: WebSentry | undefined;
  let early: Report[] | undefined = [];
  const settled = started.then((sentry) => {
    const kept = early ?? [];
    standing = sentry;
    early = undefined;
    if (sentry !== undefined) for (const report of kept) report(sentry);
  });
  const say = (report: Report): void => {
    if (standing !== undefined) report(standing);
    else if (early !== undefined && early.length < EARLY_REPORTS_KEPT) early.push(report);
  };
  return { say, settled };
}

/** Whether an address is a browser extension's own, by its scheme, with or without what follows it. */
function isExtensionAddress(address: string): boolean {
  return EXTENSION_SCHEMES.has(address.split(":", 1)[0] ?? "");
}

/**
 * Where a refused address is said by no more than its origin, or by the
 * browser's own word for what it refused (`inline`, `eval`), so a path or a
 * query, which may carry a token, never leaves the tab; anything else is
 * said as unreadable rather than as it came.
 */
function refusedOrigin(blockedURI: string): string {
  if (REFUSAL_KEYWORDS.has(blockedURI)) return blockedURI;
  try {
    const { origin } = new URL(blockedURI);
    return origin === "null" ? UNREADABLE_ADDRESS : origin;
  } catch {
    return UNREADABLE_ADDRESS;
  }
}

/** Each origin already said under each directive, so every kind of refusal is said once per document. */
const refusalsSaid = new Map<string, Set<string>>();

/** Where this document's refusals are said: the latest start's reports, or nothing before the first. */
let refusalsSaidTo: ((report: Report) => void) | undefined;

/**
 * Each kind of request the page's `Content-Security-Policy` refused, said
 * once per directive and origin, from one listener per document however
 * often the SDK starts, listening from the moment the tab starts rather than
 * once the SDK's chunk lands. A refusal says nothing in the page, so a
 * connection the policy forgot (the account inbox's Realtime socket was
 * one) would otherwise fail in silence. A refusal of an extension's address,
 * or of what an extension's own script did, is the extension's and is
 * dropped.
 */
function listenForRefusals(say: (report: Report) => void): void {
  const listening = refusalsSaidTo !== undefined;
  refusalsSaidTo = say;
  if (listening) return;
  document.addEventListener("securitypolicyviolation", (event) => {
    if (isExtensionAddress(event.blockedURI) || isExtensionAddress(event.sourceFile)) return;
    const directive = event.effectiveDirective;
    const origin = refusedOrigin(event.blockedURI);
    const origins = refusalsSaid.get(directive) ?? new Set<string>();
    if (origins.has(origin)) return;
    refusalsSaid.set(directive, origins.add(origin));
    refusalsSaidTo?.((sentry) => sentry.reportRefusal(directive, origin));
  });
}

/**
 * Starts loading the SDK where the build carries a DSN, answering at once
 * what the tab reports through: every report said before the SDK stands is
 * kept for it, up to a few, and a build with no DSN, or an SDK that could
 * not load, drops them all and sends nothing.
 */
export function startWebSentry(build: WebSentryBuild): WebSentryReports {
  const { say, settled } = reportsOnceStarted(
    build.dsn ? loadedSentry(build) : Promise.resolve(undefined),
  );
  if (build.dsn) listenForRefusals(say);
  return {
    reportBlankTab: (error) => say((sentry) => sentry.reportBlankTab(error)),
    errorReporting: sentryReporterLayer({
      captureException: (error, hint) => {
        say((sentry) => sentry.captureException(error, hint));
        // Note that no event id is known yet, because the event may wait on the SDK's chunk.
        return "";
      },
    }),
    settled,
  };
}
