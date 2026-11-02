/**
 * local-server-guard.ts -- the refusal the local server starts behind: never beside a Vercel deployment's variables, never over a database off this machine.
 *
 * The local server mounts every route the deployment does, over the database
 * `DATABASE_URL` names and under the secrets it was handed
 * (`scripts/local-server.ts`). An environment holding any `VERCEL*` variable
 * is a deployment's, or was pulled from one, and a database on any host but
 * this machine's loopback may be production's, so either refuses the start
 * before any route is imported. The rule is a function of the variables
 * alone, so the local-only routes that mount on the server can hold their
 * own path to it too.
 */

import { isIPv4 } from "node:net";

/** The prefix every variable Vercel sets on a deployment, a build, or a pulled environment carries. */
const VERCEL_PREFIX = "VERCEL";

/** The variables a database is reached through (`@luke/service/db`): the pooled URL, which must be set, and the unpooled one, where it is. */
const DATABASE_VARIABLE = {
  URL: "DATABASE_URL",
  UNPOOLED_URL: "DATABASE_URL_UNPOOLED",
} as const;

/** The loopback names a database host may go by; any IPv4 address in `127.0.0.0/8` besides. */
const LOOPBACK_NAMES = new Set(["localhost", "::1", "[::1]"]);

const LOOPBACK_IPV4_NETWORK = "127";

function loopbackHost(host: string): boolean {
  const named = host.toLowerCase();
  return (
    LOOPBACK_NAMES.has(named) || (isIPv4(named) && named.split(".")[0] === LOOPBACK_IPV4_NETWORK)
  );
}

/**
 * Every host a connection string names: the address's own and each `host`
 * query, since `pg`'s parser takes the last `host` query in the address's
 * place. Undefined where the string is no URL, since what it reaches cannot
 * be read here.
 */
function databaseHosts(connectionString: string): readonly string[] | undefined {
  try {
    const url = new URL(connectionString);
    return [decodeURIComponent(url.hostname), ...url.searchParams.getAll("host")].filter(
      (host) => host !== "",
    );
  } catch {
    return undefined;
  }
}

/** Whether a connection string names a host and every host it names is this machine's loopback. */
function onLoopback(connectionString: string): boolean {
  const hosts = databaseHosts(connectionString);
  return hosts !== undefined && hosts.length > 0 && hosts.every(loopbackHost);
}

/**
 * Why the local server must not start over the variables given, or undefined
 * where it may: no `VERCEL*` variable is set, `DATABASE_URL` is, and every
 * database variable set names a host on this machine's loopback. A blank
 * database variable is an absent one, as the database layer reads it. The
 * reason names variables and never a value, since a connection string
 * carries its password.
 */
export function localServerRefusal(
  variables: Readonly<Record<string, string | undefined>>,
): string | undefined {
  const vercel = Object.keys(variables)
    .filter((name) => name.startsWith(VERCEL_PREFIX) && variables[name] !== undefined)
    .sort();
  if (vercel.length > 0) {
    return `${vercel.join(", ")} set: the local server never runs beside a Vercel deployment's variables`;
  }
  const url = variables[DATABASE_VARIABLE.URL]?.trim();
  if (url === undefined || url === "") {
    return `${DATABASE_VARIABLE.URL} is not set: the local server serves a database on this machine`;
  }
  const unpooled = variables[DATABASE_VARIABLE.UNPOOLED_URL]?.trim();
  const remote = [
    { name: DATABASE_VARIABLE.URL, value: url },
    { name: DATABASE_VARIABLE.UNPOOLED_URL, value: unpooled },
  ].filter(({ value }) => value !== undefined && value !== "" && !onLoopback(value));
  return remote.length === 0
    ? undefined
    : `${remote.map(({ name }) => name).join(", ")} names a host off this machine's loopback: the local server serves a database on this machine`;
}
