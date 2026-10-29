/**
 * sentry-account.ts -- the Luke account a desktop window's or a web tab's report names: its id alone, as Sentry's user, never an email, a name, or a login.
 *
 * Main sets the account as its SDK's user, which every window's event takes
 * as it passes through main (`telemetry-service.ts`). A window's log line
 * does not pass through main's scope, and a window must never set a user of
 * its own: `@sentry/electron`'s renderer sends its whole scope to main on
 * every change, and main takes a user from it but never takes one away, so
 * a window that set one could put back an account that had just signed out.
 * So a window's lines, and the web tab's events and lines, are stamped with
 * the account as each leaves, read from the panel's own document then.
 */

/** The attribute a Sentry log line names its user by, as the SDK's own scope would write it. */
const USER_ID_ATTRIBUTE = "user.id";

/** A log line as `beforeSendLog` is handed it. */
interface SentLog {
  readonly attributes?: Record<string, unknown>;
}

/** An event as `beforeSend` is handed it. */
interface SentEvent {
  readonly user?: object;
}

/** Sentry's user for the account signed in, by its id alone, or none. */
export function sentryUser(accountId: string | undefined): { readonly id: string } | null {
  return accountId === undefined ? null : { id: accountId };
}

/** A log line naming the account signed in as it leaves; one sent while nobody is, as it was. */
export function logNamingAccount<Log extends SentLog>(
  log: Log,
  accountId: string | undefined,
): Log {
  if (accountId === undefined) return log;
  return { ...log, attributes: { ...log.attributes, [USER_ID_ATTRIBUTE]: accountId } };
}

/** An event naming the account signed in as its user; one sent while nobody is, as it was. */
export function eventNamingAccount<Event extends SentEvent>(
  event: Event,
  accountId: string | undefined,
): Event {
  if (accountId === undefined) return event;
  return { ...event, user: { ...event.user, id: accountId } };
}
