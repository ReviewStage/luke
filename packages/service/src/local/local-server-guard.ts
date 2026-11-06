import { isIPv4 } from "node:net";

const VERCEL_PREFIX = "VERCEL";

const DATABASE_VARIABLE = {
  URL: "DATABASE_URL",
  UNPOOLED_URL: "DATABASE_URL_UNPOOLED",
} as const;

const LOOPBACK_NAMES = new Set(["localhost", "::1", "[::1]"]);

const LOOPBACK_IPV4_NETWORK = "127";

interface GuardedVariables {
  readonly vercel: readonly string[];
  readonly url: string | undefined;
  readonly unpooled: string | undefined;
}

function loopbackHost(host: string): boolean {
  const named = host.toLowerCase();
  return (
    LOOPBACK_NAMES.has(named) || (isIPv4(named) && named.split(".")[0] === LOOPBACK_IPV4_NETWORK)
  );
}

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

function onLoopback(connectionString: string): boolean {
  const hosts = databaseHosts(connectionString);
  return hosts !== undefined && hosts.length > 0 && hosts.every(loopbackHost);
}

function refusalOf({ vercel, url, unpooled }: GuardedVariables): string | undefined {
  if (vercel.length > 0) {
    return `${[...vercel].sort().join(", ")} set: the local server never runs beside a Vercel deployment's variables`;
  }
  const pooled = url?.trim();
  if (pooled === undefined || pooled === "") {
    return `${DATABASE_VARIABLE.URL} is not set: the local server serves a database on this machine`;
  }
  const remote = [
    { name: DATABASE_VARIABLE.URL, value: pooled },
    { name: DATABASE_VARIABLE.UNPOOLED_URL, value: unpooled?.trim() },
  ].filter(({ value }) => value !== undefined && value !== "" && !onLoopback(value));
  return remote.length === 0
    ? undefined
    : `${remote.map(({ name }) => name).join(", ")} names a host off this machine's loopback: the local server serves a database on this machine`;
}

export function localServerRefusal(
  variables: Readonly<Record<string, string | undefined>>,
): string | undefined {
  return refusalOf({
    vercel: Object.keys(variables).filter(
      (name) => name.startsWith(VERCEL_PREFIX) && variables[name] !== undefined,
    ),
    url: variables[DATABASE_VARIABLE.URL],
    unpooled: variables[DATABASE_VARIABLE.UNPOOLED_URL],
  });
}
