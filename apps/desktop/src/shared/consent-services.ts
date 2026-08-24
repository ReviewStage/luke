import { GOOGLE_CALENDAR_ID, GOOGLE_CALENDAR_NAME } from "@sidecar/calendar/vocabulary";
import { CREDENTIAL_PROVIDER_ID } from "@sidecar/credentials/vocabulary";
import { APPLE_CALENDAR_ID } from "./apple-calendar";

/**
 * The services connected by consent rather than by a pasted key: the panel
 * stands down for each of them the same way, and the slot it stands down to
 * has to say which one is being waited on. Named together here because they
 * answer to one wait — only one consent ask can be open at a time, one slot
 * holds it, and a slot that cannot say whose ask it is would be the same
 * pill for all of them.
 *
 * Linear's id is the credential registry's, because Linear is a service Luke
 * holds one credential for. Each calendar's is its own: Google's holds
 * several accounts at once, which the per-provider registry does not model,
 * and Apple's holds no credential at all.
 */
export const CONSENT_SERVICE_ID = {
  APPLE_CALENDAR: APPLE_CALENDAR_ID,
  GOOGLE_CALENDAR: GOOGLE_CALENDAR_ID,
  LINEAR: CREDENTIAL_PROVIDER_ID.LINEAR,
} as const;

export type ConsentServiceId = (typeof CONSENT_SERVICE_ID)[keyof typeof CONSENT_SERVICE_ID];

/** What the wait calls each service, which is whoever is actually asking. */
export const CONSENT_SERVICE_NAME = {
  // macOS rather than the integration's name: the dialog being waited on is
  // the system's own, not Apple Calendar's.
  [CONSENT_SERVICE_ID.APPLE_CALENDAR]: "macOS",
  [CONSENT_SERVICE_ID.GOOGLE_CALENDAR]: GOOGLE_CALENDAR_NAME,
  // Not the registry's `displayName` by lookup: the wait says "Waiting for
  // Linear…", and the two must be the same word.
  [CONSENT_SERVICE_ID.LINEAR]: "Linear",
} as const satisfies Readonly<Record<ConsentServiceId, string>>;

/** How every browser-consent wait reads; the services differ only upstream. */
const BROWSER_WAIT = {
  detail: "Finish in your browser.",
  reopens: true,
  settingsPane: false,
} as const;

/**
 * What the slot's small line asks the user to do, and which affordances the
 * wait carries. A browser flow has a tab to lose and reopen; the system's
 * own dialog can be neither lost nor summoned again, and a refusal's way
 * back is System Settings — `settingsPane` is what makes the refusal's own
 * "System Settings" words pressable, structure rather than the slot pattern
 * matching prose it does not own.
 */
export const CONSENT_SERVICE_WAIT = {
  [CONSENT_SERVICE_ID.APPLE_CALENDAR]: {
    // The dialog, or the System Settings switch a refused ask opens instead:
    // either consent connects on its own, so the line asks for both at once.
    detail: "Allow calendar access in macOS's dialog, or in System Settings.",
    reopens: false,
    settingsPane: true,
  },
  [CONSENT_SERVICE_ID.GOOGLE_CALENDAR]: BROWSER_WAIT,
  [CONSENT_SERVICE_ID.LINEAR]: BROWSER_WAIT,
} as const satisfies Readonly<
  Record<ConsentServiceId, { detail: string; reopens: boolean; settingsPane: boolean }>
>;
