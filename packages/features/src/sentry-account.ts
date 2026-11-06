const USER_ID_ATTRIBUTE = "user.id";

interface SentLog {
  readonly attributes?: Record<string, unknown>;
}

interface SentEvent {
  readonly user?: object;
}

export function sentryUser(accountId: string | undefined): { readonly id: string } | null {
  return accountId === undefined ? null : { id: accountId };
}

export function logNamingAccount<Log extends SentLog>(
  log: Log,
  accountId: string | undefined,
): Log {
  if (accountId === undefined) return log;
  return { ...log, attributes: { ...log.attributes, [USER_ID_ATTRIBUTE]: accountId } };
}

export function eventNamingAccount<Event extends SentEvent>(
  event: Event,
  accountId: string | undefined,
): Event {
  if (accountId === undefined) return event;
  return { ...event, user: { ...event.user, id: accountId } };
}
