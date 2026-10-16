import {
  PRODUCT_EVENT,
  PRODUCT_PERMISSION_RESULT,
  type ProductEventPropertiesFor,
  type ProductPermissionResult,
  type ProductSurfaceEventName,
  productEventFromWire,
  type RecordProductEvent,
} from "@luke/features/analytics";
import { ACT, ACT_KIND } from "@luke/host/acts";
import { MICROPHONE_STATUS, type MicrophoneRoute, type MicrophoneStatus } from "@luke/voice/audio";
import { ActRefused, type ActRows, type ActSender } from "../act-router";
import type { ReportHandlers } from "../bridge-host";
import type { MicrophoneRouteWatch } from "../native/microphone-route";
import type { PanelManager } from "../window/panel-manager";

/**
 * Which microphone answers a count can be built from. A total `Record` like
 * the bridges in `@luke/settings`, so a sixth status does not build until
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

/**
 * Where Contact us > Email writes to: the address the site's footer, the
 * privacy policy, and the security policy all name. Held here rather than
 * sent by the panel, so the act can open no other address.
 */
const CONTACT_MAILTO = "mailto:founders@stagereview.app";

interface WindowSurfaceDependencies {
  panels: PanelManager;
  requestMicrophone: () => Promise<MicrophoneStatus>;
  microphoneRoute: () => MicrophoneRoute | undefined;
  microphoneRouteWatcher: () => MicrophoneRouteWatch | undefined;
  recordProductEvent: RecordProductEvent;
  openExternal: (url: string) => Promise<void>;
  /** Posts Settings' test notification now. */
  testNotification: () => void;
  /** Asks where to save a file in the system's save dialog over the asking window and writes it there, answering whether it was saved. */
  saveFile: (sender: ActSender["sender"], name: string, text: string) => Promise<boolean>;
}

type WindowSurfaceActKind =
  | typeof ACT_KIND.WINDOW_FOCUS_PANEL
  | typeof ACT_KIND.MICROPHONE_REQUEST
  | typeof ACT_KIND.MICROPHONE_ROUTE
  | typeof ACT_KIND.NOTIFICATIONS_OPEN_SETTINGS
  | typeof ACT_KIND.NOTIFICATIONS_TEST
  | typeof ACT_KIND.CONTACT_EMAIL
  | typeof ACT_KIND.WINDOW_SAVE_FILE;

/**
 * What the panel asks of the window it is drawn in. The focus is a panel's
 * own act and refused from anywhere else: it is about the display one panel
 * stands on, and no other surface has one. A save is a panel's too, since
 * only a panel draws a File tab, and its dialog hangs over the panel that
 * asked.
 */
export function windowSurfaceActRows(
  dependencies: WindowSurfaceDependencies,
): Pick<ActRows, WindowSurfaceActKind> {
  const { panels } = dependencies;
  /**
   * The display the asking panel stands on: a window that is not a panel, and
   * a panel on no display, are the same refusal.
   */
  const panelDisplay = (sender: ActSender, kind: typeof ACT_KIND.WINDOW_FOCUS_PANEL): number => {
    const displayId = sender.panel ? panels.displayIdFor(sender.sender) : undefined;
    if (displayId === undefined) throw new ActRefused({ message: ACT[kind].refusal });
    return displayId;
  };
  return {
    [ACT_KIND.WINDOW_FOCUS_PANEL]: (_payload, sender) => {
      panels.focusIfExpanded(panelDisplay(sender, ACT_KIND.WINDOW_FOCUS_PANEL));
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
    // The pane that lists every app's notifications, Luke's among them.
    [ACT_KIND.NOTIFICATIONS_OPEN_SETTINGS]: () =>
      dependencies.openExternal(
        "x-apple.systempreferences:com.apple.Notifications-Settings.extension",
      ),
    [ACT_KIND.NOTIFICATIONS_TEST]: () => dependencies.testNotification(),
    [ACT_KIND.CONTACT_EMAIL]: () => dependencies.openExternal(CONTACT_MAILTO),
    [ACT_KIND.WINDOW_SAVE_FILE]: ({ name, text }, sender) => {
      if (!sender.panel) throw new ActRefused({ message: ACT[ACT_KIND.WINDOW_SAVE_FILE].refusal });
      return dependencies.saveFile(sender.sender, name, text);
    },
  };
}

export function windowSurfaceReports(
  dependencies: Pick<WindowSurfaceDependencies, "recordProductEvent">,
): Pick<ReportHandlers, "recordSurfaceEvent"> {
  return {
    /**
     * The one counting channel the renderer has. Every other event is emitted
     * where its act happens, in this process; these are surface motion no
     * main-process handler can see.
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
