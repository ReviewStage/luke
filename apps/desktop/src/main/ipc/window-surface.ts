import {
  PRODUCT_EVENT,
  PRODUCT_PERMISSION_RESULT,
  type ProductEventPropertiesFor,
  type ProductPermissionResult,
  type ProductSurfaceEventName,
  productEventFromWire,
  type RecordProductEvent,
} from "@repo/features/analytics";
import type { FeedbackResult, FeedbackSubmission } from "@repo/features/feedback";
import { actPortFor, type PlatformActProcedures } from "@repo/host/act-port";
import { CONTACT_MAILTO, WINDOW_SURFACE_ACT_KIND } from "@repo/host/contract";
import {
  MICROPHONE_STATUS,
  type MicrophoneRoute,
  type MicrophoneStatus,
} from "@repo/settings/microphone";
import type { AppCommand } from "@repo/settings/shortcuts";
import { Effect } from "effect";
import type { WebContents } from "electron";
import type { ReportHandlers } from "../bridge-host";
import type { MicrophoneRouteWatch } from "../native/microphone-route";
import type { PanelManager } from "../window/panel-manager";

const MICROPHONE_STATUS_COUNTED_AS = {
  [MICROPHONE_STATUS.GRANTED]: PRODUCT_PERMISSION_RESULT.GRANTED,
  [MICROPHONE_STATUS.DENIED]: PRODUCT_PERMISSION_RESULT.DENIED,
  [MICROPHONE_STATUS.NOT_DETERMINED]: undefined,
  [MICROPHONE_STATUS.RESTRICTED]: undefined,
  [MICROPHONE_STATUS.UNKNOWN]: undefined,
} satisfies Record<MicrophoneStatus, ProductPermissionResult | undefined>;

interface WindowSurfaceDependencies {
  panels: Pick<PanelManager, "displayIdFor" | "focusIfExpanded">;
  requestMicrophone: () => Promise<MicrophoneStatus>;
  microphoneRoute: () => MicrophoneRoute | undefined;
  microphoneRouteWatcher: () => MicrophoneRouteWatch | undefined;
  recordProductEvent: RecordProductEvent;
  openExternal: (url: string) => Promise<void>;
  copyText: (words: string) => void;
  copyImage: (png: string) => boolean;
  saveFile: (sender: WebContents, name: string, text: string) => Promise<boolean>;
  deliverFeedback: (submission: FeedbackSubmission) => Effect.Effect<FeedbackResult>;
  captureStill: (sender: WebContents, rect: CapturedRect) => Promise<string | null>;
  tellUnsavedWork: (sender: WebContents, holding: boolean) => void;
  showBuildLabel: (shown: boolean) => boolean;
  tellMenuOffers: (sender: WebContents, commands: readonly AppCommand[]) => void;
}

interface CapturedRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

type WindowSurfaceActKind = (typeof WINDOW_SURFACE_ACT_KIND)[keyof typeof WINDOW_SURFACE_ACT_KIND];

const surfacePort = actPortFor<WebContents>();

export function windowSurfaceProcedures(
  dependencies: WindowSurfaceDependencies,
): Pick<PlatformActProcedures<WebContents>, WindowSurfaceActKind> {
  const { panels } = dependencies;
  return {
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
    [WINDOW_SURFACE_ACT_KIND.MICROPHONE_ROUTE]: surfacePort[
      WINDOW_SURFACE_ACT_KIND.MICROPHONE_ROUTE
    ].handler(() => {
      dependencies.microphoneRouteWatcher()?.probe();
      return dependencies.microphoneRoute();
    }),
    [WINDOW_SURFACE_ACT_KIND.MICROPHONE_OPEN_SETTINGS]: surfacePort[
      WINDOW_SURFACE_ACT_KIND.MICROPHONE_OPEN_SETTINGS
    ].handler(() =>
      dependencies.openExternal(
        "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
      ),
    ),
    [WINDOW_SURFACE_ACT_KIND.NOTIFICATIONS_OPEN_SETTINGS]: surfacePort[
      WINDOW_SURFACE_ACT_KIND.NOTIFICATIONS_OPEN_SETTINGS
    ].handler(() =>
      dependencies.openExternal(
        "x-apple.systempreferences:com.apple.Notifications-Settings.extension",
      ),
    ),
    [WINDOW_SURFACE_ACT_KIND.CONTACT_EMAIL]: surfacePort[
      WINDOW_SURFACE_ACT_KIND.CONTACT_EMAIL
    ].handler(() => dependencies.openExternal(CONTACT_MAILTO)),
    [WINDOW_SURFACE_ACT_KIND.WINDOW_COPY_TEXT]: surfacePort[
      WINDOW_SURFACE_ACT_KIND.WINDOW_COPY_TEXT
    ].handler(({ input }) => dependencies.copyText(input.words)),
    [WINDOW_SURFACE_ACT_KIND.WINDOW_COPY_IMAGE]: surfacePort[
      WINDOW_SURFACE_ACT_KIND.WINDOW_COPY_IMAGE
    ].handler(({ input, errors }) => {
      if (!dependencies.copyImage(input.png)) throw errors.REFUSED();
    }),
    [WINDOW_SURFACE_ACT_KIND.WINDOW_SAVE_FILE]: surfacePort[
      WINDOW_SURFACE_ACT_KIND.WINDOW_SAVE_FILE
    ].handler(async ({ input, context, errors }) => {
      if (!context.actor.panel) throw errors.REFUSED();
      return dependencies.saveFile(context.actor.sender, input.name, input.text);
    }),
    [WINDOW_SURFACE_ACT_KIND.WINDOW_CAPTURE]: surfacePort[
      WINDOW_SURFACE_ACT_KIND.WINDOW_CAPTURE
    ].handler(async ({ input, context, errors }) => {
      if (!context.actor.panel) throw errors.REFUSED();
      if (input.width === 0 || input.height === 0) return null;
      return dependencies.captureStill(context.actor.sender, input);
    }),
    [WINDOW_SURFACE_ACT_KIND.WINDOW_UNSAVED_WORK]: surfacePort[
      WINDOW_SURFACE_ACT_KIND.WINDOW_UNSAVED_WORK
    ].handler(({ input, context, errors }) => {
      if (!context.actor.panel) throw errors.REFUSED();
      dependencies.tellUnsavedWork(context.actor.sender, input.holding);
    }),
    [WINDOW_SURFACE_ACT_KIND.WINDOW_SHOW_BUILD_LABEL]: surfacePort[
      WINDOW_SURFACE_ACT_KIND.WINDOW_SHOW_BUILD_LABEL
    ].handler(({ input, context, errors }) => {
      if (!context.actor.panel || !dependencies.showBuildLabel(input.shown)) throw errors.REFUSED();
    }),
    [WINDOW_SURFACE_ACT_KIND.WINDOW_MENU_OFFERS]: surfacePort[
      WINDOW_SURFACE_ACT_KIND.WINDOW_MENU_OFFERS
    ].handler(({ input, context, errors }) => {
      if (!context.actor.panel) throw errors.REFUSED();
      dependencies.tellMenuOffers(context.actor.sender, input.commands);
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
    recordSurfaceEvent(_context, name, properties) {
      const read = productEventFromWire({ name, at: Date.now(), properties: properties ?? {} });
      if (!read) return;
      dependencies.recordProductEvent(
        name,
        read.properties as ProductEventPropertiesFor<ProductSurfaceEventName>,
      );
    },
  };
}
