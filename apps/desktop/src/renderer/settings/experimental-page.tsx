import { ACT_KIND } from "@luke/host/acts";
import { useAct } from "@luke/panel/act";
import type { SettingsWrites } from "@luke/panel/settings/writes";
import {
  EXPERIMENT,
  type Experiment,
  type ExperimentChoices,
  type ExperimentEntry,
  experimentOn,
  SETTINGS_PAGE as SCHEMA_SETTINGS_PAGE,
  SETTING_SECTION,
  type SettingSection,
  type SettingsRowsInput,
} from "@luke/settings";
import { EXPERIMENT_ANCHOR } from "@luke/settings/settings-anchors";
import {
  EmptyState,
  SettingsSection,
  TEXT_BUTTON_TONE,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  TextButton,
} from "@luke/ui";
import { FlaskConicalIcon } from "lucide-react";
import { useOpenFeedback } from "../open-feedback";
import { SchemaSettingRows } from "./schema-rows";
import { SwitchRow } from "./switch-row";

/**
 * experimental-page.tsx -- Settings › Experimental: a switch for each feature the account can try before it is finished, or the empty state between them.
 *
 * The page says nothing of its own above the rows (Dean, 2026-10-14): its
 * title and each row's one line are the whole of it. A row's switch writes
 * the account's choice on the service at once, as every Settings switch
 * writes, so the feature appears or goes on every Mac the account opens; a
 * write the service refused is said under the row, and the switch stays. Each
 * row's Send feedback opens the window's feedback dialog about that
 * experiment. With none standing, the page keeps its place and draws the
 * empty state the empty Inbox draws, so a link or a search result that lands
 * here never lands on nothing.
 *
 * Each experiment is a card of its own, its switch first. One with stored
 * settings of its own, such as the avatar Video calls shows, draws them in
 * its card beneath the switch, from the schema section named for it, while
 * the schema says they stand: so they appear as the switch is turned on, and
 * read as that experiment's rather than the page's. The card wears no title,
 * since its switch already names the experiment.
 *
 * Each card is `@luke/ui`'s `SettingsSection` and the signed-out note its
 * caption `Text`; Send feedback stays a press among the row's detail words,
 * drawn as the links beside such words are.
 */

/** What the empty page says. */
const NO_EXPERIMENTS_LINE = "No experiments";

/** Why a signed-out page holds no switches: experiments are an account's. */
const SIGN_IN_NOTE = "Sign in to try experiments.";

/** The schema section an experiment's own settings stand in, for one that has any. */
function sectionOf(experiment: Experiment): SettingSection | undefined {
  return experiment === EXPERIMENT.VIDEO_CALLS ? SETTING_SECTION.VIDEO_CALLS : undefined;
}

/** One experiment's row: its switch, what turning it on brings, and the way to say how it went. */
function ExperimentRow({ entry, on }: { entry: ExperimentEntry; on: boolean }): React.JSX.Element {
  const { act } = useAct();
  const openFeedback = useOpenFeedback();
  return (
    <SwitchRow
      label={entry.name}
      anchor={EXPERIMENT_ANCHOR[entry.key]}
      detail={
        <>
          {`${entry.detail} `}
          <TextButton tone={TEXT_BUTTON_TONE.LINK} onClick={() => openFeedback(entry.key)}>
            Send feedback
          </TextButton>
        </>
      }
      checked={on}
      onChange={(next) => act(ACT_KIND.EXPERIMENT_SET, { experiment: entry.key, on: next })}
    />
  );
}

/** The page: each experiment's card, or the empty state while none stands; a note while signed out. */
export function ExperimentalPage({
  entries,
  experiments,
  signedIn,
  view,
  writes,
}: {
  /** The experiments standing, newest first: `EXPERIMENTS`, as the registry lists them. */
  entries: readonly ExperimentEntry[];
  /** The account's choices, as the settings carry them. */
  experiments: ExperimentChoices;
  signedIn: boolean;
  /** What the schema rows are judged from; absent until the settings arrive, when only the switches stand. */
  view?: SettingsRowsInput | undefined;
  writes: SettingsWrites;
}): React.JSX.Element {
  if (!signedIn) {
    return (
      <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.SUBTLE}>
        {SIGN_IN_NOTE}
      </Text>
    );
  }
  if (entries.length === 0) {
    return <EmptyState icon={<FlaskConicalIcon />}>{NO_EXPERIMENTS_LINE}</EmptyState>;
  }
  return (
    <>
      {entries.map((entry) => {
        const section = sectionOf(entry.key);
        return (
          <SettingsSection key={entry.key}>
            <ExperimentRow entry={entry} on={experimentOn(experiments, entry.key)} />
            {section !== undefined && view !== undefined ? (
              <SchemaSettingRows
                page={SCHEMA_SETTINGS_PAGE.EXPERIMENTAL}
                section={section}
                view={view}
                writes={writes}
              />
            ) : null}
          </SettingsSection>
        );
      })}
    </>
  );
}
