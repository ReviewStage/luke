import {
  PRODUCT_EVENT,
  PRODUCT_PERMISSION_RESULT,
  type ProductEventPropertiesFor,
  type ProductPermissionResult,
  type ProductSurfaceEventName,
  productEventFromWire,
  type RecordProductEvent,
} from "@luke/features/analytics";
import type { FeedbackResult, FeedbackSubmission } from "@luke/features/feedback";
import { actPortFor, type PlatformActProcedures } from "@luke/host/act-port";
import { WINDOW_SURFACE_ACT_KIND } from "@luke/host/contract";
import { MICROPHONE_STATUS, type MicrophoneRoute, type MicrophoneStatus } from "@luke/voice/audio";
import { Effect } from "effect";
import type { WebContents } from "electron";
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
  panels: Pick<PanelManager, "displayIdFor" | "focusIfExpanded">;
  requestMicrophone: () => Promise<MicrophoneStatus>;
  microphoneRoute: () => MicrophoneRoute | undefined;
  microphoneRouteWatcher: () => MicrophoneRouteWatch | undefined;
  recordProductEvent: RecordProductEvent;
  openExternal: (url: string) => Promise<void>;
  /** Posts Settings' test notification now. */
  testNotification: () => void;
  /** Writes words to the system's clipboard. */
  copyText: (words: string) => void;
  /** Asks where to save a file in the system's save dialog over the asking window and writes it there, answering whether it was saved. */
  saveFile: (sender: WebContents, name: string, text: string) => Promise<boolean>;
  /** Carries a note to the people who make Luke, answering whether it arrived. */
  deliverFeedback: (submission: FeedbackSubmission) => Effect.Effect<FeedbackResult>;
}

type WindowSurfaceActKind = (typeof WINDOW_SURFACE_ACT_KIND)[keyof typeof WINDOW_SURFACE_ACT_KIND];

const surfacePort = actPortFor<WebContents>();

/**
 * What a window asks of the system it is drawn on. The focus is a panel's
 * own act and refused from anywhere else: it is about the display one panel
 * stands on, and no other surface has one. A save is a panel's too, since
 * only a panel draws a File tab, and its dialog hangs over the panel that
 * asked. The rest read no window, as none did on `app:act`.
 */
export function windowSurfaceProcedures(
  dependencies: WindowSurfaceDependencies,
): Pick<PlatformActProcedures<WebContents>, WindowSurfaceActKind> {
  const { panels } = dependencies;
  return {
    // A window that is not a panel, and a panel on no display, are the same refusal.
    [WINDOW_SURFACE_ACT_KIND.WINDOW_FOCUS_PANEL]: surfacePort[
      WINDOW_SURFACE_ACT_KIND.WINDOW_FOCUS_PANEL
    ].effect(function* ({ context, errors }) {
      const { actor } = context;
      const displayId = actor.panel ? panels.displayIdFor(actor.sender) : undefined;
      if (displayId === undefined) return yield* Effect.fail(errors.REFUSED());
      panels.focusIfExpanded(displayId);
    }),
    [WINDOW_SURFACE_ACT_KIND.MICROPHONE_REQUEST]: surfacePort[
      WINDOW_SURFACE_ACT_KIND.MICROPHONE_REQUEST
    ].handler(async () => {
      const status = await dependencies.requestMicrophone();
      const counted = MICROPHONE_STATUS_COUNTED_AS[status];
      if (counted) {
        dependencies.recordProductEvent(PRODUCT_EVENT.VOICE_PERMISSION, {
          permission_result: counted,
        });
      }
      return status;
    }),
    // Probed rather than read from the document: the route decides which
    // device the press about to happen opens, and macOS moves the default
    // between presses.
    [WINDOW_SURFACE_ACT_KIND.MICROPHONE_ROUTE]: surfacePort[
      WINDOW_SURFACE_ACT_KIND.MICROPHONE_ROUTE
    ].handler(() => {
      dependencies.microphoneRouteWatcher()?.probe();
      return dependencies.microphoneRoute();
    }),
    // The pane that lists every app's notifications, Luke's among them.
    [WINDOW_SURFACE_ACT_KIND.NOTIFICATIONS_OPEN_SETTINGS]: surfacePort[
      WINDOW_SURFACE_ACT_KIND.NOTIFICATIONS_OPEN_SETTINGS
    ].handler(() =>
      dependencies.openExternal(
        "x-apple.systempreferences:com.apple.Notifications-Settings.extension",
      ),
    ),
    [WINDOW_SURFACE_ACT_KIND.NOTIFICATIONS_TEST]: surfacePort[
      WINDOW_SURFACE_ACT_KIND.NOTIFICATIONS_TEST
    ].handler(() => dependencies.testNotification()),
    [WINDOW_SURFACE_ACT_KIND.CONTACT_EMAIL]: surfacePort[
      WINDOW_SURFACE_ACT_KIND.CONTACT_EMAIL
    ].handler(() => dependencies.openExternal(CONTACT_MAILTO)),
    [WINDOW_SURFACE_ACT_KIND.WINDOW_COPY_TEXT]: surfacePort[
      WINDOW_SURFACE_ACT_KIND.WINDOW_COPY_TEXT
    ].handler(({ input }) => dependencies.copyText(input.words)),
    [WINDOW_SURFACE_ACT_KIND.WINDOW_SAVE_FILE]: surfacePort[
      WINDOW_SURFACE_ACT_KIND.WINDOW_SAVE_FILE
    ].handler(async ({ input, context, errors }) => {
      if (!context.actor.panel) throw errors.REFUSED();
      return dependencies.saveFile(context.actor.sender, input.name, input.text);
    }),
    [WINDOW_SURFACE_ACT_KIND.FEEDBACK_SEND]: surfacePort[
      WINDOW_SURFACE_ACT_KIND.FEEDBACK_SEND
    ].effect(function* ({ input }) {
      return yield* dependencies.deliverFeedback(input.submission);
    }),
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
