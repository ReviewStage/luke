import {
  INTEGRATION_LANDING,
  INTEGRATION_LANDING_STATUS,
  INTEGRATION_NAME,
  type IntegrationLandingStatus,
  type IntegrationProvider,
  integrationLandingStatusFromWire,
  integrationProviderFromWire,
} from "@luke/features/integration-wire";
import {
  INTEGRATION_LANDING_OUTCOME,
  LANDING_TONE,
  landingWords,
} from "@luke/features/landing-outcome";
import { AuthMark, AuthPage } from "@luke/ui";
import { useState } from "react";
import { startSiteAnalytics } from "./analytics";
import { landingDescription, useConnectReturn } from "./connect-return";
import "./styles.css";
import { mountPrerenderedPage } from "./mount-page";

/**
 * Where a developer lands once a sign-in to an integration, started from
 * Luke's settings, settles, by way of the service's callback route, which
 * settled it with Vercel Connect and put the provider and one word of status
 * on this page's address. It is drawn as GitHub's landing is, from the same
 * words (`@luke/features/landing-outcome`): the address chooses among them,
 * and nothing it carried is drawn. The way back is Open Luke
 * (`connect-return.ts`).
 */

interface Landing {
  readonly provider: IntegrationProvider | undefined;
  readonly status: IntegrationLandingStatus;
}

function landingFromAddress(): Landing {
  const query = new URLSearchParams(window.location.search);
  return {
    provider: integrationProviderFromWire(query.get(INTEGRATION_LANDING.PROVIDER_PARAM)),
    status:
      integrationLandingStatusFromWire(query.get(INTEGRATION_LANDING.STATUS_PARAM)) ??
      INTEGRATION_LANDING_STATUS.EXPIRED,
  };
}

/**
 * The page opens on the provider's mark, or Luke's where the address named
 * no provider, badged with how the connection settled: the title says so,
 * the description how to go on, and Open Luke goes back.
 */
function IntegrationConnected(): React.JSX.Element {
  const [landing] = useState(landingFromAddress);
  const words = landingWords(
    INTEGRATION_LANDING_OUTCOME[landing.status],
    landing.provider === undefined ? undefined : INTEGRATION_NAME[landing.provider],
  );
  const { back, open } = useConnectReturn({
    landed: true,
    settled: words.tone === LANDING_TONE.SETTLED,
  });
  return (
    <AuthPage
      mark={<AuthMark provider={landing.provider} tone={words.tone} />}
      title={words.title}
      description={landingDescription(words, back)}
      action={open}
    />
  );
}

startSiteAnalytics();

mountPrerenderedPage(<IntegrationConnected />);
