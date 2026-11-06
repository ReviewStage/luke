import { CLI_EXIT } from "@repo/features/cli-exit";
import {
  CLI_WORKSPACE_SOURCE,
  CLI_WORKSPACE_UNSETTLED,
  resolveCliWorkspace,
} from "@repo/features/cli-workspace";
import { Effect, Option } from "effect";
import { configuredWorkspace } from "./config-store.js";
import { WORKSPACE_FLAG } from "./flags.js";
import { CommandFailed } from "./output.js";
import { askService, session } from "./session.js";

const WORKSPACE_VARIABLE = "VESPIN_WORKSPACE";

const SOURCE_WORDS = {
  [CLI_WORKSPACE_SOURCE.FLAG]: "-w",
  [CLI_WORKSPACE_SOURCE.ENVIRONMENT]: WORKSPACE_VARIABLE,
  [CLI_WORKSPACE_SOURCE.CONFIG]: "the default workspace",
  [CLI_WORKSPACE_SOURCE.ONLY]: "your only workspace",
} as const;

export const resolveWorkspace = Effect.gen(function* () {
  const { origin, hosted } = yield* session;
  const flag = Option.getOrUndefined(yield* WORKSPACE_FLAG);
  const variable = process.env[WORKSPACE_VARIABLE];
  const config = yield* Effect.mapError(
    configuredWorkspace(origin),
    (failed) => new CommandFailed({ exit: CLI_EXIT.REFUSED, message: failed.message }),
  );
  const { workspaces } = yield* askService(hosted.workspaces.list, undefined);
  const resolved = resolveCliWorkspace(
    { flag, environment: variable === "" ? undefined : variable, config },
    workspaces,
  );
  if ("workspace" in resolved) return resolved;
  const listed = workspaces.map(({ id, slug, name }) => `  ${slug ?? id}  ${name}`);
  const why =
    resolved.unsettled === CLI_WORKSPACE_UNSETTLED.UNKNOWN && resolved.named !== undefined
      ? `${SOURCE_WORDS[resolved.named.source]} names ${resolved.named.name}, which is none of your workspaces.`
      : "Name a workspace with -w or VESPIN_WORKSPACE.";
  return yield* new CommandFailed({
    exit: CLI_EXIT.USAGE,
    message: [why, "Your workspaces:", ...listed].join("\n"),
  });
});
