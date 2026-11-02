import { Result } from "effect";

/**
 * demo-database.ts -- the one database the demo seed writes to: a Postgres on this machine's loopback, and nothing else.
 *
 * The seed writes a made-up workspace with fixed ids and a member's model
 * credential, so it must never reach a deployment's database. Note that it
 * is held to the host the address names rather than to an environment
 * variable, because a variable that leaked into the wrong shell would carry
 * the seed with it, and a production database is never on loopback. A
 * socket path, an empty host, or a name that only resolves to loopback is
 * refused too: the check reads the address alone, so it never has to trust
 * a resolver.
 */

/** Why a database address was refused. */
export const DEMO_DATABASE_REFUSAL = {
  /** The address is no `postgres:` or `postgresql:` URL. */
  UNREADABLE: "unreadable",
  /** The address names a host other than this machine's loopback. */
  NOT_LOOPBACK: "not-loopback",
} as const;

export type DemoDatabaseRefusal =
  (typeof DEMO_DATABASE_REFUSAL)[keyof typeof DEMO_DATABASE_REFUSAL];

const POSTGRES_PROTOCOLS: ReadonlySet<string> = new Set(["postgres:", "postgresql:"]);

/** The hosts a URL's parser leaves for this machine's loopback: the name, IPv6's, and IPv4's whole 127/8. */
const LOOPBACK_NAMES: ReadonlySet<string> = new Set(["localhost", "[::1]"]);
const IPV4_LOOPBACK = /^127(\.\d{1,3}){3}$/;

/** Whether a parsed URL's host is this machine's loopback, by its spelling alone. */
function isLoopbackHost(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  return LOOPBACK_NAMES.has(host) || IPV4_LOOPBACK.test(host);
}

/** The address, where it is a Postgres on loopback; refused, with why, where it is anything else. */
export function demoDatabaseUrl(address: string): Result.Result<string, DemoDatabaseRefusal> {
  const url = URL.canParse(address) ? new URL(address) : undefined;
  if (url === undefined || !POSTGRES_PROTOCOLS.has(url.protocol)) {
    return Result.fail(DEMO_DATABASE_REFUSAL.UNREADABLE);
  }
  // Note that a `host` query parameter overrides the URL's host in libpq and node-postgres, so one that names a socket or another host is refused with the rest.
  if (!isLoopbackHost(url) || url.searchParams.has("host") || url.searchParams.has("hostaddr")) {
    return Result.fail(DEMO_DATABASE_REFUSAL.NOT_LOOPBACK);
  }
  return Result.succeed(address);
}
