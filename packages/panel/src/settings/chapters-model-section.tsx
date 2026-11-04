import {
  CHAPTERS_MODEL_DEFAULT,
  CHAPTERS_MODEL_LABEL,
  CHAPTERS_MODEL_LIST,
  type ChaptersModelId,
} from "@repo/features/chapters-model-choice";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { readingWords, SIGNED_OUT_WORDS } from "@repo/features/words";
import { ACT_KIND } from "@repo/host/acts";
import { SETTINGS_SEARCH_ROW, searchAnchorProps } from "@repo/settings/settings-anchors";
import {
  CHOICE_BAR_LOOK,
  ChoiceBar,
  ErrorState,
  SETTINGS_SKELETON_CONTROL,
  SettingsLine,
  SettingsRow,
  type SettingsRowSkeletonShape,
  SettingsRowsSkeleton,
  SettingsSection,
} from "@repo/ui";
import { useSettingWrite } from "@repo/ui/use-setting-write";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import { useCallback } from "react";
import { useAccountPreferences } from "../account-choices.js";
import { useAct } from "../act.js";
import { refusalShown, unreadShown } from "../failure-report.js";
import { HOST_READ_STATUS } from "../use-host-read.js";
import { SettingMarks } from "./marks.js";

/**
 * chapters-model-section.tsx -- Settings › Agents' Chapters group: the Claude model a Generate chapters the member presses runs on.
 *
 * The choice is the account's, kept on the service beside the default model
 * (`@repo/features/chapters-model-choice`), and read by the service when
 * the member presses Generate chapters; the chapters stay the workspace's.
 * Every model runs on the member's own API key: the Claude model chosen on
 * an Anthropic key, OpenAI's of its tier where they saved only an OpenAI key
 * (`@repo/service`'s `chaptersModelOf`), so the row offers Claude's alone,
 * as a segmented control. The page reads the
 * choice afresh as it opens; a write is one ask of the service through
 * `useSettingWrite`, the control resting until it answers, a refusal worded
 * under it, and the row saying Saved once a write lands and Modified while the
 * choice is not Haiku. With no account
 * signed in there is nothing to show, and the group says so.
 */

/** What the group says while it cannot read or write, with no account, and under its row. */
const SECTION_LINE = {
  FAILED: "The chapters model could not be read.",
  SIGNED_OUT: SIGNED_OUT_WORDS,
  WRITE_FAILED: "The chapters model could not be saved. Try again.",
  DETAIL: "Runs on your own API key, or OpenAI's model of the same tier on an OpenAI key alone.",
} as const;

/** The row that stands while the model is read: Model over its note, and the models' segments. */
const CHAPTERS_SKELETON: readonly SettingsRowSkeletonShape[] = [
  { described: true, controls: [SETTINGS_SKELETON_CONTROL.CHOICE] },
];

/** The Chapters group, over the member's choice as the host holds it (`LIVE_READ.ACCOUNT_PREFERENCES`), which a choice made on another device moves within moments. */
export function ChaptersModelSection({ signedIn }: { signedIn: boolean }): React.JSX.Element {
  const { act } = useAct();
  const preferences = useAccountPreferences();
  const model = preferences.rows?.chaptersModel;

  const write = useCallback(
    (next: ChaptersModelId): Promise<ActionResult> =>
      act(ACT_KIND.CHAPTERS_MODEL_WRITE, { model: next })
        .catch(() => undefined)
        .then((answer): ActionResult => {
          if (answer === undefined || "failure" in answer) {
            return { status: ACTION_RESULT_STATUS.REJECTED, reason: SECTION_LINE.WRITE_FAILED };
          }
          return { status: ACTION_RESULT_STATUS.ACCEPTED };
        }),
    [act],
  );
  const { rejection, saves, run } = useSettingWrite(write);

  return (
    <SettingsSection title="Chapters">
      {!signedIn ? (
        <SettingsLine>{SECTION_LINE.SIGNED_OUT}</SettingsLine>
      ) : model !== undefined ? (
        <SettingsRow
          label="Model"
          adornment={<SettingMarks changed={model !== CHAPTERS_MODEL_DEFAULT} saves={saves} />}
          description={SECTION_LINE.DETAIL}
          error={refusalShown(rejection, FAILURE_SURFACE.SETTING_WRITE)}
        >
          {() => (
            <ChoiceBar
              label="Chapters model"
              items={CHAPTERS_MODEL_LIST.map((each) => ({
                value: each,
                label: CHAPTERS_MODEL_LABEL[each],
              }))}
              value={model}
              look={CHOICE_BAR_LOOK.SEGMENTED}
              // Note that the bar stays live while a write is out, because the host draws the choice on the press.
              disabled={false}
              {...searchAnchorProps(SETTINGS_SEARCH_ROW.CHAPTERS_MODEL)}
              onChange={run}
            />
          )}
        </SettingsRow>
      ) : preferences.status === HOST_READ_STATUS.FAILED ? (
        <SettingsLine>
          <ErrorState
            failure={unreadShown(FAILURE_SURFACE.CHAPTERS_MODEL_READ)}
            onRetry={() => void preferences.retry()}
          >
            {SECTION_LINE.FAILED}
          </ErrorState>
        </SettingsLine>
      ) : (
        <SettingsRowsSkeleton
          label={readingWords("your chapters model")}
          rows={CHAPTERS_SKELETON}
        />
      )}
    </SettingsSection>
  );
}
