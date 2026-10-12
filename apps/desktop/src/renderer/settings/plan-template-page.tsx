import { useAtom } from "@effect/atom-react";
import type { PlanTemplateAnswerView } from "@sidecar/hosted/coding-agent-view";
import {
  PLAN_TEMPLATE_BOUNDS,
  type PlanTemplateAnswer,
} from "@sidecar/hosted/plan-document-template";
import { ResetIcon } from "@sidecar/panel";
import { cssCustomProperties } from "@sidecar/surface/react-css";
import { ACTION_RESULT_STATUS, type ActionResult } from "@sidecar/wire";
import { Duration, Effect } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import { useCallback, useEffect, useRef, useState } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import { type ActHandle, useAct } from "../act";
import { rendererRuntime } from "../renderer-runtime";
import { RetryButton } from "../retry-button";
import { SETTINGS_SEARCH_ROW, searchAnchorProps } from "../settings-anchors";
import { SpinnerRegion } from "../spinner";
import { ConfirmDialog, type DialogQuestion, useConfirmDialog } from "./confirm-dialog";
import { PlanTemplateEditor } from "./plan-template-editor";

/**
 * plan-template-page.tsx -- Settings › Plan template: the Markdown every new plan starts as a copy of.
 *
 * The template is the account's, kept on the service, so the page reads it
 * afresh as it opens and every Mac the account signs in on edits the same
 * one. The words save a beat after the developer stops typing and again as
 * focus leaves the box or the page goes, one write at a time: a pause that
 * ends while a write is out is saved once that write answers. A save that
 * failed says so under the box with a Retry, and a template past the bound
 * says so and is not sent. Reset to default asks first, since the words it
 * replaces are kept nowhere, and stands only while the account holds a
 * template of its own. With no account signed in there is no template to
 * show, and the page says so.
 *
 * The box is `PlanTemplateEditor`, kept behind its own small boundary so
 * the plan's document editor can take its place.
 */

/** What the page says beside the box, and with no account. */
const PAGE_LINE = {
  HELP: "New plans start as a copy of this template. Editing it doesn't change existing plans.",
  SIGNED_OUT: "Sign in to edit the template your new plans start from.",
  READ_FAILED: "The template could not be read.",
  WRITE_FAILED: "The template could not be saved.",
  RESET_FAILED: "The template could not be reset. Try again.",
  TOO_LONG: `That template is too long to save. Keep it to ${PLAN_TEMPLATE_BOUNDS.MAX_CHARS.toLocaleString("en-US")} characters.`,
  SAVING: "Saving…",
  SAVED: "Saved",
} as const;

/** How long the developer pauses before what they typed is saved. */
const SAVE_PAUSE = Duration.seconds(1);

/** The pause before a save, as an atom whose work is the wait; setting it again starts the wait over. */
const savePauseAtom = rendererRuntime.fn((stamp: number) =>
  Effect.as(Effect.sleep(SAVE_PAUSE), stamp),
);

/** Where the page stands with the service's template. */
const TEMPLATE_READ = {
  READING: "reading",
  FAILED: "failed",
  READ: "read",
} as const;

type TemplateRead = (typeof TEMPLATE_READ)[keyof typeof TEMPLATE_READ];

/** Where the newest save stands, as the line under the box says it. */
const SAVE_STATE = {
  /** Nothing to say: nothing typed since the template was read, or words still waiting on their pause. */
  QUIET: "quiet",
  SAVING: "saving",
  SAVED: "saved",
  FAILED: "failed",
} as const;

type SaveState = (typeof SAVE_STATE)[keyof typeof SAVE_STATE];

const RESET_QUESTION: DialogQuestion = {
  title: "Reset plan template?",
  body: "Your template is replaced by the default, and your edits to it are lost. Existing plans don't change. This can't be undone.",
  verb: "Reset",
  running: "Resetting",
};

/**
 * What a save reads and writes as it lands, which no render stands between:
 * the box's words, the words the service last answered it keeps, whether a
 * write is out, whether a pause ended while it was, and which reading of the
 * template the box is on, so a write sent before a reset lands nowhere.
 */
