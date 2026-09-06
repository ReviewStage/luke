import { CREDENTIAL_PROVIDERS, type CredentialProvider } from "@sidecar/credentials/vocabulary";
import { ISSUE_TRACKER_ID, type IssueTrackerAdapter, type IssueTrackerId } from "@sidecar/issues";
import { LinearCredentials } from "./linear/credentials.js";
import { type LinearGrant, LinearSignIn, linearSignInConfig } from "./linear/oauth.js";
import { LinearIssueTracker } from "./linear/tracker.js";

/**
 * One tracker as the desktop runs it: the adapter the issue roster is read
 * through, the credential its row stores, the consent sign-in that issues
 * one, and the disconnect that revokes it with the tracker as well as here.
 */
export interface IssueTrackerRegistration {
  adapter: IssueTrackerAdapter;
  credential: CredentialProvider;
  signIn: LinearSignIn;
  disconnect(): Promise<void>;
  /** Whether this build carries the OAuth client the sign-in needs. */
  signInAvailable(): boolean;
}

export interface IssueTrackerRegistrationOptions {
  readGrant: (trackerId: IssueTrackerId) => Promise<LinearGrant | undefined>;
  /** Stores a renewed grant. Awaited before the grant is used. */
  writeGrant: (trackerId: IssueTrackerId, grant: LinearGrant) => Promise<void>;
  /** Deletes the stored grant, which is what the tracker refusing a renewal settles. */
  forgetGrant: (trackerId: IssueTrackerId) => Promise<void>;
  openExternal: (url: string) => void;
  environment?: NodeJS.ProcessEnv;
}

/** Every tracker this build reads, keyed by its id. */
export function issueTrackerRegistrations(options: IssueTrackerRegistrationOptions) {
  const environment = options.environment ?? process.env;
  // What authorizes a read is minted rather than stored ready to send:
  // Linear's access tokens last a day, so the grant behind the row is renewed
  // here, and only Linear refusing that renewal disconnects anything.
  const linearCredentials = new LinearCredentials({
    readGrant: () => options.readGrant(ISSUE_TRACKER_ID.LINEAR),
    writeGrant: (grant) => options.writeGrant(ISSUE_TRACKER_ID.LINEAR, grant),
    forgetGrant: () => options.forgetGrant(ISSUE_TRACKER_ID.LINEAR),
    environment,
  });
  return {
    [ISSUE_TRACKER_ID.LINEAR]: {
      adapter: new LinearIssueTracker({
        readAccessToken: () => linearCredentials.accessToken(),
      }),
      credential: CREDENTIAL_PROVIDERS[ISSUE_TRACKER_ID.LINEAR],
      // The sign-in behind the row opens Linear's own consent page in the
      // user's browser and hands back one grant, which the connect stores.
      signIn: new LinearSignIn({ openExternal: options.openExternal, environment }),
      disconnect: () => linearCredentials.disconnect(),
      signInAvailable: () => linearSignInConfig(environment) !== undefined,
    },
  } satisfies Readonly<Record<IssueTrackerId, IssueTrackerRegistration>>;
}
