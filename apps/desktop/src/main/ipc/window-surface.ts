import {
  PRODUCT_EVENT,
  PRODUCT_PERMISSION_RESULT,
  type ProductEventPropertiesFor,
  type ProductPermissionResult,
  type ProductSurfaceEventName,
  productEventFromWire,
  type RecordProductEvent,
} from "@sidecar/analytics";
import { FEEDBACK_LIFECYCLE_EVENT } from "@sidecar/feedback";
import { BrowserWindow, type WebContents } from "electron";
import { channels } from "#shared/bridge";
import { ACT_KIND, ACT_REFUSAL } from "#shared/messages/acts";
import {
  MICROPHONE_STATUS,
  type MicrophoneRoute,
  type MicrophoneStatus,
} from "#shared/messages/audio";
import { ActRefused, type ActRows } from "../act-router";
import type { ReportHandlers } from "../bridge-host";
import type { MicrophoneRouteWatch } from "../native/microphone-route";
import type { PanelManager } from "../window/panel-manager";

/**
 * Which microphone answers a count can be built from. A total `Record` like
 * the bridges in `@sidecar/settings`, so a sixth status does not build until
 * someone has said whether the ask decided it — the three that map to nothing
 * are the point rather than an oversight.
 */
const MICROPHONE_STATUS_COUNTED_AS = {
  [MICROPHONE_STATUS.GRANTED]: PRODUCT_PERMISSION_RESULT.GRANTED,
  [MICROPHONE_STATUS.DENIED]: PRODUCT_PERMISSION_RESULT.DENIED,
  [MICROPHONE_STATUS.NOT_DETERMINED]: undefined,
  [MICROPHONE_STATUS.RESTRICTED]: undefined,
  [MICROPHONE_STATUS.UNKNOWN]: undefined,
} satisfies Record<MicrophoneStatus, ProductPermissionResult | undefined>;

export interface WindowSurfaceDependencies {
  panels: PanelManager;
  requestMicrophone: () => Promise<MicrophoneStatus>;
  microphoneRoute: () => MicrophoneRoute | undefined;
  microphoneRouteWatcher: () => MicrophoneRouteWatch | undefined;
  recordProductEvent: RecordProductEvent;
}

type WindowSurfaceActKind =
  | typeof ACT_KIND.WINDOW_SET_EXPANDED
  | typeof ACT_KIND.WINDOW_FOCUS_PANEL
  | typeof ACT_KIND.FEEDBACK_SUMMON
  | typeof ACT_KIND.MICROPHONE_REQUEST
  | typeof ACT_KIND.MICROPHONE_ROUTE;

/**
 * What the panel asks of the window it is drawn in. Each of the first three is
 * a panel's own act and refused from anywhere else: the mode, the focus, and
 * the composer are all about the display one panel stands on, and no other
 * surface has one.
 */
export function windowSurfaceActRows(
  dependencies: WindowSurfaceDependencies,
): Pick<ActRows, WindowSurfaceActKind> {
  const { panels } = dependencies;
  /** The display the asking panel stands on, or a refusal: a window with none is not a panel. */
  const displayOf = (sender: WebContents, refusal: string): number => {
    const displayId = panels.displayIdFor(sender);
    if (displayId === undefined) throw new ActRefused(refusal);
    return displayId;
  };
  return {
    [ACT_KIND.WINDOW_SET_EXPANDED]: ({ expanded, focus }, { sender, panel }) => {
      if (!panel) throw new ActRefused(ACT_REFUSAL[ACT_KIND.WINDOW_SET_EXPANDED]);
      const refusal = ACT_REFUSAL[ACT_KIND.WINDOW_SET_EXPANDED];
      return panels.setMode(
        displayOf(sender, refusal),
        expanded ? "expanded" : "compact",
        focus === true,
      );
    },
    [ACT_KIND.WINDOW_FOCUS_PANEL]: (_payload, { sender, panel }) => {
      if (!panel) throw new ActRefused(ACT_REFUSAL[ACT_KIND.WINDOW_FOCUS_PANEL]);
      const displayId = panels.displayIdFor(sender);
      if (displayId !== undefined) panels.focusIfExpanded(displayId);
    },
    [ACT_KIND.FEEDBACK_SUMMON]: ({ kind }, { sender, panel }) => {
      if (!panel) throw new ActRefused(ACT_REFUSAL[ACT_KIND.FEEDBACK_SUMMON]);
      panels.setMode(displayOf(sender, ACT_REFUSAL[ACT_KIND.FEEDBACK_SUMMON]), "expanded", true);
      sender.send(channels.onLifecycle, FEEDBACK_LIFECYCLE_EVENT[kind]);
      dependencies.recordProductEvent(PRODUCT_EVENT.FEEDBACK_OPEN, {});
    },
    [ACT_KIND.MICROPHONE_REQUEST]: async () => {
      const status = await dependencies.requestMicrophone();
      const counted = MICROPHONE_STATUS_COUNTED_AS[status];
      if (counted) {
        dependencies.recordProductEvent(PRODUCT_EVENT.VOICE_PERMISSION, {
          permission_result: counted,
        });
      }
      return status;
    },
    // Probed rather than read from the document: the route decides which
    // device the press about to happen opens, and macOS moves the default
    // between presses.
    [ACT_KIND.MICROPHONE_ROUTE]: () => {
      dependencies.microphoneRouteWatcher()?.probe();
      return dependencies.microphoneRoute();
    },
  };
}

/**
 * What one window reports about its own surface. The pointer interception is
 * the window's own hit-testing, and the counting channel below is the one
 * thing the renderer counts for itself.
 */
export function windowSurfaceReports(
  dependencies: Pick<WindowSurfaceDependencies, "recordProductEvent">,
): Pick<ReportHandlers, "setPointerInterception" | "recordSurfaceEvent"> {
  return {
    setPointerInterception(context, interceptsPointer) {
      BrowserWindow.fromWebContents(context.sender)?.setIgnoreMouseEvents(!interceptsPointer, {
        forward: true,
      });
    },
    /**
     * The one counting channel the renderer has, and the narrowest thing in
     * this file. Every other event is emitted where its act happens, in this
     * process; these are surface motion no main-process handler can see.
     *
     * Two gates rather than one. `isProductSurfaceEventName` is the narrowing
     * that matters: it refuses every name outside the surface set, so a
     * renderer cannot reach the acts — a forged `session:act_send` or
     * `account:act` dies at the bridge guard rather than becoming a count of
     * something nobody did. Then the vocabulary's own reader rebuilds the
     * properties from that event's allowlist, so what is queued is what this
     * build declared and never what arrived. A malformed send is dropped in
     * silence, because a renderer that miscounts is a bug to find in the
     * counts rather than a reason to throw into a `send` nothing is waiting on.
     */
    recordSurfaceEvent(_context, name, properties) {
      const read = productEventFromWire({ name, at: Date.now(), properties: properties ?? {} });
      if (!read) return;
      dependencies.recordProductEvent(
        name,
        // SAFETY: the reader above rebuilt these from this event's own
        // allowlist, which is exactly the shape the name declares.
        read.properties as ProductEventPropertiesFor<ProductSurfaceEventName>,
      );
    },
  };
}
