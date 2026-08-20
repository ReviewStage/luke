import type { UnparsedWireValue, WireValue } from "@sidecar/wire";
import type { IpcMainInvokeEvent } from "electron";

interface ActionHandlerHost {
  trustedSender: (event: IpcMainInvokeEvent) => boolean;
  // The listener answers with a wire value rather than a result of its own,
  // because the answer crosses the bridge: anything an action returns has to
  // survive being structured-cloned to the renderer.
  handle: (
    channel: string,
    listener: (event: IpcMainInvokeEvent, ...args: UnparsedWireValue[]) => Promise<WireValue>,
  ) => void;
}

interface ActionHandler<TArguments extends readonly unknown[], TResult> {
  validate: (args: readonly unknown[]) => TArguments | undefined;
  act: (...args: TArguments) => Promise<TResult>;
  failure: (error: Error) => TResult;
}

export function createActionHandler(host: ActionHandlerHost) {
  return <TArguments extends readonly unknown[], TResult extends WireValue>(
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
        const failure = error instanceof Error ? error : new Error(String(error));
        return action.failure(failure);
      }
    });
  };
}
