export { claudeDesktopApplications } from "./claude-code/applications.js";
export { ObservationHookRegistry } from "./hook-registry.js";
export { type LocalPeekOptions, peekLocalSessions } from "./local-peek.js";
export {
  type ProviderObservationSpool,
  type ProviderRegistration,
  type ProviderRegistrationOptions,
  providerDeclarations,
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
