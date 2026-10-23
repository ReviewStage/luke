import {
  Reveal,
  RevealChoice,
  Select,
  SettingsPage,
  SettingsRow,
  SettingsSection,
  Switch,
} from "@luke/ui";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * reveals.tsx -- a settings page whose switch brings rows of its own, which
 * unroll in under it as it turns on, the rows and section under them
 * gliding down, and roll up as it turns off; and a choice whose every value
 * brings rows of its own, the rows of the value left rolling up as those of
 * the one picked unroll.
 */

/** How a sample automation is started, each way with rows of its own. */
const TRIGGER = {
  SCHEDULE: "schedule",
  WEBHOOK: "webhook",
} as const;

type Trigger = (typeof TRIGGER)[keyof typeof TRIGGER];

const TRIGGERS = [
  { value: TRIGGER.SCHEDULE, label: "Schedule" },
  { value: TRIGGER.WEBHOOK, label: "Webhook" },
] as const;

/** A row of words alone, a sample setting's. */
function Line({ label, description }: { label: string; description: string }) {
  return <SettingsRow label={label} description={description} />;
}

function Reveals(): React.JSX.Element {
  const [quiet, setQuiet] = useState(false);
  const [trigger, setTrigger] = useState<Trigger>(TRIGGER.SCHEDULE);
  return (
    <SettingsPage title="Notifications">
      <SettingsSection title="Quiet hours">
        <SettingsRow label="Quiet hours" description="Hold notifications overnight." labelsControl>
          {(control) => (
            <Switch
              id={control.controlId}
              checked={quiet}
              label="Quiet hours"
              onChange={setQuiet}
            />
          )}
        </SettingsRow>
        <Reveal shown={quiet}>
          <Line label="From" description="10:00 PM" />
          <Line label="Until" description="7:00 AM" />
        </Reveal>
        <Line label="Sound" description="A chime as each one lands." />
      </SettingsSection>
      <SettingsSection title="Trigger">
        <SettingsRow label="Type">
          {() => <Select label="Type" options={TRIGGERS} value={trigger} onChange={setTrigger} />}
        </SettingsRow>
        <RevealChoice value={trigger}>
          {(value) =>
            value === TRIGGER.SCHEDULE ? (
              <>
                <Line label="Repeats" description="Every weekday." />
                <Line label="Time" description="9:00 AM" />
              </>
            ) : (
              <Line label="Address" description="Shown once it is made." />
            )
          }
        </RevealChoice>
      </SettingsSection>
    </SettingsPage>
  );
}

function RevealExamples(): React.JSX.Element {
  return (
    <CatalogSection id="reveal-settings" title="A switch's rows, and a choice's">
      <div className="catalog-settings-frame">
        <Reveals />
      </div>
    </CatalogSection>
  );
}

export const REVEALS_EXAMPLE: Example = {
  id: "reveals",
  title: "Reveals",
  Render: RevealExamples,
};
