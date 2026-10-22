import {
  Avatar,
  CHOICE_FLOW,
  CHOICE_LOOK,
  CHOICE_SELECT,
  CHOICE_TONE,
  type ChoiceFlow,
  ChoiceList,
  type ChoiceLook,
  type ChoiceOption,
  type ChoiceSelect,
} from "@luke/ui";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * choice-list.tsx -- a pick-one list with a recommended option and an
 * unavailable one, a pick-several list, both marked with their radios or
 * checkboxes and numbered, a yes and a no across, toned, pills, rows with a mark before their words, an
 * unavailable list, a settled record of what was picked, and a
 * narrow column of long words.
 */

const RETRIES: readonly ChoiceOption<string>[] = [
  {
    value: "three",
    label: "Retry 3 times over an hour",
    detail: "Most failures clear within the hour.",
    badge: "Recommended",
  },
  { value: "once", label: "Retry once", detail: "Fails fast, pages sooner." },
  {
    value: "queue",
    label: "Hold in the queue",
    detail: "Unavailable: the queue is full.",
    disabled: true,
  },
];

const CHANNELS: readonly ChoiceOption<string>[] = [
  { value: "email", label: "Email", detail: "To the account's own address." },
  { value: "slack", label: "Slack", detail: "To #alerts." },
  { value: "pager", label: "Pager", detail: "Wakes whoever is on call." },
];

const DECISIONS: readonly ChoiceOption<string>[] = [
  { value: "approve", label: "Approve", tone: CHOICE_TONE.COMPLETE },
  { value: "decline", label: "Decline", tone: CHOICE_TONE.DANGER },
];

const WORKSPACES: readonly ChoiceOption<string>[] = [
  { value: "acme", label: "Acme", detail: "12 members", mark: <Avatar name="Acme" decorative /> },
  {
    value: "northwind",
    label: "Northwind",
    detail: "Personal workspace",
    mark: <Avatar name="Northwind" decorative />,
  },
  {
    value: "globex",
    label: "Globex",
    detail: "No GitHub connected · can’t reach acme/api",
    mark: <Avatar name="Globex" decorative />,
    disabled: true,
  },
];

const LONG: readonly ChoiceOption<string>[] = [
  {
    value: "path",
    label: "Move packages/service/src/maintenance/maintenance-sweep.ts under the cron's own folder",
    detail: "Keeps the sweep beside the route that calls it, which the next reader looks in first.",
    badge: "Recommended",
  },
  { value: "keep", label: "Leave it where it is" },
];

function Held({
  options,
  start,
  legend,
  select,
  disabled = false,
  look,
  numbered,
  flow,
}: {
  options: readonly ChoiceOption<string>[];
  start: readonly string[];
  legend: string;
  select?: ChoiceSelect;
  disabled?: boolean;
  look?: ChoiceLook;
  numbered?: boolean;
  flow?: ChoiceFlow;
}): React.JSX.Element {
  const [value, setValue] = useState(start);
  return (
    <ChoiceList
      legend={legend}
      options={options}
      value={value}
      select={select}
      look={look}
      numbered={numbered}
      flow={flow}
      clearable
      disabled={disabled}
      onChange={setValue}
    />
  );
}

function ChoiceLists(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="choice-list-one" title="Pick one">
        <Held legend="Retries" options={RETRIES} start={["three"]} />
      </CatalogSection>
      <CatalogSection id="choice-list-many" title="Pick any that apply">
        <Held
          legend="Channels"
          options={CHANNELS}
          start={["email", "pager"]}
          select={CHOICE_SELECT.MANY}
        />
      </CatalogSection>
      <CatalogSection id="choice-list-marked" title="Marked and numbered">
        <Held
          legend="Retries"
          options={RETRIES}
          start={["three"]}
          look={CHOICE_LOOK.MARKED}
          numbered
        />
        <Held
          legend="Channels"
          options={CHANNELS}
          start={["email", "pager"]}
          select={CHOICE_SELECT.MANY}
          look={CHOICE_LOOK.MARKED}
          numbered
        />
      </CatalogSection>
      <CatalogSection id="choice-list-across" title="Across, toned">
        <Held
          legend="Decision"
          options={DECISIONS}
          start={["approve"]}
          look={CHOICE_LOOK.MARKED}
          flow={CHOICE_FLOW.ACROSS}
          numbered
        />
      </CatalogSection>
      <CatalogSection id="choice-list-pill" title="Pills">
        <Held
          legend="Effort"
          options={[
            { value: "medium", label: "medium" },
            { value: "high", label: "high" },
            { value: "xhigh", label: "xhigh", badge: "Recommended" },
          ]}
          start={["high"]}
          look={CHOICE_LOOK.PILL}
        />
      </CatalogSection>
      <CatalogSection id="choice-list-mark" title="With a mark">
        <Held legend="Workspace" options={WORKSPACES} start={["northwind"]} />
      </CatalogSection>
      <CatalogSection id="choice-list-disabled" title="Unavailable while sending">
        <Held legend="Retries" options={RETRIES} start={["once"]} disabled />
      </CatalogSection>
      <CatalogSection id="choice-list-settled" title="Settled">
        <ChoiceList
          legend="What was offered"
          options={RETRIES}
          value={["once"]}
          settled
          pickedNote="Your pick"
        />
      </CatalogSection>
      <CatalogSection id="choice-list-narrow" title="Narrow column, long words">
        <div className="catalog-narrow">
          <Held legend="Where the sweep lives" options={LONG} start={[]} />
        </div>
      </CatalogSection>
    </>
  );
}

export const CHOICE_LIST_EXAMPLE: Example = {
  id: "choice-list",
  title: "Choice list",
  Render: ChoiceLists,
};
