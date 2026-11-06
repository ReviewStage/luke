import { UPDATE_FAILURE, UPDATE_STATUS, type UpdateSnapshot } from "@repo/settings/update";
import { Schema as EffectSchema } from "effect";
import { actProcedure, exactInput } from "./base.js";
import { UPDATE_ACT_KIND } from "./kinds.js";

const standing = {
  currentVersion: EffectSchema.String,
  installSupported: EffectSchema.Boolean,
};

const updateProgressSchema = EffectSchema.Struct({
  percent: EffectSchema.Number,
  transferredBytes: EffectSchema.Number,
  totalBytes: EffectSchema.Number,
});

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
    failure: EffectSchema.optionalKey(EffectSchema.Literals(Object.values(UPDATE_FAILURE))),
  }),
]);

export const updateActsContract = {
  [UPDATE_ACT_KIND.UPDATE_CHECK]: actProcedure("Could not check for updates on this system.")
    .input(exactInput(EffectSchema.Undefined))
    .output(updateSnapshotSchema),
  [UPDATE_ACT_KIND.UPDATE_INSTALL]: actProcedure("Could not install that update on this system.")
    .input(exactInput(EffectSchema.Undefined))
    .output(EffectSchema.Void),
  [UPDATE_ACT_KIND.UPDATE_MOVE_TO_APPLICATIONS]: actProcedure(
    "Could not move the app to Applications on this system.",
  )
    .input(exactInput(EffectSchema.Undefined))
    .output(EffectSchema.Void),
  [UPDATE_ACT_KIND.UPDATE_OPEN_RELEASE]: actProcedure("Could not open the releases page.")
    .input(exactInput(EffectSchema.Undefined))
    .output(EffectSchema.Void),
  [UPDATE_ACT_KIND.UPDATE_OPEN_CHANGELOG]: actProcedure("Could not open the changelog.")
    .input(exactInput(EffectSchema.Undefined))
    .output(EffectSchema.Void),
};