interface HeldTemplate {
  text: string;
  kept: string;
  sending: boolean;
  due: boolean;
  generation: number;
}

/** Whether the words are past what the service keeps. */
function tooLong(text: string): boolean {
  return text.length > PLAN_TEMPLATE_BOUNDS.MAX_CHARS;
}

/** One write of the template, read as the template kept or nothing at all. */
function written(
  act: ActHandle["act"],
  template: string | null,
): Promise<PlanTemplateAnswer | undefined> {
  return act(ACT_KIND.PLAN_TEMPLATE_WRITE, { template })
    .catch((): PlanTemplateAnswerView | undefined => undefined)
    .then((answer) => (answer === undefined || "failure" in answer ? undefined : answer));
}

/** The template as the box edits it, and its doors. */
interface TemplateDraft {
  text: string;
  custom: boolean;
  save: SaveState;
  take: (answer: PlanTemplateAnswer) => void;
  type: (text: string) => void;
  send: () => void;
  reset: () => Promise<ActionResult>;
}

/**
 * The words the box holds and their saves. Note that the held record is a
 * ref, because a pause and a blur landing in one flush must start one
 * write, not two, and a write's answer reads the words as they stand when it
 * lands.
 */
function useTemplateDraft(act: ActHandle["act"]): TemplateDraft {
  const [text, setText] = useState("");
  const [custom, setCustom] = useState(false);
  const [save, setSave] = useState<SaveState>(SAVE_STATE.QUIET);
  const [pause, restartPause] = useAtom(savePauseAtom);
  const stamp = useRef(0);
  // The keystroke whose pause last saved, so a pause saves once however many renders follow it.
  const spent = useRef(0);
  const held = useRef<HeldTemplate>({
    text,
    kept: text,
    sending: false,
    due: false,
    generation: 0,
  });

  const take = useCallback((answer: PlanTemplateAnswer) => {
    const generation = held.current.generation + 1;
    held.current = {
      text: answer.template,
      kept: answer.template,
      sending: false,
      due: false,
      generation,
    };
    setText(answer.template);
    setCustom(answer.custom);
    setSave(SAVE_STATE.QUIET);
  }, []);

  const send = useCallback(() => {
    const now = held.current;
    now.due = now.sending;
    if (now.sending || now.text === now.kept || tooLong(now.text)) return;
    const { text: sent, generation } = now;
    now.sending = true;
    setSave(SAVE_STATE.SAVING);
    written(act, sent).then((answer) => {
      const landed = held.current;
      if (landed.generation !== generation) return;
      landed.sending = false;
      if (answer === undefined) {
        setSave(SAVE_STATE.FAILED);
      } else {
        landed.kept = answer.template;
        setCustom(answer.custom);
        setSave(landed.text === landed.kept ? SAVE_STATE.SAVED : SAVE_STATE.QUIET);
      }
      // A pause or a blur that came while the write was out saves what stands now.
      if (landed.due) send();
    });
  }, [act]);

  // A pause that ran out on the newest keystroke saves what stands, once.
  useEffect(() => {
    if (!AsyncResult.isSuccess(pause) || pause.waiting || pause.value !== stamp.current) return;
    if (spent.current === stamp.current) return;
    spent.current = stamp.current;
    send();
  });

  // The page going sends words still waiting on their pause, since nothing will be left to.
  useEffect(
    () => () => {
      const now = held.current;
      if (now.text === now.kept || tooLong(now.text)) return;
      written(act, now.text).catch(() => undefined);
    },
    [act],
  );

  return {
    text,
    custom,
    save,
    take,
    send,
    type: (next) => {
      held.current.text = next;
      setText(next);
      setSave((was) => (was === SAVE_STATE.SAVED ? SAVE_STATE.QUIET : was));
      stamp.current += 1;
      restartPause(stamp.current);
    },
    reset: () =>
      written(act, null).then((answer): ActionResult => {
        if (answer === undefined) {
          return { status: ACTION_RESULT_STATUS.REJECTED, reason: PAGE_LINE.RESET_FAILED };
        }
        take(answer);
        return { status: ACTION_RESULT_STATUS.ACCEPTED };
      }),
  };
}

