import { Schema as EffectSchema } from "effect";
import { workspaceIdSchema } from "./task-wire.js";

/**
 * sentry-install-wire.ts -- a workspace's installations of Luke's Sentry integration, as the desktop reads, begins, and ends them.
 *
 * An owner or admin installs Luke's Sentry integration on a Sentry
 * organization for one workspace, whose automations its deliveries then fire.
 * `POST /api/workspaces/sentry/install` answers Sentry's install address,
 * which carries a single-use intent's state there and back; Sentry returns
 * the browser to `/api/triggers/sentry/installed`, which links the
 * installation and lands on the integrations landing page.
 * `GET /api/workspaces/sentry/installations` answers whether the deployment
 * holds the integration at all, and the workspace's active installations,
 * each named by its Sentry organization's slug where Luke has it;
 * `POST /api/workspaces/sentry/disconnect` stops one firing anything and
 * answers the same. No answer carries a Sentry token.
 */

/** The longest installation id taken: Sentry's ids are UUIDs, 36 characters. */
const MAX_INSTALLATION_ID_CHARS = 64;

const installationIdSchema = EffectSchema.String.check(
  EffectSchema.isNonEmpty(),
  EffectSchema.isMaxLength(MAX_INSTALLATION_ID_CHARS),
);

/** The query the installations read names its workspace by. */
export const WORKSPACE_SENTRY_QUERY = { WORKSPACE_ID: "workspaceId" } as const;

/** The workspace whose Sentry is installed or read (POST body, or the read's query). */
export const workspaceSentryRequestSchema = EffectSchema.Struct({
  workspaceId: workspaceIdSchema,
});

/** Where the browser goes to install: Sentry's install address for Luke's integration, carrying the intent's state. */
export const workspaceSentryInstallAnswerSchema = EffectSchema.Struct({
  url: EffectSchema.String.check(EffectSchema.isNonEmpty()),
});

/** One installation disconnected from the workspace by an owner or admin (POST). */
export const workspaceSentryDisconnectRequestSchema = EffectSchema.Struct({
  workspaceId: workspaceIdSchema,
  installationId: installationIdSchema,
});

/** One active installation: Sentry's id for it, and the slug of the organization it is on where Luke has it. */
const workspaceSentryInstallationSchema = EffectSchema.Struct({
  installationId: installationIdSchema,
  account: EffectSchema.optionalKey(EffectSchema.String),
});

export type WorkspaceSentryInstallation = typeof workspaceSentryInstallationSchema.Type;

/**
 * A workspace's Sentry as it stands: whether this deployment holds Luke's
 * Sentry integration, without which nothing is offered, and the workspace's
 * active installations, the first linked first.
 */
export const workspaceSentryAnswerSchema = EffectSchema.Struct({
  configured: EffectSchema.Boolean,
  installations: EffectSchema.Array(workspaceSentryInstallationSchema),
});

export type WorkspaceSentry = typeof workspaceSentryAnswerSchema.Type;
