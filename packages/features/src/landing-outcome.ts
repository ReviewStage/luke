import { GITHUB_INSTALL_STATUS, type GitHubInstallStatus } from "./github-install-wire.js";
import { INTEGRATION_LANDING_STATUS, type IntegrationLandingStatus } from "./integration-wire.js";

/**
 * landing-outcome.ts -- how a connect ended, as every page a browser lands on after one says it: its tone, its title, and the line under it.
 *
 * GitHub's App landing, an integration's landing, and the account's own
 * GitHub connect each end in one of a few outcomes, and each outcome is
 * worded once, here, so one idea reads one way across the product
 * (`docs/DESIGN.md`'s Copy). A title names the provider where the page knows
 * it and says the outcome on its own, since the artwork beside it is hidden
 * from a reader. The line under it says only what the reader can act on; a
 * page that offers the way back draws that as its button rather than as words.
 */

/** How a flow ended: settled, or failed. A page still on its way has no tone. */
export const LANDING_TONE = {
  SETTLED: "settled",
  FAILED: "failed",
} as const;

export type LandingTone = (typeof LANDING_TONE)[keyof typeof LANDING_TONE];

/** Every way a connect can end, whichever provider it was for. */
export const LANDING_OUTCOME = {
  /** The provider is connected to the account. */
  CONNECTED: "connected",
  /** The provider is connected to the workspace, for everyone in it. */
  WORKSPACE_CONNECTED: "workspace-connected",
  /** The provider's app was installed and Luke reaches its repositories. */
  INSTALLED: "installed",
  /** An installation changed which repositories Luke reaches. */
  UPDATED: "updated",
  /** The developer asked an organization's owner to install the app. */
  REQUESTED: "requested",
  /** The provider named no installation Luke could confirm. */
  NOT_CONFIRMED: "not-confirmed",
  /** The sign-in gave Luke no grant: declined, cancelled, or refused. */
  NOT_COMPLETED: "not-completed",
  /** Luke could not reach the provider, or the service between them. */
  UNAVAILABLE: "unavailable",
  /** The connect's link is too old, already used, or not Luke's. */
  EXPIRED: "expired",
  /** The provider's account already stands for another workspace. */
  ALREADY_CONNECTED: "already-connected",
  /** The page was opened with no connect to carry out. */
  NOTHING_TO_CONNECT: "nothing-to-connect",
  /** Luke's own service gave no answer. */
  LUKE_UNREACHABLE: "luke-unreachable",
} as const;

export type LandingOutcome = (typeof LANDING_OUTCOME)[keyof typeof LANDING_OUTCOME];

/** What a landing says of an outcome. */
export interface LandingWords {
  readonly tone: LandingTone;
  /** The outcome on its own, naming the provider where the page knows it. */
  readonly title: string;
  /** What to do next, where there is anything. */
  readonly line: string | undefined;
}

/** Said under a settled outcome where the landing is a tab of its own, which is nothing more to the reader. */
export const LANDING_CLOSE_TAB = "You can close this tab.";

/** How to go on from an outcome a fresh connect fixes. */
function connectAgain(name: string | undefined): string {
  return `Connect ${name ?? "it"} again from Luke.`;
}

