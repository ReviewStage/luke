import { Result } from "effect";

export const DEMO_DATABASE_REFUSAL = {
  UNREADABLE: "unreadable",
  NOT_LOOPBACK: "not-loopback",
} as const;

export type DemoDatabaseRefusal =
  (typeof DEMO_DATABASE_REFUSAL)[keyof typeof DEMO_DATABASE_REFUSAL];

const POSTGRES_PROTOCOLS: ReadonlySet<string> = new Set(["postgres:", "postgresql:"]);

const LOOPBACK_NAMES: ReadonlySet<string> = new Set(["localhost", "[::1]"]);
const IPV4_LOOPBACK = /^127(\.\d{1,3}){3}$/;

function isLoopbackHost(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  return LOOPBACK_NAMES.has(host) || IPV4_LOOPBACK.test(host);
}

export function demoDatabaseUrl(address: string): Result.Result<string, DemoDatabaseRefusal> {
  const url = URL.canParse(address) ? new URL(address) : undefined;
  if (url === undefined || !POSTGRES_PROTOCOLS.has(url.protocol)) {
    return Result.fail(DEMO_DATABASE_REFUSAL.UNREADABLE);
  }
  if (!isLoopbackHost(url) || url.searchParams.has("host") || url.searchParams.has("hostaddr")) {
    return Result.fail(DEMO_DATABASE_REFUSAL.NOT_LOOPBACK);
  }
  return Result.succeed(address);
}
