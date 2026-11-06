import { type FeedbackSubmission, feedbackSubmission } from "@repo/features/feedback";
import { DESCRIPTION_MARKDOWN_MAX_CHARS } from "@repo/features/description-markdown";
import {
  LID_STATE,
  MICROPHONE_STATUS,
  MICROPHONE_TRANSPORT,
  type MicrophoneRoute,
} from "@repo/settings/microphone";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import type { UnparsedWireValue } from "@repo/wire";
import { Schema as EffectSchema } from "effect";
import { actProcedure, exactInput } from "./base.js";
import { WINDOW_SURFACE_ACT_KIND } from "./kinds.js";

export const CONTACT_MAILTO = "mailto:founders@vespin.dev";

const FILE_TEXT_MAX_CHARS = 1024 * 1024;

const COPIED_PNG_MAX_CHARS = 64 * 1024 * 1024;

const pngBase64 = EffectSchema.String.check(
  EffectSchema.makeFilter((value) => value.length > 0),
  EffectSchema.isMaxLength(COPIED_PNG_MAX_CHARS),
  EffectSchema.isPattern(/^[A-Za-z0-9+/]+={0,2}$/u),
);

const textUpTo = (max: number) => EffectSchema.String.check(EffectSchema.isMaxLength(max));

const savedFileName = EffectSchema.String.check(
  EffectSchema.makeFilter((value) => value.trim().length > 0),
  EffectSchema.isMaxLength(255),
  EffectSchema.isPattern(/^[^/\\]+$/u),
);

const feedbackSubmissionSchema = EffectSchema.declare(
  (value): value is FeedbackSubmission =>
    feedbackSubmission(value as UnparsedWireValue) !== undefined,
);

const microphoneRouteSchema: EffectSchema.Codec<MicrophoneRoute> = EffectSchema.Struct({
  defaultTransport: EffectSchema.Literals(Object.values(MICROPHONE_TRANSPORT)),
  lid: EffectSchema.Literals(Object.values(LID_STATE)),
  builtInName: EffectSchema.optionalKey(EffectSchema.String),
});

const CAPTURED_SIDE_MAX = 16_384;

const capturedLength = EffectSchema.Int.check(
  EffectSchema.isBetween({ minimum: 0, maximum: CAPTURED_SIDE_MAX }),
);

const capturedRect = EffectSchema.Struct({
  x: capturedLength,
  y: capturedLength,
  width: capturedLength,
  height: capturedLength,
});

const feedbackResultSchema = EffectSchema.Struct({
  delivered: EffectSchema.Boolean,
  reason: EffectSchema.optionalKey(EffectSchema.String),
});

export const windowSurfaceActsContract = {
  [WINDOW_SURFACE_ACT_KIND.MICROPHONE_REQUEST]: actProcedure(
    "Could not ask for the microphone on this system.",
  )
    .input(exactInput(EffectSchema.Undefined))
    .output(EffectSchema.Literals(Object.values(MICROPHONE_STATUS))),
  [WINDOW_SURFACE_ACT_KIND.MICROPHONE_ROUTE]: actProcedure(
    "Could not read the microphone route on this system.",
  )
    .input(exactInput(EffectSchema.Undefined))
    .output(EffectSchema.UndefinedOr(microphoneRouteSchema)),
  [WINDOW_SURFACE_ACT_KIND.MICROPHONE_OPEN_SETTINGS]: actProcedure(
    "Could not open the microphone privacy settings.",
  )
    .input(exactInput(EffectSchema.Undefined))
    .output(EffectSchema.Void),
  [WINDOW_SURFACE_ACT_KIND.NOTIFICATIONS_OPEN_SETTINGS]: actProcedure(
    "Could not open the notification settings.",
  )
    .input(exactInput(EffectSchema.Undefined))
    .output(EffectSchema.Void),
  [WINDOW_SURFACE_ACT_KIND.CONTACT_EMAIL]: actProcedure(
    "Could not open a new email on this system.",
  )
    .input(exactInput(EffectSchema.Undefined))
    .output(EffectSchema.Void),
  [WINDOW_SURFACE_ACT_KIND.WINDOW_FOCUS_PANEL]: actProcedure(
    "Could not focus the panel on this system.",
  )
    .input(exactInput(EffectSchema.Undefined))
    .output(EffectSchema.Void),
  [WINDOW_SURFACE_ACT_KIND.WINDOW_COPY_TEXT]: actProcedure(
    "Could not copy that to the clipboard on this system.",
  )
    .input(
      exactInput(
        EffectSchema.Struct({
          words: textUpTo(Math.max(DESCRIPTION_MARKDOWN_MAX_CHARS, FILE_TEXT_MAX_CHARS)),
        }),
      ),
    )
    .output(EffectSchema.Void),
  [WINDOW_SURFACE_ACT_KIND.WINDOW_COPY_IMAGE]: actProcedure(
    "Could not copy that picture to the clipboard on this system.",
  )
    .input(exactInput(EffectSchema.Struct({ png: pngBase64 })))
    .output(EffectSchema.Void),
  [WINDOW_SURFACE_ACT_KIND.WINDOW_SAVE_FILE]: actProcedure(
    "Could not save that file on this system.",
  )
    .input(
      exactInput(EffectSchema.Struct({ name: savedFileName, text: textUpTo(FILE_TEXT_MAX_CHARS) })),
    )
    .output(EffectSchema.Boolean),
  [WINDOW_SURFACE_ACT_KIND.WINDOW_CAPTURE]: actProcedure("Could not take a still of the window.")
    .input(exactInput(capturedRect))
    .output(EffectSchema.NullOr(EffectSchema.String)),
  [WINDOW_SURFACE_ACT_KIND.WINDOW_UNSAVED_WORK]: actProcedure(
    "Could not tell this system about unsaved work.",
  )
    .input(exactInput(EffectSchema.Struct({ holding: EffectSchema.Boolean })))
    .output(EffectSchema.Void),
  [WINDOW_SURFACE_ACT_KIND.WINDOW_SHOW_BUILD_LABEL]: actProcedure(
    "Could not show or hide this build's label.",
  )
    .input(exactInput(EffectSchema.Struct({ shown: EffectSchema.Boolean })))
    .output(EffectSchema.Void),
  [WINDOW_SURFACE_ACT_KIND.WINDOW_MENU_OFFERS]: actProcedure(
    "Could not tell the menu bar what this window offers.",
  )
    .input(
      exactInput(
        EffectSchema.Struct({
          commands: EffectSchema.Array(EffectSchema.Literals(Object.values(APP_COMMAND))),
        }),
      ),
    )
    .output(EffectSchema.Void),
  [WINDOW_SURFACE_ACT_KIND.FEEDBACK_SEND]: actProcedure("Could not send that on this system.")
    .input(exactInput(EffectSchema.Struct({ submission: feedbackSubmissionSchema })))
    .output(feedbackResultSchema),
};