/** Where the read stands, and its Retry. */
interface TemplateReading {
  read: TemplateRead;
  retry: () => void;
}

/** The read of the service's template as the page opens, and again on Retry; a read that lands is taken into the box. */
function useTemplateRead(
  signedIn: boolean,
  act: ActHandle["act"],
  take: (answer: PlanTemplateAnswer) => void,
): TemplateReading {
  const [read, setRead] = useState<TemplateRead>(TEMPLATE_READ.READING);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    setRead(TEMPLATE_READ.READING);
    act(ACT_KIND.PLAN_TEMPLATE_READ)
      .catch((): PlanTemplateAnswerView | undefined => undefined)
      .then((answer) => {
        if (!live) return;
        if (answer !== undefined && !("failure" in answer)) take(answer);
        setRead(
          answer === undefined || "failure" in answer ? TEMPLATE_READ.FAILED : TEMPLATE_READ.READ,
        );
      });
    return () => {
      live = false;
    };
  }, [act, signedIn, attempt, take]);
  return { read, retry: () => setAttempt((count) => count + 1) };
}

/** What stands under the box: the bound, a failed save and its retry, or how the newest save stands. */
function SaveLine({ draft }: { draft: TemplateDraft }): React.JSX.Element | null {
  if (tooLong(draft.text)) {
    return (
      <p className="error-message" role="alert">
        {PAGE_LINE.TOO_LONG}
      </p>
    );
  }
  if (draft.save === SAVE_STATE.FAILED) {
    return (
      <div className="plan-template-line" role="alert">
        <span className="error-message">{PAGE_LINE.WRITE_FAILED}</span>
        <RetryButton onRetry={draft.send} />
      </div>
    );
  }
  if (draft.save === SAVE_STATE.QUIET) return null;
  return (
    <p className="settings-note">
      {draft.save === SAVE_STATE.SAVING ? PAGE_LINE.SAVING : PAGE_LINE.SAVED}
    </p>
  );
}

/** The template read: the help beside the reset, the box under the recording's mask, and the line under it. */
function TemplateRows({ draft }: { draft: TemplateDraft }): React.JSX.Element {
  const reset = useConfirmDialog({ subject: draft.custom, surfaceOpen: true }, draft.reset);
  return (
    <>
      <div className="plan-template-head">
        <p className="settings-note">{PAGE_LINE.HELP}</p>
        {draft.custom ? (
          <button type="button" className="toolbar-button" onClick={reset.ask}>
            <ResetIcon />
            Reset to default
          </button>
        ) : null}
      </div>
      <div className="ph-no-capture" {...searchAnchorProps(SETTINGS_SEARCH_ROW.PLAN_TEMPLATE)}>
        <PlanTemplateEditor
          text={draft.text}
          label="Plan template"
          onText={draft.type}
          onLeave={draft.send}
        />
      </div>
      <SaveLine draft={draft} />
      <ConfirmDialog confirm={reset} question={RESET_QUESTION} />
    </>
  );
}

export function PlanTemplateSection({ signedIn }: { signedIn: boolean }): React.JSX.Element {
  const { act } = useAct();
  const draft = useTemplateDraft(act);
  const { read, retry } = useTemplateRead(signedIn, act, draft.take);
  return (
    <section
      className="settings-section settings-plain"
      style={cssCustomProperties({ "--row-index": 1 })}
    >
      {!signedIn ? (
        <p className="settings-note">{PAGE_LINE.SIGNED_OUT}</p>
      ) : read === TEMPLATE_READ.READ ? (
        <TemplateRows draft={draft} />
      ) : read === TEMPLATE_READ.FAILED ? (
        <>
          <p className="error-message" role="alert">
            {PAGE_LINE.READ_FAILED}
          </p>
          <RetryButton onRetry={retry} />
        </>
      ) : (
        <SpinnerRegion label="Loading your template" />
      )}
    </section>
  );
}
