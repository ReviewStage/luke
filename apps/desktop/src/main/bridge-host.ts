import type { UnparsedWireValue } from "@sidecar/wire";
import type { IpcMain, IpcMainEvent, IpcMainInvokeEvent, WebContents } from "electron";
import {
  BRIDGE,
  type Bridge,
  type BridgeArgumentsFor,
  type BridgeMethod,
  type BridgeResultFor,
} from "#shared/bridge";
import { type Act, parsedAct } from "#shared/messages/acts";
import type { AppStateSnapshot } from "#shared/messages/app-state";
import type { ActRouter, ActSender } from "./act-router";

/** Which window a report came from, which is all a report's handler is told. */
export interface BridgeContext {
  sender: WebContents;
}

type BridgeHandler<Method extends BridgeMethod> = (
  context: BridgeContext,
  ...args: BridgeArgumentsFor<Method>
) => BridgeResultFor<Method> | Promise<BridgeResultFor<Method>>;

type SubscribeMethod = {
  [Method in BridgeMethod]: Bridge[Method]["kind"] extends "subscribe" ? Method : never;
}[BridgeMethod];

/**
 * Every entry a window sends and the router does not answer: what one window
 * reports about itself. Derived rather than listed, so an entry added to the
 * bridge is an entry this registrar demands a handler for, and the only way
 * to add an effect without one is to add an act.
 */
export type ReportMethod = Exclude<BridgeMethod, SubscribeMethod | "act" | "requestAppState">;

export type ReportHandlers = { readonly [Method in ReportMethod]: BridgeHandler<Method> };

export interface BridgeHostDependencies {
  ipcMain: Pick<IpcMain, "handle" | "on">;
  /** Only this build's own renderer may reach any channel here. */
  trustedSender: (event: IpcMainEvent | IpcMainInvokeEvent) => boolean;
  /** Which of the three surfaces asked, decided by the windows this process opened. */
  senderOf: (sender: WebContents) => ActSender;
  router: ActRouter;
  reports: ReportHandlers;
  /** The document as one window stands, which is the answer to its own bootstrap read. */
  snapshotFor: (sender: WebContents) => Promise<AppStateSnapshot>;
}

// oxlint-disable-next-line anti-slop/no-unknown-returns -- This is the erased callable shape at Electron's IPC boundary.
type ErasedHandler = (context: BridgeContext, ...args: never[]) => unknown;

/**
 * Every channel the sandboxed renderers reach this process through, attached
 * once and in one place. There are three kinds and no fourth: the one act
 * channel, whose router decides everything; the one state read; and the
 * reports, each a window saying something only it knows. A window that loaded
 * before this ran would meet an unhandled invoke, so it runs between the
 * composition and its start.
 */
export function registerBridgeHost(dependencies: BridgeHostDependencies): void {
  const { ipcMain, trustedSender, senderOf, router, reports, snapshotFor } = dependencies;

  ipcMain.handle(BRIDGE.act.channel, async (event, ...rawArgs) => {
    // `parsedAct` is this entry's own argument guard, so it is read here for
    // the act rather than called twice for its verdict and then its value.
    // SAFETY: an IPC payload is structured-clone data, which is what parsedAct parses.
    const act: Act | undefined =
      rawArgs.length === 1 ? parsedAct(rawArgs[0] as UnparsedWireValue) : undefined;
    if (!trustedSender(event) || !act) throw new Error("Invalid bridge request");
    return router.performAct(act, senderOf(event.sender));
  });

  ipcMain.handle(BRIDGE.requestAppState.channel, async (event) => {
    if (!trustedSender(event)) throw new Error("Invalid bridge request");
    return snapshotFor(event.sender);
  });

  // SAFETY: `reports` is keyed by ReportMethod; Object.keys erases those literal keys.
  for (const method of Object.keys(reports) as ReportMethod[]) {
    const definition = BRIDGE[method];
    // SAFETY: definition.args validates the erased IPC arguments before this typed handler runs.
    const handler = reports[method] as ErasedHandler;
    if (definition.kind === "invoke") {
      ipcMain.handle(definition.channel, async (event, ...rawArgs) => {
        if (!trustedSender(event) || !definition.args(rawArgs)) {
          throw new Error("Invalid bridge request");
        }
        // SAFETY: the guard above admitted these arguments for this method.
        const value = await handler({ sender: event.sender }, ...(rawArgs as never[]));
        if (definition.result?.(value) === false) throw new Error("Invalid bridge response");
        return value;
      });
      continue;
    }
    ipcMain.on(definition.channel, (event, ...rawArgs) => {
      if (!trustedSender(event) || !definition.args(rawArgs)) return;
      // SAFETY: the guard above admitted these arguments for this method.
      void handler({ sender: event.sender }, ...(rawArgs as never[]));
    });
  }
}
