import { UPDATE_STATUS, type UpdateSnapshot } from "@luke/settings/update";
import { Schema as EffectSchema } from "effect";
import { actProcedure, exactInput } from "./base.js";
import { UPDATE_ACT_KIND } from "./kinds.js";

/**
 * updates.ts -- the updater as a window reaches it: a check, the install, and the releases page and changelog opened, as procedures.
 *
 * Main answers them itself (`apps/desktop/src/main/ipc/update-acts.ts`),
 * since the updater is Electron's; a browser tab refuses every one.
 */

/** What every state of the updater carries. */
const standing = {
  currentVersion: EffectSchema.String,
  installSupported: EffectSchema.Boolean,
};

/** A download's progress, as electron-updater reports it. */
const updateProgressSchema = EffectSchema.Struct({
  percent: EffectSchema.Number,
  transferredBytes: EffectSchema.Number,
  totalBytes: EffectSchema.Number,
});

/** Where the updater stands, one struct per state of `UpdateSnapshot`. */
const updateSnapshotSchema: EffectSchema.Codec<UpdateSnapshot> = EffectSchema.Union([
  EffectSchema.Struct({
    status: EffectSchema.Literal(UPDATE_STATUS.IDLE),
    ...standing,
    upToDate: EffectSchema.Boolean,
    unreachable: EffectSchema.optionalKey(EffectSchema.Boolean),
  }),
  EffectSchema.Struct({ status: EffectSchema.Literal(UPDATE_STATUS.CHECKING), ...standing }),
  EffectSchema.Struct({
    status: EffectSchema.Literal(UPDATE_STATUS.DOWNLOADING),
    ...standing,
    latestVersion: EffectSchema.String,
    progress: EffectSchema.optionalKey(updateProgressSchema),
  }),
  EffectSchema.Struct({
    status: EffectSchema.Literal(UPDATE_STATUS.READY),
    ...standing,
    latestVersion: EffectSchema.String,
  }),
  EffectSchema.Struct({
    status: EffectSchema.Literal(UPDATE_STATUS.UPDATED),
    ...standing,
    previousVersion: EffectSchema.String,
  }),
  EffectSchema.Struct({
    status: EffectSchema.Literal(UPDATE_STATUS.ERROR),
    ...standing,
    latestVersion: EffectSchema.optionalKey(EffectSchema.String),
  }),
]);

export const updateActsContract = {
  [UPDATE_ACT_KIND.UPDATE_CHECK]: actProcedure("Could not check for updates on this system.")
    .input(exactInput(EffectSchema.Undefined))
    .output(updateSnapshotSchema),
  [UPDATE_ACT_KIND.UPDATE_INSTALL]: actProcedure("Could not install that update on this system.")
    .input(exactInput(EffectSchema.Undefined))
    .output(EffectSchema.Void),
  [UPDATE_ACT_KIND.UPDATE_OPEN_RELEASE]: actProcedure("Could not open the releases page.")
    .input(exactInput(EffectSchema.Undefined))
    .output(EffectSchema.Void),
  [UPDATE_ACT_KIND.UPDATE_OPEN_CHANGELOG]: actProcedure("Could not open the changelog.")
    .input(exactInput(EffectSchema.Undefined))
    .output(EffectSchema.Void),
};
