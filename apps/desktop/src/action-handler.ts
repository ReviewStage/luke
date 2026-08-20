import type { UnparsedWireValue } from "@sidecar/core";
import { Cause, type Effect, Exit } from "effect";
import type { IpcMainInvokeEvent } from "electron";

export interface ActionEffectRuntime {
  runPromiseExit<A, E>(effect: Effect.Effect<A, E, unknown>): Promise<Exit.Exit<A, E>>;
  runPromise<A, E>(effect: Effect.Effect<A, E, unknown>): Promise<A>;
}

interface ActionHandlerHost {
  trustedSender: (event: IpcMainInvokeEvent) => boolean;
  handle: <TResult>(
    channel: string,
    listener: (event: IpcMainInvokeEvent, ...args: UnparsedWireValue[]) => Promise<TResult>,
  ) => void;
}

interface ActionHandler<TArguments extends readonly unknown[], TResult> {
  validate: (args: readonly unknown[]) => TArguments | undefined;
  act: (...args: TArguments) => Effect.Effect<TResult, Error, unknown>;
  failure: (error: Error) => TResult;
}

export function createActionHandler(host: ActionHandlerHost, runtime: ActionEffectRuntime) {
  return <TArguments extends readonly unknown[], TResult>(
    channel: string,
    action: ActionHandler<TArguments, TResult>,
  ): void => {
    host.handle(channel, (event, ...args) => {
      if (!host.trustedSender(event)) throw new Error("Untrusted renderer");
      const validated = action.validate(args);
      if (!validated) return Promise.resolve(action.failure(new Error("Invalid action request")));
      return runtime.runPromiseExit(action.act(...validated)).then((exit) => {
        if (Exit.isFailure(exit)) {
          const error = Cause.squash(exit.cause);
          const failure = error instanceof Error ? error : new Error(String(error));
          return action.failure(failure);
        }
        return exit.value;
      });
    });
  };
}

/** Runs a validated Effect at the IPC edge; non-edge modules return the Effect only. */
export function registerEffectInvoke<A, E>(
  host: ActionHandlerHost,
  runtime: ActionEffectRuntime,
  channel: string,
  handler: (
    event: IpcMainInvokeEvent,
    ...args: UnparsedWireValue[]
  ) => Effect.Effect<A, E, unknown>,
): void {
  host.handle(channel, (event, ...args) => {
    if (!host.trustedSender(event)) throw new Error("Untrusted renderer");
    return runtime.runPromise(handler(event, ...args));
  });
}
