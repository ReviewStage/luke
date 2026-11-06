import {
  AUTOMATION_FIRING,
  type AutomationFiring,
  type AutomationTrigger,
} from "@repo/features/automation-wire";
import { INTEGRATION_PROVIDER } from "@repo/features/integration-wire";
import React from "react";
import { ClockIcon, PlayIcon, WebhookIcon } from "../icons/icons.js";
import { ProviderMark } from "./provider-mark.js";

void React;

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
