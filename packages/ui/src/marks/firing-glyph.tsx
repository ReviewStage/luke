import {
  AUTOMATION_FIRING,
  type AutomationFiring,
  type AutomationTrigger,
} from "@luke/features/automation-wire";
import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import React from "react";
import { ClockIcon, PlayIcon, WebhookIcon } from "../icons/icons.js";
import { ProviderMark } from "./provider-mark.js";

// `tsx` executes imported workspace-package JSX with the classic runtime.
void React;

/**
 * firing-glyph.tsx -- what fires an automation or fired one of its runs, as the glyph its tile or row wears.
 *
 * A schedule wears its clock, a GitHub event GitHub's mark, an integration's
 * event that provider's mark (Sentry's), a webhook its hook, and a run the
 * developer started by hand Run now's play, so an automation's row and its
 * runs say what fires them in one glyph, at the glyph cell of whatever leads
 * with it.
 */

/** What fires an automation or fired a run, as its glyph. */
export function FiringGlyph({
  of,
}: {
  of: AutomationFiring | AutomationTrigger;
}): React.JSX.Element {
  switch (of.kind) {
    case AUTOMATION_FIRING.GITHUB:
      return <ProviderMark provider={INTEGRATION_PROVIDER.GITHUB} />;
    case AUTOMATION_FIRING.WEBHOOK:
      return <WebhookIcon />;
    case AUTOMATION_FIRING.MANUAL:
      return <PlayIcon />;
    case AUTOMATION_FIRING.SCHEDULE:
      return <ClockIcon />;
    case AUTOMATION_FIRING.INTEGRATION:
      return <ProviderMark provider={of.provider} />;
  }
}
