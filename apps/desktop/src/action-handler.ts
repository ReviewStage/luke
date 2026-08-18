import type { IpcMainInvokeEvent } from "electron";

interface ActionHandlerHost {
  trustedSender: (event: IpcMainInvokeEvent) => boolean;
  handle: (
    channel: string,
    listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>,
  ) => void;
}

interface ActionHandler<TArguments extends readonly unknown[], TResult> {
  validate: (args: readonly unknown[]) => TArguments | undefined;
  act: (...args: TArguments) => Promise<TResult>;
  failure: (error: unknown) => TResult;
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
      try {
        return await action.act(...validated);
      } catch (error) {
        return action.failure(error);
      }
    });
  };
}
