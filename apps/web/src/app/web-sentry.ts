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
 * all. What fails before it lands is the console's, as on a desktop window
 * whose SDK has not started.
 */

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
}

/** The environment a report names where the build names none, as the deployment's functions do. */
const UNNAMED_DEPLOYMENT = "development";

declare const WEB_SENTRY_DSN: string | undefined;
declare const WEB_SENTRY_ENVIRONMENT: string | undefined;
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
      environment: WEB_SENTRY_ENVIRONMENT || UNNAMED_DEPLOYMENT,
      release: WEB_SENTRY_RELEASE ?? "",
    };
  } catch {
    return { dsn: "", environment: UNNAMED_DEPLOYMENT, release: "" };
  }
}

/**
 * Loads and starts the SDK where the build carries a DSN, answering how to
 * report through it, or nothing where it carries none or the SDK could not
 * load, which leaves the tab running and reporting nothing.
 */
export async function startWebSentry(build: WebSentryBuild): Promise<WebSentry | undefined> {
  if (!build.dsn) return undefined;
  try {
    const { initWebSentry } = await import("./web-sentry-sdk");
    return initWebSentry(build);
  } catch (error) {
    console.warn("Sentry's SDK could not load; this tab reports nothing.", error);
    return undefined;
  }
}
