import type { ActPortHandler, ActSender } from "@repo/host/act-port";
import type { AppStateSnapshot } from "@repo/host/app-state";
import {
  ACT_PORT,
  BRIDGE,
  type BridgeArgumentsFor,
  type BridgeMethod,
  type BridgeResultFor,
} from "@repo/host/bridge";
import type { Context } from "effect";
import type { IpcMain, IpcMainEvent, IpcMainInvokeEvent, WebContents } from "electron";

interface BridgeContext {
  sender: WebContents;
}

type BridgeHandler<Method extends BridgeMethod> = (
  context: BridgeContext,
  ...args: BridgeArgumentsFor<Method>
) => BridgeResultFor<Method> | Promise<BridgeResultFor<Method>>;

type ReportMethod = Exclude<BridgeMethod, "requestAppState">;

export type ReportHandlers = { readonly [Method in ReportMethod]: BridgeHandler<Method> };

export interface BridgeHostDependencies {
  ipcMain: Pick<IpcMain, "handle" | "on">;
  trustedSender: (event: IpcMainEvent | IpcMainInvokeEvent) => boolean;
  senderOf: (sender: WebContents) => ActSender<WebContents>;
  actPort: ActPortHandler<WebContents>;
  services: Context.Context<never>;
  reports: ReportHandlers;
  snapshotFor: (sender: WebContents) => Promise<AppStateSnapshot>;
}

type ErasedHandler = (context: BridgeContext, ...args: never[]) => unknown;

export function registerBridgeHost(dependencies: BridgeHostDependencies): void {
  const { ipcMain, trustedSender, senderOf, actPort, services, reports, snapshotFor } =
    dependencies;

  ipcMain.on(ACT_PORT.CHANNEL, (event) => {
    const [port] = event.ports;
    if (port === undefined || event.senderFrame?.parent !== null) return;
    actPort.upgrade(port, {
      context: () => ({
        actor: senderOf(event.sender),
        trusted: trustedSender(event),
        "effect/context": services,
      }),
    });
    port.start();
  });

  ipcMain.handle(BRIDGE.requestAppState.channel, async (event) => {
    if (!trustedSender(event)) throw new Error("Invalid bridge request");
    return snapshotFor(event.sender);
  });

  for (const method of Object.keys(reports) as ReportMethod[]) {
    const definition = BRIDGE[method];
    const handler = reports[method] as ErasedHandler;
    ipcMain.on(definition.channel, (event, ...rawArgs) => {
      if (!trustedSender(event) || !definition.args(rawArgs)) return;
      void handler({ sender: event.sender }, ...(rawArgs as never[]));
    });
  }
}
