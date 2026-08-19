import { CREDENTIAL_PROVIDER_ID } from "./credential-providers";
import { GOOGLE_CALENDAR_ID, GOOGLE_CALENDAR_NAME } from "./google-calendar";

/**
 * The services connected by consent rather than by a pasted key: the panel
 * stands down for each of them the same way, and the slot it stands down to
 * has to say which one the browser is waiting on. Named together here because
 * they answer to one wait — only one consent page can be open at a time, one
 * slot holds it, and a slot that cannot say whose page it is would be the
 * same pill for both.
 *
 * Linear's id is the credential registry's, because Linear is a service Luke
 * holds one credential for. The calendar's is its own: it holds several
 * accounts at once, which the per-provider registry does not model.
 */
export const CONSENT_SERVICE_ID = {
  GOOGLE_CALENDAR: GOOGLE_CALENDAR_ID,
  LINEAR: CREDENTIAL_PROVIDER_ID.LINEAR,
} as const;

export type ConsentServiceId = (typeof CONSENT_SERVICE_ID)[keyof typeof CONSENT_SERVICE_ID];

/** What the wait calls each service, which is the provider's own name for itself. */
export const CONSENT_SERVICE_NAME = {
  [CONSENT_SERVICE_ID.GOOGLE_CALENDAR]: GOOGLE_CALENDAR_NAME,
  // Not the registry's `displayName` by lookup: the wait says "Waiting for
  // Linear…", and the two must be the same word.
  [CONSENT_SERVICE_ID.LINEAR]: "Linear",
} as const satisfies Readonly<Record<ConsentServiceId, string>>;
