/**
 * window-surface.ts -- what a window asks of the system it is drawn on: the microphone, the notifications, a mail, focus, a copy of words or a picture, a save, and feedback, as procedures.
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
 * Where Contact us > Email writes to: the address the site's footer, the
 * privacy policy, and the security policy all name. Held by whoever answers
 * the act rather than sent by the panel, so the act can open no other
 * address.
 */
export const CONTACT_MAILTO = "mailto:founders@stagereview.app";

/**
 * The longest text a File tab copies or saves of its file: the service
 * reads a file of a megabyte at most, and its text, a character to a byte
 * at least, is no longer.
 */
const FILE_TEXT_MAX_CHARS = 1024 * 1024;

/**
 * The longest PNG a picture copies as, in base64: a picture the window
 * shows is a few megabytes at most, and drawn again as a PNG it may grow
 * several times over, so this leaves it room while keeping one copy off
 * the port's whole budget.
 */
const COPIED_PNG_MAX_CHARS = 64 * 1024 * 1024;

/** A PNG's bytes in base64, as a picture is copied. */
const pngBase64 = EffectSchema.String.check(
  EffectSchema.makeFilter((value) => value.length > 0),
  EffectSchema.isMaxLength(COPIED_PNG_MAX_CHARS),
  EffectSchema.isPattern(/^[A-Za-z0-9+/]+={0,2}$/u),
);

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
 * carried on as it arrived: the reader is the one
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

/** The widest or tallest a window's part may be asked for a still of, in CSS pixels: past any display. */
const CAPTURED_SIDE_MAX = 16_384;

/** One side or corner of the part of a window a still is asked of, in whole CSS pixels. */
const capturedLength = EffectSchema.Int.check(
  EffectSchema.isBetween({ minimum: 0, maximum: CAPTURED_SIDE_MAX }),
);

/** The part of the asking window a still is taken of, from its top left corner. */
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
  // A picture the viewer shows, put on the clipboard as a PNG.
  [WINDOW_SURFACE_ACT_KIND.WINDOW_COPY_IMAGE]: actProcedure(
    "Could not copy that picture to the clipboard on this system.",
  )
    .input(exactInput(EffectSchema.Struct({ png: pngBase64 })))
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
  // A still of part of the asking panel, downscaled, as a JPEG's data URL;
  // none where the part is empty or nothing was drawn there to take.
  [WINDOW_SURFACE_ACT_KIND.WINDOW_CAPTURE]: actProcedure("Could not take a still of the window.")
    .input(exactInput(capturedRect))
    .output(EffectSchema.NullOr(EffectSchema.String)),
  [WINDOW_SURFACE_ACT_KIND.WINDOW_UNSAVED_WORK]: actProcedure(
    "Could not tell this system about unsaved work.",
  )
    .input(exactInput(EffectSchema.Struct({ holding: EffectSchema.Boolean })))
    .output(EffectSchema.Void),
  [WINDOW_SURFACE_ACT_KIND.FEEDBACK_SEND]: actProcedure("Could not send that on this system.")
    .input(exactInput(EffectSchema.Struct({ submission: feedbackSubmissionSchema })))
    .output(feedbackResultSchema),
};
