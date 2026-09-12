import type {
  CredentialProviderId,
  CredentialSource,
  SecretStorage,
} from "@sidecar/credentials/vocabulary";

/**
 * One connected calendar source as a renderer may know it: which account,
 * and which of its calendars the user chose to count. For Google the grant
 * behind it stays in the main process, like every credential; for Apple
 * Calendar there is no grant to keep — it lives with macOS.
 */
export interface CalendarAccount {
  /**
   * The account's primary calendar id — its address, which is its name — or
   * the fixed Apple Calendar id for the one source this Mac itself holds.
   */
  id: string;
  selectedCalendarIds: readonly string[];
}

/**
 * Runtime facts that travel beside, but never masquerade as, stored choices.
 *
 * They live apart from the schema on purpose: a setting's own entry says
 * whether its row is drawn, and it judges that from these — so a type derived
 * from the schema cannot be what the schema reads.
 */
export interface RuntimeStatus {
  credentialSources: Readonly<Record<CredentialProviderId, CredentialSource>>;
  secretStorage: SecretStorage;
  voiceAvailable: boolean;
  calendarSignInAvailable: boolean;
  calendarAccounts: readonly CalendarAccount[];
  appleCalendarAvailable: boolean;
  appleCalendar?: CalendarAccount;
}
