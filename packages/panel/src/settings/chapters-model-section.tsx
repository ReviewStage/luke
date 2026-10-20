import {
  CHAPTERS_MODEL_LABEL,
  CHAPTERS_MODEL_LIST,
  type ChaptersModelId,
} from "@luke/features/chapters-model-choice";
import { ACT_KIND } from "@luke/host/acts";
import { SETTINGS_SEARCH_ROW, searchAnchorProps } from "@luke/settings/settings-anchors";
import {
  CHOICE_BAR_LOOK,
  ChoiceBar,
  ErrorState,
  SettingsLine,
  SettingsRow,
  SettingsRowsSkeleton,
  SettingsSection,
} from "@luke/ui";
import { useCallback, useEffect, useState } from "react";
import { useAct } from "../act.js";

/**
 * chapters-model-section.tsx -- Settings › Coding agents' Chapters group: the Claude model a Generate chapters the member presses runs on.
 *
 * The choice is the account's, kept on the service beside the default model
 * (`@luke/features/chapters-model-choice`), and read by the service when
 * the member presses Generate chapters; the chapters stay the workspace's.
 * Every model runs on Luke's key and outside the account's usage, so the
 * row offers Claude's alone, as a segmented control. The page reads the
 * choice afresh as it opens; a write is one ask of the service, the control
 * resting until it answers and a refusal worded under it. With no account
 * signed in there is nothing to show, and the group says so.
 */

/** What the group says while it cannot read or write, with no account, and under its row. */
const SECTION_LINE = {
  FAILED: "The chapters model could not be read.",
  SIGNED_OUT: "Sign in to choose the model your chapters run on.",
  WRITE_FAILED: "The chapters model could not be saved. Try again.",
  DETAIL: "Runs on Luke's key, outside your usage.",
} as const;

/** The Chapters group, over the member's choice as the service holds it. */
export function ChaptersModelSection({ signedIn }: { signedIn: boolean }): React.JSX.Element {
  const { act } = useAct();
  const [model, setModel] = useState<ChaptersModelId | undefined>(undefined);
  const [readFailed, setReadFailed] = useState(false);
  const [rejection, setRejection] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);

  // The page opening reads the choice the service holds now, which another device may just have written.
  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    setModel(undefined);
    setReadFailed(false);
    act(ACT_KIND.CHAPTERS_MODEL_READ).then(
      (answer) => {
        if (!live) return;
        if ("failure" in answer) setReadFailed(true);
        else setModel(answer.model);
      },
      () => {
        if (live) setReadFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [act, signedIn, attempt]);

  const write = useCallback(
    (next: ChaptersModelId) => {
      setBusy(true);
      void act(ACT_KIND.CHAPTERS_MODEL_WRITE, { model: next })
        .catch(() => undefined)
        .then((answer) => {
          setBusy(false);
          if (answer === undefined || "failure" in answer) {
            setRejection(SECTION_LINE.WRITE_FAILED);
            return;
          }
          setRejection(undefined);
          setModel(answer.model);
        });
    },
    [act],
  );

  return (
    <SettingsSection title="Chapters">
      {!signedIn ? (
        <SettingsLine>{SECTION_LINE.SIGNED_OUT}</SettingsLine>
      ) : model !== undefined ? (
        <SettingsRow label="Model" description={SECTION_LINE.DETAIL} error={rejection}>
          {() => (
            <ChoiceBar
              label="Chapters model"
              items={CHAPTERS_MODEL_LIST.map((each) => ({
                value: each,
                label: CHAPTERS_MODEL_LABEL[each],
              }))}
              value={model}
              look={CHOICE_BAR_LOOK.SEGMENTED}
              disabled={busy}
              {...searchAnchorProps(SETTINGS_SEARCH_ROW.CHAPTERS_MODEL)}
              onChange={write}
            />
          )}
        </SettingsRow>
      ) : readFailed ? (
        <SettingsLine>
          <ErrorState onRetry={() => setAttempt((count) => count + 1)}>
            {SECTION_LINE.FAILED}
          </ErrorState>
        </SettingsLine>
      ) : (
        <SettingsRowsSkeleton label="Loading your chapters model" />
      )}
    </SettingsSection>
  );
}
