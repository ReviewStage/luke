/**
 * How the recording endpoint reaches the analytics processor. The project key
 * comes from the deployment's environment and never appears in a response, a
 * log line, or an error; without one the endpoint answers 503 and product
 * analytics is simply off, the same kill switch the voice endpoint uses for
 * its OpenAI key.
 *
 * `fetch` rather than the vendor SDK on purpose. The SDK's value is queueing,
 * retry, and a background flush, all built for a long-lived process; a
 * serverless instance may freeze the moment it returns, so a background flush
 * can be lost silently, and shutting the SDK down per request produces the
 * same single POST minus a dependency to track. What is given up is automatic
 * retry, which this pipeline does not want — the desktop never retries either.
 */

export const POSTHOG_ENVIRONMENT = {
  PROJECT_API_KEY: "POSTHOG_PROJECT_API_KEY",
  /** The ingestion host a batch is posted to. */
  HOST: "POSTHOG_HOST",
  /** The private API host deletion is asked of, which is not the ingestion host. */
  API_HOST: "POSTHOG_API_HOST",
  /** Deletion is a private endpoint, so it takes a personal key rather than the project token. */
  PERSONAL_API_KEY: "POSTHOG_PERSONAL_API_KEY",
  PROJECT_ID: "POSTHOG_PROJECT_ID",
} as const;

export const POSTHOG_DEFAULTS = {
  HOST: "https://us.i.posthog.com",
  /** The private API lives on the app host, not the ingestion host. */
  API_HOST: "https://us.posthog.com",
  BATCH_PATH: "/batch/",
  REQUEST_TIMEOUT_MS: 5_000,
} as const;

/**
 * One project's console page, on the app host the private API lives on —
 * never the ingestion host, which serves no pages. This is an address for a
 * maintainer's browser, not an endpoint Luke calls, and it honors the same
 * host override the erasure call does, so an EU project links to its own
 * console.
 */
export function posthogProjectConsoleUrl(projectId: string, host?: string): string {
  return `${resolvePosthogApiHost(host)}/project/${encodeURIComponent(projectId)}`;
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/**
 * Who the account behind a batch is, as the person record should read. The
 * service reads this from its own user row rather than taking it from the
 * request, so the desktop still names nobody: these are the same fields the
 * account itself already holds.
 */
export interface PosthogPerson {
  name?: string;
  email?: string;
}

/** Every kind of value one of this build's event properties may hold. */
export type PosthogPropertyValue = string | number | boolean | PosthogPerson;

/** One item of the documented batch document, as this build builds it. */
export interface PosthogBatchItem {
  event: string;
  timestamp: string;
  properties: Readonly<Record<string, PosthogPropertyValue>>;
}

/** The whole batch document, exactly as the capture endpoint documents it. */
export interface PosthogBatch {
  api_key: string;
  historical_migration: boolean;
  batch: readonly PosthogBatchItem[];
}

export interface PosthogUpstreamOptions {
  host?: string;
  fetch?: FetchLike;
  timeoutMs?: number;
}

function withoutTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

/** The deployment's private-API host override when it holds one, the default otherwise. */
function resolvePosthogApiHost(host: string | undefined): string {
  return withoutTrailingSlash(host?.trim() || POSTHOG_DEFAULTS.API_HOST);
}

/**
 * Posts one batch document, resolving to nothing on a network fault so the
 * caller answers 502 without ever holding an error that could name the key.
 */
export async function postPosthogBatch(
  body: PosthogBatch,
  options: PosthogUpstreamOptions = {},
): Promise<Response | undefined> {
  const send = options.fetch ?? ((input: string, init: RequestInit) => fetch(input, init));
  const host = withoutTrailingSlash(options.host?.trim() || POSTHOG_DEFAULTS.HOST);
  try {
    return await send(`${host}${POSTHOG_DEFAULTS.BATCH_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeoutMs ?? POSTHOG_DEFAULTS.REQUEST_TIMEOUT_MS),
    });
  } catch {
    return undefined;
  }
}

export interface PosthogForgetOptions extends PosthogUpstreamOptions {
  personalApiKey: string;
  projectId: string;
}

/**
 * Asks the processor to erase the person behind one distinct id, and the
 * events recorded against them. The documented bulk-delete endpoint takes the
 * distinct ids in its body and `delete_events` in its query, and queues the
 * event deletion rather than performing it — so a resolved promise means the
 * erasure was accepted, never that it has already happened.
 */
export async function forgetPosthogPerson(
  distinctId: string,
  options: PosthogForgetOptions,
): Promise<void> {
  const send = options.fetch ?? ((input: string, init: RequestInit) => fetch(input, init));
  const host = resolvePosthogApiHost(options.host);
  const url = `${host}/api/projects/${encodeURIComponent(options.projectId)}/persons/bulk_delete/?delete_events=true`;
  const response = await send(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${options.personalApiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ distinct_ids: [distinctId] }),
    signal: AbortSignal.timeout(options.timeoutMs ?? POSTHOG_DEFAULTS.REQUEST_TIMEOUT_MS),
  });
  // The status alone diagnoses the refusal; the body could name the key.
  if (!response.ok) throw new Error(`Analytics erasure refused with status ${response.status}`);
}
