import { cliIdentity } from "@repo/credentials/cli";
import { CLI_EXIT } from "@repo/features/cli-exit";
import { cliTaskRefOf } from "@repo/features/cli-task-ref";
import { Effect } from "effect";
import { CommandFailed } from "./output.js";
import { accountBaseUrl, askService, session } from "./session.js";
import { resolveWorkspace } from "./workspace.js";

export function resolveTaskId(argument: string) {
  return Effect.gen(function* () {
    const ref = cliTaskRefOf(argument);
    if (ref === undefined) {
      return yield* new CommandFailed({
        exit: CLI_EXIT.USAGE,
        message: `${argument} names no task. Name one by its id, its number, or its key, such as ACME-42.`,
      });
    }
    if ("id" in ref) return ref.id;
    const { workspace } = yield* resolveWorkspace;
    const { hosted } = yield* session;
    const { taskId } = yield* askService(hosted.plans.find, {
      workspace: workspace.id,
      number: String(ref.number),
    });
    return taskId;
  });
}

export const signedInMemberId = Effect.gen(function* () {
  const { origin, credential } = yield* session;
  const identity = yield* Effect.mapError(
    cliIdentity(accountBaseUrl(origin), credential),
    (failed) => new CommandFailed({ exit: failed.exit, message: failed.message }),
  );
  if (identity.id !== undefined) return identity.id;
  return yield* new CommandFailed({
    exit: CLI_EXIT.UNAVAILABLE,
    message: "The service did not say which account is signed in.",
  });
});
