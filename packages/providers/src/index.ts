export { claudeDesktopApplications } from "./claude-code/applications.js";
export { conductorApplications } from "./conductor/applications.js";
export {
  conductorLocalWorkspacePlugin,
  conductorRepositories,
} from "./conductor/local-workspaces.js";
export { ObservationHookRegistry } from "./hook-registry.js";
export { type LocalPeekOptions, peekLocalSessions } from "./local-peek.js";
export {
  type ProviderObservationSpool,
  type ProviderRegistration,
  providerRegistrations,
} from "./registrations.js";
export {
  ADAPTER_DIAGNOSTIC_KIND,
  type AdapterDiagnosticCallback,
  type AdapterDiagnosticKind,
} from "./shared/adapter-diagnostics.js";
export {
  canIgnoreFilesystemError,
  readDirectory,
  readTextFile,
} from "./shared/local-files.js";
export {
  canIgnoreSqliteError,
  defaultSqliteModule,
  numberFromRow,
  type SqliteDatabase,
  type SqliteModuleLoader,
  scopedReadOnlyDatabase,
  textFromRow,
} from "./shared/local-sqlite.js";
export {
  type ObservationSpoolOptions,
  type ObservedSpoolEvent,
  observationSpoolEvents,
} from "./shared/spool-watcher.js";
export {
  type WorkspaceHostEnrichment,
  type WorkspaceHostRegistration,
  type WorkspaceHostRegistrationOptions,
  workspaceHostRegistrations,
} from "./shared/workspace-hosts.js";
export type { SupersetCommandRunner, SupersetQueryRunner } from "./superset/cli.js";
export { SupersetCli, type SupersetCliOptions } from "./superset/cli.js";
export {
  type SupersetPlugin,
  type SupersetPluginOptions,
  supersetPlugin,
} from "./superset/plugin.js";
export { supersetHostState } from "./superset/reader.js";
export {
  SupersetSignIn,
  type SupersetSignInOptions,
  validSupersetSignInCode,
} from "./superset/sign-in.js";
export {
  SUPERSET_SIGN_IN_STAGE,
  type SupersetOrganizationChoice,
  type SupersetSignInSnapshot,
  type SupersetSignInStage,
} from "./superset/sign-in-stage.js";
export { type SupersetSnapshot, supersetSnapshot } from "./superset/snapshot.js";
export { isSupersetControlId, SUPERSET_CONTROL_ID } from "./superset/vocabulary.js";
export { type SupersetSessionContext, supersetPressedLink } from "./superset/wire.js";