/** Each outcome's words, for the provider `name`, or none where the page does not know it. */
const LANDING_WORDS = {
  [LANDING_OUTCOME.CONNECTED]: (name) => ({
    tone: LANDING_TONE.SETTLED,
    title: name === undefined ? "Connected to Luke" : `${name} is connected`,
    line: undefined,
  }),
  [LANDING_OUTCOME.WORKSPACE_CONNECTED]: (name) => ({
    tone: LANDING_TONE.SETTLED,
    title: `${name ?? "It"} is connected to your workspace`,
    line: "Everyone in the workspace can use it.",
  }),
  [LANDING_OUTCOME.INSTALLED]: (name) => ({
    tone: LANDING_TONE.SETTLED,
    title:
      name === undefined
        ? "Luke can see your repositories"
        : `Luke can see your ${name} repositories`,
    line: undefined,
  }),
  [LANDING_OUTCOME.UPDATED]: (name) => ({
    tone: LANDING_TONE.SETTLED,
    title:
      name === undefined
        ? "Luke's repositories were updated"
        : `Luke's ${name} repositories were updated`,
    line: undefined,
  }),
  [LANDING_OUTCOME.REQUESTED]: () => ({
    tone: LANDING_TONE.SETTLED,
    // The page knows the provider, never the organization, so it cannot name one.
    title: "Your request went to your organization's owner",
    line: undefined,
  }),
  [LANDING_OUTCOME.NOT_CONFIRMED]: (name) => ({
    tone: LANDING_TONE.FAILED,
    title:
      name === undefined
        ? "Luke could not confirm the installation"
        : `Luke could not confirm the ${name} installation`,
    line: connectAgain(name),
  }),
  [LANDING_OUTCOME.NOT_COMPLETED]: (name) => ({
    tone: LANDING_TONE.FAILED,
    title: name === undefined ? "Nothing was connected" : `${name} was not connected`,
    line: connectAgain(name),
  }),
  [LANDING_OUTCOME.UNAVAILABLE]: (name) => ({
    tone: LANDING_TONE.FAILED,
    title: name === undefined ? "Luke could not finish connecting" : `Luke could not reach ${name}`,
    line: "Try again in a moment.",
  }),
  [LANDING_OUTCOME.EXPIRED]: (name) => ({
    tone: LANDING_TONE.FAILED,
    title:
      name === undefined
        ? "This connection link has expired"
        : `This link to connect ${name} has expired`,
    line: connectAgain(name),
  }),
  [LANDING_OUTCOME.ALREADY_CONNECTED]: (name) => ({
    tone: LANDING_TONE.FAILED,
    title:
      name === undefined
        ? "That account is connected to another workspace"
        : `That ${name} account is connected to another workspace`,
    line: `Uninstall Luke from that account on ${name ?? "its provider"} first, or choose another account.`,
  }),
  [LANDING_OUTCOME.NOTHING_TO_CONNECT]: (name) => ({
    tone: LANDING_TONE.FAILED,
    title: name === undefined ? "Nothing to connect" : `No ${name} connection to finish`,
    line: `Connect ${name ?? "it"} from Luke.`,
  }),
  [LANDING_OUTCOME.LUKE_UNREACHABLE]: () => ({
    tone: LANDING_TONE.FAILED,
    title: "Luke could not be reached",
    line: "Reload this page to try again.",
  }),
} as const satisfies Record<LandingOutcome, (name: string | undefined) => LandingWords>;

/** What a landing says of `outcome`, for the provider `name`, or for none where the page does not know it. */
export function landingWords(outcome: LandingOutcome, name: string | undefined): LandingWords {
  return LANDING_WORDS[outcome](name);
}

/** The outcome each of the GitHub App's landing statuses is. */
export const GITHUB_INSTALL_OUTCOME = {
  [GITHUB_INSTALL_STATUS.INSTALLED]: LANDING_OUTCOME.INSTALLED,
  [GITHUB_INSTALL_STATUS.UPDATED]: LANDING_OUTCOME.UPDATED,
  [GITHUB_INSTALL_STATUS.REQUESTED]: LANDING_OUTCOME.REQUESTED,
  [GITHUB_INSTALL_STATUS.NOT_FOUND]: LANDING_OUTCOME.NOT_CONFIRMED,
  [GITHUB_INSTALL_STATUS.UNAVAILABLE]: LANDING_OUTCOME.UNAVAILABLE,
  [GITHUB_INSTALL_STATUS.CONNECTED]: LANDING_OUTCOME.WORKSPACE_CONNECTED,
  [GITHUB_INSTALL_STATUS.ALREADY_CONNECTED]: LANDING_OUTCOME.ALREADY_CONNECTED,
  [GITHUB_INSTALL_STATUS.EXPIRED]: LANDING_OUTCOME.EXPIRED,
} as const satisfies Record<GitHubInstallStatus, LandingOutcome>;

/** The outcome each of an integration's landing statuses is. */
export const INTEGRATION_LANDING_OUTCOME = {
  [INTEGRATION_LANDING_STATUS.CONNECTED]: LANDING_OUTCOME.CONNECTED,
  [INTEGRATION_LANDING_STATUS.NOT_COMPLETED]: LANDING_OUTCOME.NOT_COMPLETED,
  [INTEGRATION_LANDING_STATUS.EXPIRED]: LANDING_OUTCOME.EXPIRED,
  [INTEGRATION_LANDING_STATUS.UNAVAILABLE]: LANDING_OUTCOME.UNAVAILABLE,
  [INTEGRATION_LANDING_STATUS.ALREADY_CONNECTED]: LANDING_OUTCOME.ALREADY_CONNECTED,
} as const satisfies Record<IntegrationLandingStatus, LandingOutcome>;
