export const SENTRY_TRACES_SAMPLE_RATE = 0.1;

export const SENTRY_PROFILE_SESSION_SAMPLE_RATE = 0.05;

const SENTRY_IPC_URL_PREFIX = "sentry-ipc://";

export function sentryTracesRequest(url: string): boolean {
  return !url.toLowerCase().startsWith(SENTRY_IPC_URL_PREFIX);
}
