import { Config, ConfigProvider, Effect, Option } from "effect";

const TRACE_DIRECTORY_VARIABLE = "LUKE_TRACE_DIR";

/**
 * Reads `LUKE_TRACE_DIR` out of a process environment through `Config`,
 * answering `undefined` on exactly the same absence a plain property read
 * did: the trace exists only for an unpackaged, live run whose shell set the
 * variable, so an absent value means no writer at all rather than a default
 * directory. `Config.string` never fails on a present value, so the read
 * cannot throw.
 */
export function agentTraceDirectoryFromEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): string | undefined {
  const entries: [string, string][] = [];
  for (const [name, value] of Object.entries(environment)) {
    if (value !== undefined) entries.push([name, value]);
  }
  const read = Config.string(TRACE_DIRECTORY_VARIABLE).pipe(
    Config.option,
    Effect.withConfigProvider(ConfigProvider.fromMap(new Map(entries))),
  );
  return Option.getOrUndefined(Effect.runSync(read));
}
