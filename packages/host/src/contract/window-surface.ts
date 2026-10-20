/**
 * window-surface.ts -- what a window asks of the system it is drawn on: the microphone, the notifications, a mail, focus, a copy, a save, and feedback, as procedures.
 *
 * Main answers them itself (`apps/desktop/src/main/ipc/window-surface.ts`),
 * since each reaches Electron or the Mac; a browser tab answers the ones a
 * page can carry and refuses the rest (`apps/web/src/app/web-host.ts`).
 */

import { type FeedbackSubmission, feedbackSubmission } from "@luke/features/feedback";
import { PLAN_MARKDOWN_MAX_CHARS } from "@luke/features/plan-markdown";
import {
  LID_STATE,
  MICROPHONE_STATUS,
  MICROPHONE_TRANSPORT,
  type MicrophoneRoute,
} from "@luke/voice/audio";
import type { UnparsedWireValue } from "@luke/wire";
import { Schema as EffectSchema } from "effect";
import { actProcedure, exactInput } from "./base.js";
import { WINDOW_SURFACE_ACT_KIND } from "./kinds.js";

/**
 * The longest text a File tab copies or saves of its file: the service
 * reads a file of a megabyte at most, and its text, a character to a byte
 * at least, is no longer.
 */
const FILE_TEXT_MAX_CHARS = 1024 * 1024;

/** A text admitted as written, the empty text among it, up to `max` characters. */
const textUpTo = (max: number) => EffectSchema.String.check(EffectSchema.isMaxLength(max));

/** A file's name as a save offers it: one name, no folder, so the dialog alone says where it goes. */
const savedFileName = EffectSchema.String.check(
  EffectSchema.makeFilter((value) => value.trim().length > 0),
  EffectSchema.isMaxLength(255),
  EffectSchema.isPattern(/^[^/\\]+$/u),
);

/**
 * A submission as its own domain's reader admits it (`feedbackSubmission`),
 * carried on as it arrived, as `app:act` carried it: the reader is the one
 * statement of its bounds, so it is not restated as a struct here.
 */
const feedbackSubmissionSchema = EffectSchema.declare(
  (value): value is FeedbackSubmission =>
    // SAFETY: a payload crosses the port as a structured-clone value, which the reader reads whole.
    feedbackSubmission(value as UnparsedWireValue) !== undefined,
);

const microphoneRouteSchema: EffectSchema.Codec<MicrophoneRoute> = EffectSchema.Struct({
  defaultTransport: EffectSchema.Literals(Object.values(MICROPHONE_TRANSPORT)),
  lid: EffectSchema.Literals(Object.values(LID_STATE)),
  builtInName: EffectSchema.optionalKey(EffectSchema.String),
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
  [WINDOW_SURFACE_ACT_KIND.NOTIFICATIONS_OPEN_SETTINGS]: actProcedure(
    "Could not open the notification settings.",
  )
    .input(exactInput(EffectSchema.Undefined))
    .output(EffectSchema.Void),
  [WINDOW_SURFACE_ACT_KIND.NOTIFICATIONS_TEST]: actProcedure(
    "Could not post a notification on this system.",
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
  // A task's whole document and a File tab's whole file are copied through
  // this act, so it admits the longer of the two the service holds, and an
  // empty document copies as the empty text it is.
  [WINDOW_SURFACE_ACT_KIND.WINDOW_COPY_TEXT]: actProcedure(
    "Could not copy that to the clipboard on this system.",
  )
    .input(
      exactInput(
        EffectSchema.Struct({
          words: textUpTo(Math.max(PLAN_MARKDOWN_MAX_CHARS, FILE_TEXT_MAX_CHARS)),
        }),
      ),
    )
    .output(EffectSchema.Void),
  // A File tab's file, saved where the developer chooses in the system's
  // save dialog; answers whether it was saved rather than the dialog cancelled.
  [WINDOW_SURFACE_ACT_KIND.WINDOW_SAVE_FILE]: actProcedure(
    "Could not save that file on this system.",
  )
    .input(
      exactInput(EffectSchema.Struct({ name: savedFileName, text: textUpTo(FILE_TEXT_MAX_CHARS) })),
    )
    .output(EffectSchema.Boolean),
  [WINDOW_SURFACE_ACT_KIND.FEEDBACK_SEND]: actProcedure("Could not send that on this system.")
    .input(exactInput(EffectSchema.Struct({ submission: feedbackSubmissionSchema })))
    .output(feedbackResultSchema),
};
