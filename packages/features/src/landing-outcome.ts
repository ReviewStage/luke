import { GITHUB_INSTALL_STATUS, type GitHubInstallStatus } from "./github-install-wire.js";
import { INTEGRATION_LANDING_STATUS, type IntegrationLandingStatus } from "./integration-wire.js";
import { PRODUCT_NAME } from "./product-name.js";

export const LANDING_TONE = {
  COMPLETE: "complete",
  DANGER: "danger",
} as const;

export type LandingTone = (typeof LANDING_TONE)[keyof typeof LANDING_TONE];

export const LANDING_OUTCOME = {
  CONNECTED: "connected",
  WORKSPACE_CONNECTED: "workspace-connected",
  INSTALLED: "installed",
  UPDATED: "updated",
  REQUESTED: "requested",
  NOT_CONFIRMED: "not-confirmed",
  NOT_COMPLETED: "not-completed",
  UNAVAILABLE: "unavailable",
  EXPIRED: "expired",
  ALREADY_CONNECTED: "already-connected",
  NOTHING_TO_CONNECT: "nothing-to-connect",
  SERVICE_UNREACHABLE: "service-unreachable",
} as const;

export type LandingOutcome = (typeof LANDING_OUTCOME)[keyof typeof LANDING_OUTCOME];

export interface LandingWords {
  readonly tone: LandingTone;
  readonly title: string;
  readonly line: string | undefined;
}

export const LANDING_CLOSE_TAB = "You can close this tab.";

function connectAgain(name: string | undefined): string {
  return `Connect ${name ?? "it"} again from ${PRODUCT_NAME}.`;
}

const LANDING_WORDS = {
  [LANDING_OUTCOME.CONNECTED]: (name) => ({
    tone: LANDING_TONE.COMPLETE,
    title: name === undefined ? `Connected to ${PRODUCT_NAME}` : `${name} is connected`,
    line: undefined,
  }),
  [LANDING_OUTCOME.WORKSPACE_CONNECTED]: (name) => ({
    tone: LANDING_TONE.COMPLETE,
    title: `${name ?? "It"} is connected to your workspace`,
    line: "Everyone in the workspace can use it.",
  }),
  [LANDING_OUTCOME.INSTALLED]: (name) => ({
    tone: LANDING_TONE.COMPLETE,
    title:
      name === undefined
        ? `${PRODUCT_NAME} can see your repositories`
        : `${PRODUCT_NAME} can see your ${name} repositories`,
    line: undefined,
  }),
  [LANDING_OUTCOME.UPDATED]: (name) => ({
    tone: LANDING_TONE.COMPLETE,
    title:
      name === undefined
        ? `${PRODUCT_NAME}'s repositories were updated`
        : `${PRODUCT_NAME}'s ${name} repositories were updated`,
    line: undefined,
  }),
  [LANDING_OUTCOME.REQUESTED]: () => ({
    tone: LANDING_TONE.COMPLETE,
    title: "Your request went to your organization's owner",
    line: undefined,
  }),
  [LANDING_OUTCOME.NOT_CONFIRMED]: (name) => ({
    tone: LANDING_TONE.DANGER,
    title:
      name === undefined
        ? `${PRODUCT_NAME} could not confirm the installation`
        : `${PRODUCT_NAME} could not confirm the ${name} installation`,
    line: connectAgain(name),
  }),
  [LANDING_OUTCOME.NOT_COMPLETED]: (name) => ({
    tone: LANDING_TONE.DANGER,
    title: name === undefined ? "Nothing was connected" : `${name} was not connected`,
    line: connectAgain(name),
  }),
  [LANDING_OUTCOME.UNAVAILABLE]: (name) => ({
    tone: LANDING_TONE.DANGER,
    title:
      name === undefined
        ? `${PRODUCT_NAME} could not finish connecting`
        : `${PRODUCT_NAME} could not reach ${name}`,
    line: "Try again in a moment.",
  }),
  [LANDING_OUTCOME.EXPIRED]: (name) => ({
    tone: LANDING_TONE.DANGER,
    title:
      name === undefined
        ? "This connection link has expired"
        : `This link to connect ${name} has expired`,
    line: connectAgain(name),
  }),
  [LANDING_OUTCOME.ALREADY_CONNECTED]: (name) => ({
    tone: LANDING_TONE.DANGER,
    title:
      name === undefined
        ? "That account is connected to another workspace"
        : `That ${name} account is connected to another workspace`,
    line: undefined,
  }),
  [LANDING_OUTCOME.NOTHING_TO_CONNECT]: (name) => ({
    tone: LANDING_TONE.DANGER,
    title: name === undefined ? "Nothing to connect" : `No ${name} connection to finish`,
    line: `Connect ${name ?? "it"} from ${PRODUCT_NAME}.`,
  }),
  [LANDING_OUTCOME.SERVICE_UNREACHABLE]: () => ({
    tone: LANDING_TONE.DANGER,
    title: `${PRODUCT_NAME} could not be reached`,
    line: "Reload this page to try again.",
  }),
} as const satisfies Record<LandingOutcome, (name: string | undefined) => LandingWords>;

export function landingWords(outcome: LandingOutcome, name: string | undefined): LandingWords {
  return LANDING_WORDS[outcome](name);
}

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

export const INTEGRATION_LANDING_OUTCOME = {
  [INTEGRATION_LANDING_STATUS.CONNECTED]: LANDING_OUTCOME.CONNECTED,
  [INTEGRATION_LANDING_STATUS.NOT_COMPLETED]: LANDING_OUTCOME.NOT_COMPLETED,
  [INTEGRATION_LANDING_STATUS.EXPIRED]: LANDING_OUTCOME.EXPIRED,
  [INTEGRATION_LANDING_STATUS.UNAVAILABLE]: LANDING_OUTCOME.UNAVAILABLE,
  [INTEGRATION_LANDING_STATUS.ALREADY_CONNECTED]: LANDING_OUTCOME.ALREADY_CONNECTED,
} as const satisfies Record<IntegrationLandingStatus, LandingOutcome>;
