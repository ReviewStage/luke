import type { UnparsedWireValue } from "@sidecar/core";
import { Cause, type Effect, Exit } from "effect";
import type { IpcMainInvokeEvent } from "electron";
import { type DesktopEffect, effectRuntime } from "./desktop-app";

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

export function createActionHandler(host: ActionHandlerHost) {
  return <TArguments extends readonly unknown[], TResult>(
    channel: string,
    action: ActionHandler<TArguments, TResult>,
  ): void => {
    host.handle(channel, (event, ...args) => {
      if (!host.trustedSender(event)) throw new Error("Untrusted renderer");
      const validated = action.validate(args);
      if (!validated) return Promise.resolve(action.failure(new Error("Invalid action request")));
      // SAFETY: action.act satisfies DesktopServices at the IPC composition root.
      return effectRuntime
        .runPromiseExit(action.act(...validated) as DesktopEffect<TResult, Error>)
        .then((exit) => {
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
  channel: string,
  handler: (
    event: IpcMainInvokeEvent,
    ...args: UnparsedWireValue[]
  ) => Effect.Effect<A, E, unknown>,
): void {
  host.handle(channel, (event, ...args) => {
    if (!host.trustedSender(event)) throw new Error("Untrusted renderer");
    // SAFETY: The IPC handler satisfies DesktopServices at the composition root.
    return effectRuntime.runPromise(handler(event, ...args) as DesktopEffect<A, E>);
  });
}
