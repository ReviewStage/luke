/**
 * What a cloud provider's answers are read with, and what a request to one is
 * described by: the shared bounds, the route and request shapes, and the small
 * readers every adapter's parsing is built out of. Nothing here reaches a
 * network; issuing a request is `cloudPass`'s alone.
 */

import { UNKNOWN_WORKSPACE_LABEL } from "@sidecar/session";
import { isRecord, positiveInteger, text, type WireRecord } from "@sidecar/wire";

const GIT_SUFFIX = ".git";

/**
 * Cloud-only request bounds. The freshness bound in `OBSERVATION_WINDOW` is
 * shared with every local provider.
 */
export const CLOUD_ADAPTER_DEFAULTS = {
  MINIMUM_REFRESH_INTERVAL_MS: 15 * 1000,
  REQUEST_TIMEOUT_MS: 8 * 1000,
  /**
   * For the rare read a provider documents as slow — Cursor's repository list
   * can take tens of seconds for a large organisation. A read on this deadline
   * must never hold the observation pass; it is for work that rides beside
   * one.
   */
  SLOW_REQUEST_TIMEOUT_MS: 45 * 1000,
} as const;

/**
 * The only way an adapter reaches its provider while observing. It
 * authenticates, bounds, and parses the request, and it can express nothing
 * but a read, so no observation pass built on it can change provider state.
 * The deadline can be widened only to the slow bound, and only for a read the
 * provider itself documents as slow.
 *
 * A read the provider answers only at a POSTed query endpoint — Conductor's
 * transcripts view — names its document here, and the separation a GET gives
 * for free is held the way the Linear tracker holds it: the document's text is
 * fixed by the build, observation only ever sends a read, and an adapter
 * interpolates nothing into it beyond identifiers the same pass reported, each
 * validated against the shape its provider documents.
 */
export type CloudRequest = (
  segments: readonly string[],
  query?: Readonly<Record<string, string>>,
  options?: Readonly<{ timeoutMs?: number; document?: string }>,
) => Promise<WireRecord>;

/**
 * One documented write a provider takes for one of its sessions: the route and
 * the exact body its endpoint asks for. An adapter describes the request;
 * `cloudPass` is the only thing that issues one.
 */
export interface CloudWriteRoute {
  segments: readonly string[];
  /**
   * A Google-style custom method, appended to the path as `:action` rather
   * than as a segment: it names what the request does to the resource the
   * segments already name.
   */
  action?: string;
  /** Left off entirely for an endpoint that documents an empty request. */
  body?: Readonly<WireRecord>;
  /**
   * For the rare write the provider answers only once the action itself is done
   * — Conductor's archive stands the whole workspace down before it says so,
   * well past the shared request bound. A deadline shorter than the action turns
   * a write that landed into "may not have landed", so such a route asks for
   * the slow bound, the same ceiling a slow read gets and the widest this one
   * can reach.
   */
  timeoutMs?: number;
}

/**
 * A request's deadline never widens past the slow bound: the option exists for
 * a read or write the provider is known to answer slowly, not for one that
 * never ends.
 */
export function requestDeadlineMs(requested: number | undefined): number {
  return Math.min(
    positiveInteger(requested, CLOUD_ADAPTER_DEFAULTS.REQUEST_TIMEOUT_MS),
    CLOUD_ADAPTER_DEFAULTS.SLOW_REQUEST_TIMEOUT_MS,
  );
}

export function isDefined<Value>(value: Value | undefined): value is Value {
  return value !== undefined;
}

export function textFromRecord(record: WireRecord, key: string): string | undefined {
  return text(record[key]);
}

export function timestampFromRecord(record: WireRecord, key: string): number | undefined {
  const value = textFromRecord(record, key);
  if (!value) return undefined;
  const timestampMs = Date.parse(value);
  return Number.isFinite(timestampMs) ? timestampMs : undefined;
}

/**
 * Reads a value a provider reported only when this build knows it, so a state
 * added after this build shipped is left undefined rather than guessed at.
 */
export function knownValue<Value extends string>(
  values: Readonly<Record<string, Value>>,
  reported: string | undefined,
): Value | undefined {
  return Object.values(values).find((candidate) => candidate === reported);
}

/** Reads a list page without assuming which key a given provider wraps it in. */
export function recordsFromPage(body: WireRecord, key: string): WireRecord[] {
  const data = body[key];
  return Array.isArray(data) ? data.filter(isRecord) : [];
}

/**
 * Luke labels a session by its repository, never by a workspace, agent, or
 * session name. Cloud providers derive those names from the opening prompt, so
 * they are transcript content that no adapter may surface.
 */
export function repositoryLabel(
  gitRemote: string | undefined,
  fallbackName: string | undefined,
): string {
  const remote = gitRemote?.trim().replace(/\/+$/, "");
  const lastSegment = remote?.split(/[/:]/).pop()?.trim();
  const repository = lastSegment?.endsWith(GIT_SUFFIX)
    ? lastSegment.slice(0, -GIT_SUFFIX.length)
    : lastSegment;
  return repository || fallbackName?.trim() || UNKNOWN_WORKSPACE_LABEL;
}
