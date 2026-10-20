import {
  GITHUB_INSTALL_LANDING,
  GITHUB_INSTALL_STATUS,
  type GitHubInstallStatus,
  githubInstallStatusFromWire,
} from "@luke/features";
import {
  AUTH_STATUS_TONE,
  AuthPage,
  BUTTON_VARIANT,
  ButtonLink,
  MARK_PROVIDER,
  PROVIDER_MARK_SIZE,
  ProviderMark,
} from "@luke/ui";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { startSiteAnalytics } from "./analytics";
import { BACK_TO_LUKE, CONNECT_RETURN, useConnectReturn } from "./connect-return";
import { ConnectionGraphic } from "./connection-graphic";
import "./styles.css";

/**
 * Where GitHub leaves a developer once the Luke GitHub App is installed, by
 * way of the service's Setup URL route, which confirmed the installation and
 * put one word of status on this page's address. Every string below is fixed
 * by the build: the status chooses a card, and nothing the address carried
 * is drawn. Each card says what to do next twice: once for a developer who
 * goes back to Luke themselves, the Mac's or a tab of the browser, and once
 * beside the Back to Luke the web app's own connect is offered
 * (`connect-return.ts`), where returning goes without saying.
 */

interface LandingCard {
  readonly badge: string;
  readonly settled: boolean;
  readonly title: string;
  readonly body: string;
  /** What is left to say beside Back to Luke, where anything is. */
  readonly backBody: string | undefined;
}

const LANDING_CARD = {
  [GITHUB_INSTALL_STATUS.INSTALLED]: {
    badge: "Installed",
    settled: true,
    title: "Luke can see your repositories",
    body: "Return to Luke. You can close this tab.",
    backBody: undefined,
  },
  [GITHUB_INSTALL_STATUS.UPDATED]: {
    badge: "Updated",
    settled: true,
    title: "Luke's repositories were updated",
    body: "Return to Luke. You can close this tab.",
    backBody: undefined,
  },
  [GITHUB_INSTALL_STATUS.REQUESTED]: {
    badge: "Requested",
    settled: true,
    title: "Your request went to the organization's owner",
    body: "You can close this tab.",
    backBody: undefined,
  },
  [GITHUB_INSTALL_STATUS.NOT_FOUND]: {
    badge: "Not completed",
    settled: false,
    title: "Luke could not confirm the installation",
    body: "Return to Luke and choose Connect GitHub again.",
    backBody: "Choose Connect GitHub again.",
  },
  [GITHUB_INSTALL_STATUS.UNAVAILABLE]: {
    badge: "Not completed",
    settled: false,
    title: "Luke could not reach GitHub",
    body: "Return to Luke and try again in a moment.",
    backBody: "Try again in a moment.",
  },
  [GITHUB_INSTALL_STATUS.CONNECTED]: {
    badge: "Connected",
    settled: true,
    title: "GitHub is connected to your workspace",
    body: "Its repositories are available to everyone in the workspace. Return to Luke. You can close this tab.",
    backBody: "Its repositories are available to everyone in the workspace.",
  },
  [GITHUB_INSTALL_STATUS.ALREADY_CONNECTED]: {
    badge: "Not connected",
    settled: false,
    title: "That GitHub account is connected to another workspace",
    body: "One GitHub account or organization connects to one workspace. Disconnect it there first, or choose another.",
    backBody:
      "One GitHub account or organization connects to one workspace. Disconnect it there first, or choose another.",
  },
  [GITHUB_INSTALL_STATUS.EXPIRED]: {
    badge: "Not connected",
    settled: false,
    title: "This connection link has expired",
    body: "Return to Luke and choose Connect GitHub again.",
    backBody: "Choose Connect GitHub again.",
  },
} as const satisfies Readonly<Record<GitHubInstallStatus, LandingCard>>;

function statusFromAddress(): GitHubInstallStatus {
  return (
    githubInstallStatusFromWire(
      new URLSearchParams(window.location.search).get(GITHUB_INSTALL_LANDING.STATUS_PARAM),
    ) ?? GITHUB_INSTALL_STATUS.NOT_FOUND
  );
}

/**
 * The page is one AuthPage card that opens on GitHub's mark joined to
 * Luke's, the same pairing the sign-in card draws: the status word says
 * where the installation stands, the title what happened, and the
 * description what to do next, with the way back where the web app's
 * connect came here.
 */
function GitHubInstalled(): React.JSX.Element {
  const [status] = useState(statusFromAddress);
  const card = LANDING_CARD[status];
  const { back, onBack } = useConnectReturn({ landed: true, settled: card.settled });
  return (
    <AuthPage
      mark={
        <ConnectionGraphic
          mark={<ProviderMark provider={MARK_PROVIDER.GITHUB} size={PROVIDER_MARK_SIZE.TILE} />}
        />
      }
      status={{
        tone: card.settled ? AUTH_STATUS_TONE.SETTLED : AUTH_STATUS_TONE.ATTENTION,
        label: card.badge,
      }}
      title={card.title}
      description={back.kind === CONNECT_RETURN.ELSEWHERE ? card.body : card.backBody}
    >
      {back.kind === CONNECT_RETURN.ELSEWHERE ? null : (
        <ButtonLink href={back.href} variant={BUTTON_VARIANT.PRIMARY} onClick={onBack}>
          {BACK_TO_LUKE}
        </ButtonLink>
      )}
    </AuthPage>
  );
}

startSiteAnalytics();

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element is missing");
createRoot(rootElement).render(
  <StrictMode>
    <GitHubInstalled />
  </StrictMode>,
);
