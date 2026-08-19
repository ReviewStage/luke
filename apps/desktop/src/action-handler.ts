import type { UnparsedWireValue } from "@sidecar/core";
import { Cause, type Effect, Exit } from "effect";
import type { IpcMainInvokeEvent } from "electron";
import { effectRuntime } from "./effect-runtime";

interface ActionHandlerHost {
  trustedSender: (event: IpcMainInvokeEvent) => boolean;
  handle: <TResult>(
    channel: string,
    listener: (event: IpcMainInvokeEvent, ...args: UnparsedWireValue[]) => Promise<TResult>,
  ) => void;
}

interface ActionHandler<TArguments extends readonly unknown[], TResult> {
  validate: (args: readonly unknown[]) => TArguments | undefined;
  act: (...args: TArguments) => Effect.Effect<TResult, Error>;
  failure: (error: Error) => TResult;
}

export function createActionHandler(host: ActionHandlerHost) {
  return <TArguments extends readonly unknown[], TResult>(
    channel: string,
    action: ActionHandler<TArguments, TResult>,
  ): void => {
    host.handle(channel, async (event, ...args) => {
      if (!host.trustedSender(event)) throw new Error("Untrusted renderer");
      const validated = action.validate(args);
      if (!validated) return action.failure(new Error("Invalid action request"));
      const exit = await effectRuntime.runPromiseExit(action.act(...validated));
      if (Exit.isFailure(exit)) {
        const error = Cause.squash(exit.cause);
        const failure = error instanceof Error ? error : new Error(String(error));
        return action.failure(failure);
      }
      return exit.value;
    });
  };
}
