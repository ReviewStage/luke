import {
  GITHUB_INSTALL_LANDING,
  GITHUB_INSTALL_STATUS,
  type GitHubInstallStatus,
  githubInstallStatusFromWire,
} from "@luke/features";
import { INTEGRATION_NAME, INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import { GITHUB_INSTALL_OUTCOME, LANDING_TONE, landingWords } from "@luke/features/landing-outcome";
import { AuthMark, AuthPage, MARK_PROVIDER } from "@luke/ui";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { startSiteAnalytics } from "./analytics";
import { landingDescription, useConnectReturn } from "./connect-return";
import "./styles.css";

/**
 * Where GitHub leaves a developer once the Luke GitHub App is installed, by
 * way of the service's Setup URL route, which confirmed the installation and
 * put one word of status on this page's address. Every string is fixed by
 * the build, worded once for every landing (`@luke/features/landing-outcome`):
 * the status chooses an outcome, and nothing the address carried is drawn.
 * The way back is Open Luke (`connect-return.ts`).
 */

function statusFromAddress(): GitHubInstallStatus {
  return (
    githubInstallStatusFromWire(
      new URLSearchParams(window.location.search).get(GITHUB_INSTALL_LANDING.STATUS_PARAM),
    ) ?? GITHUB_INSTALL_STATUS.NOT_FOUND
  );
}

/**
 * The page opens on GitHub's mark, badged with how the installation ended:
 * the title says what happened, the description what to do next, and Open
 * Luke goes back.
 */
function GitHubInstalled(): React.JSX.Element {
  const [status] = useState(statusFromAddress);
  const words = landingWords(
    GITHUB_INSTALL_OUTCOME[status],
    INTEGRATION_NAME[INTEGRATION_PROVIDER.GITHUB],
  );
  const { back, open } = useConnectReturn({
    landed: true,
    settled: words.tone === LANDING_TONE.SETTLED,
  });
  return (
    <AuthPage
      mark={<AuthMark provider={MARK_PROVIDER.GITHUB} tone={words.tone} />}
      title={words.title}
      description={landingDescription(words, back)}
      action={open}
    />
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
