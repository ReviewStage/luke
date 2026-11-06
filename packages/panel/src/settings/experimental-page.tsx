import { SIGNED_OUT_WORDS } from "@repo/features/words";
import { ACT_KIND } from "@repo/host/acts";
import { type ExperimentChoices, type ExperimentEntry, experimentOn } from "@repo/settings";
import { EXPERIMENT_ANCHOR } from "@repo/settings/settings-anchors";
import {
  EmptyState,
  SettingsSection,
  TEXT_BUTTON_TONE,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  TextButton,
} from "@repo/ui";
import { useMutation } from "@tanstack/react-query";
import { FlaskConicalIcon } from "lucide-react";
import { actMutation } from "../act-mutations.js";
import { useOpenFeedback } from "../open-feedback.js";
import { actionRefused, refusalToast, rowWrite } from "./row-write.js";
import { SwitchRow } from "./switch-row.js";

const NO_EXPERIMENTS_LINE = "No experiments.";

const SIGN_IN_NOTE = SIGNED_OUT_WORDS;

function ExperimentRow({ entry, on }: { entry: ExperimentEntry; on: boolean }): React.JSX.Element {
  const mutation = useMutation({
    ...actMutation(ACT_KIND.EXPERIMENT_SET),
    onSettled: refusalToast(actionRefused),
  });
  const openFeedback = useOpenFeedback();
  return (
    <SwitchRow
      label={entry.name}
      labelReplayUnmasked
      anchor={EXPERIMENT_ANCHOR[entry.key]}
      detail={
        <>
          {`${entry.detail} `}
          <TextButton tone={TEXT_BUTTON_TONE.ACCENT} onClick={() => openFeedback(entry.key)}>
            Send feedback
          </TextButton>
        </>
      }
      checked={on}
      write={rowWrite(mutation, {
        ask: (next: boolean) => ({ experiment: entry.key, on: next }),
        refused: actionRefused,
        drawn: (asked) => asked.on,
      })}
    />
  );
}

export function ExperimentalPage({
  entries,
  experiments,
  signedIn,
}: {
  entries: readonly ExperimentEntry[];
  experiments: ExperimentChoices;
  signedIn: boolean;
}): React.JSX.Element {
  if (!signedIn) {
    return (
      <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
        {SIGN_IN_NOTE}
      </Text>
    );
  }
  if (entries.length === 0) {
    return (
      <EmptyState icon={<FlaskConicalIcon />} replayUnmasked>
        {NO_EXPERIMENTS_LINE}
      </EmptyState>
    );
  }
  return (
    <>
      {entries.map((entry) => (
        <SettingsSection key={entry.key}>
          <ExperimentRow entry={entry} on={experimentOn(experiments, entry.key)} />
        </SettingsSection>
      ))}
    </>
  );
}
