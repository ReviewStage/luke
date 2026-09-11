import { Config, type Option } from "effect";

/** The variable a live, unpackaged run's own shell sets to be traced at all. */
export const AGENT_TRACE_DIRECTORY_VARIABLE = "LUKE_TRACE_DIR";

/**
 * Where a trace is written, read by the variable's own name out of whatever
 * `ConfigProvider` the caller loads it under — the host's `Environment` seam
 * in the app, a map in a test. Absent means no writer at all rather than a
 * default directory: the trace exists only for an unpackaged, live run whose
 * shell named a directory. `Config.string` never fails on a present value, so
 * the read answers an `Option` and no refusal.
 */
export const agentTraceDirectory: Config.Config<Option.Option<string>> = Config.option(
  Config.string(AGENT_TRACE_DIRECTORY_VARIABLE),
);
