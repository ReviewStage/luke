import { Schema as EffectSchema } from "effect";
import { workspaceIdSchema } from "./task-wire.js";

const MAX_INSTALLATION_ID_CHARS = 64;

const installationIdSchema = EffectSchema.String.check(
  EffectSchema.isNonEmpty(),
  EffectSchema.isMaxLength(MAX_INSTALLATION_ID_CHARS),
);

export const WORKSPACE_SENTRY_QUERY = { WORKSPACE_ID: "workspaceId" } as const;

export const workspaceSentryRequestSchema = EffectSchema.Struct({
  workspaceId: workspaceIdSchema,
});

export const workspaceSentryInstallAnswerSchema = EffectSchema.Struct({
  url: EffectSchema.String.check(EffectSchema.isNonEmpty()),
});

export const workspaceSentryDisconnectRequestSchema = EffectSchema.Struct({
  workspaceId: workspaceIdSchema,
  installationId: installationIdSchema,
});

const workspaceSentryInstallationSchema = EffectSchema.Struct({
  installationId: installationIdSchema,
  account: EffectSchema.optionalKey(EffectSchema.String),
});

export type WorkspaceSentryInstallation = typeof workspaceSentryInstallationSchema.Type;

export const workspaceSentryAnswerSchema = EffectSchema.Struct({
  configured: EffectSchema.Boolean,
  installations: EffectSchema.Array(workspaceSentryInstallationSchema),
  txid: EffectSchema.optionalKey(EffectSchema.String),
});

export type WorkspaceSentry = typeof workspaceSentryAnswerSchema.Type;
