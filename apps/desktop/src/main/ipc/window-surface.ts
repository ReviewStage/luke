import {
  isProductSurfaceEventName,
  PRODUCT_EVENT,
  PRODUCT_PERMISSION_RESULT,
  type ProductEventPropertiesFor,
  type ProductPermissionResult,
  type ProductSurfaceEventName,
  productEventFromWire,
  type RecordProductEvent,
} from "@sidecar/analytics";
import { FEEDBACK_LIFECYCLE_EVENT, isFeedbackKind } from "@sidecar/feedback";
import type { UnparsedWireValue } from "@sidecar/wire";
import { BrowserWindow, type IpcMain, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";
import { channels, type MicrophoneRoute, type MicrophoneStatus } from "#shared/contracts";
import type { MicrophoneRouteWatcher } from "../native/microphone-route";
import type { PanelManager } from "../window/panel-manager";

/**
 * Which microphone answers a count can be built from. A total `Record` like
 * the bridges in `product-vocabulary.ts`, so a sixth status does not build
 * until someone has said whether the ask decided it — the three that map to
 * nothing are the point rather than an oversight.
 */
const MICROPHONE_STATUS_COUNTED_AS = {
  granted: PRODUCT_PERMISSION_RESULT.GRANTED,
  denied: PRODUCT_PERMISSION_RESULT.DENIED,
  "not-determined": undefined,
  restricted: undefined,
  unknown: undefined,
} satisfies Record<MicrophoneStatus, ProductPermissionResult | undefined>;

export interface WindowSurfaceIpcDependencies {
  ipcMain: Pick<IpcMain, "handle" | "on">;
  trustedSender: (event: IpcMainEvent | IpcMainInvokeEvent) => boolean;
  panels: PanelManager;
  requestMicrophone: () => Promise<MicrophoneStatus>;
  microphoneRoute: () => MicrophoneRoute | undefined;
  microphoneRouteWatcher: () => MicrophoneRouteWatcher | undefined;
  recordProductEvent: RecordProductEvent;
}

export function registerWindowSurfaceIpc(dependencies: WindowSurfaceIpcDependencies): void {
  const { ipcMain, trustedSender, panels } = dependencies;
  ipcMain.handle(
    channels.setExpanded,
    (event, expanded: UnparsedWireValue, focus: UnparsedWireValue) => {
      if (!trustedSender(event) || (expanded !== true && expanded !== false)) {
        throw new Error("Invalid window mode request");
      }
      const displayId = panels.displayIdFor(event.sender);
      if (displayId === undefined) throw new Error("Invalid window mode request");
      return panels.setMode(displayId, expanded ? "expanded" : "compact", focus === true);
    },
  );
  ipcMain.handle(channels.summonFeedback, (event, kind: UnparsedWireValue) => {
    if (!trustedSender(event) || !isFeedbackKind(kind)) {
      throw new Error("Invalid composer request");
    }
    const displayId = panels.displayIdFor(event.sender);
    if (displayId === undefined) throw new Error("Invalid composer request");
    panels.setMode(displayId, "expanded", true);
    event.sender.send(channels.lifecycle, FEEDBACK_LIFECYCLE_EVENT[kind]);
    // Which of the two composers was summoned is not counted: the pair the
    // funnel wants is opened against sent, and `feedback:send` answers the
    // other half without naming a kind either.
    dependencies.recordProductEvent(PRODUCT_EVENT.FEEDBACK_OPEN, {});
  });
  ipcMain.on(channels.setPointerInterception, (event, interceptsPointer: UnparsedWireValue) => {
    if (!trustedSender(event) || (interceptsPointer !== true && interceptsPointer !== false))
      return;
    BrowserWindow.fromWebContents(event.sender)?.setIgnoreMouseEvents(!interceptsPointer, {
      forward: true,
    });
  });
  ipcMain.handle(channels.requestMicrophone, async (event) => {
    if (!trustedSender(event)) throw new Error("Untrusted renderer");
    const status = await dependencies.requestMicrophone();
    // Only the two answers the ask itself decides. `restricted` is a machine
    // the user does not control and `unknown` is a probe that failed; counting
    // either as a refusal would read as people saying no to the microphone
    // when nobody was ever asked.
    const result = MICROPHONE_STATUS_COUNTED_AS[status];
    if (result) {
      dependencies.recordProductEvent(PRODUCT_EVENT.VOICE_PERMISSION, {
        permission_result: result,
      });
    }
    return status;
  });
  ipcMain.handle(channels.microphoneRoute, (event) => {
    if (!trustedSender(event)) throw new Error("Untrusted renderer");
    dependencies.microphoneRouteWatcher()?.probe();
    return dependencies.microphoneRoute();
  });
  /**
   * The one counting channel the renderer has, and the narrowest thing in this
   * file. Every other event is emitted where its act happens, in this process;
   * these are surface motion no main-process handler can see.
   *
   * Two gates rather than one. `isProductSurfaceEventName` is the narrowing
   * that matters: it refuses every name outside the surface set, so a renderer
   * cannot reach the acts — a forged `session:act_send` or `account:act` dies
   * here rather than becoming a count of something nobody did. Then the
   * vocabulary's own reader rebuilds the properties from that event's
   * allowlist, so what is queued is what this build declared and never what
   * arrived. A malformed send is dropped in silence, because a renderer that
   * miscounts is a bug to find in the counts rather than a reason to throw
   * into a `send` nothing is waiting on.
   */
  ipcMain.on(
    channels.recordSurfaceEvent,
    (event, name: UnparsedWireValue, properties: UnparsedWireValue) => {
      if (!trustedSender(event) || !isProductSurfaceEventName(name)) return;
      const read = productEventFromWire({ name, at: Date.now(), properties: properties ?? {} });
      if (!read) return;
      dependencies.recordProductEvent(
        name,
        // SAFETY: the reader above rebuilt these from this event's own
        // allowlist, which is exactly the shape the name declares.
        read.properties as ProductEventPropertiesFor<ProductSurfaceEventName>,
      );
    },
  );
}
