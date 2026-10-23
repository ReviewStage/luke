import {
  INSTALLED_SKILL_PROBLEM,
  type InstalledSkillCandidate,
  type InstalledSkillPreview,
  type InstalledSkillSummary,
} from "@luke/features/installed-skill-route-wire";
import {
  INSTALLED_SKILL_CALL_FAILURE,
  type InstalledSkillPreviewView,
} from "@luke/features/installed-skill-view";
import {
  INSTALLED_SKILL_SCOPE,
  type InstalledSkillScope,
} from "@luke/features/installed-skill-wire";
import { parseSkillPaste, SKILL_PASTE_KIND } from "@luke/features/skill-paste";
import type { Workspace } from "@luke/features/workspace-wire";
import { ACT_KIND } from "@luke/host/acts";
import {
  BUTTON_VARIANT,
  Button,
  CHOICE_BAR_LOOK,
  Checkbox,
  ChoiceBar,
  DIALOG_SIZE,
  Dialog,
  FormField,
  GAP,
  INSET,
  SCROLL_FADE,
  SCROLL_SIZE,
  ScrollArea,
  Stack,
  TEXT_ELEMENT,
  TEXT_FIELD_FONT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  TextArea,
  TextField,
} from "@luke/ui";
import { useEffect, useMemo, useState } from "react";
import { useAct } from "../act.js";
import { rendererPause } from "../renderer-runtime.js";
import {
  candidateLine,
  DETECTED_TONE,
  type DetectedLine,
  type DetectedTone,
  failureLine,
  initialTicks,
  installRequest,
  installScopes,
  missingLine,
  pastedLine,
  previewLine,
  problemsLine,
  SKILLS_LINE,
  type TextFill,
  textFields,
  textProblems,
  tickable,
  withRefusal,
} from "./skills-model.js";

/**
 * add-skill-dialog.tsx -- Settings › Skills' Add skill: one box that takes an `npx skills add` command or a skill's text, what it would install, and Install.
 *
 * The box is read the moment it changes (`parseSkillPaste`), so the line
 * under it says at once whether it is a GitHub repository, a skill's text,
 * or something Luke does not install from. A short pause after the last
 * keystroke, the service previews it, reading GitHub for a command: the
 * line then says how many skills the repository holds at which commit, and
 * each is listed with a box ticked where the paste asked for it, a skill
 * with problems never tickable; names the paste asked for that no folder
 * holds are listed first. However many a repository holds, the box and
 * its line stay at the card's head and Install for and the answers at its
 * foot: only the found skills give way and scroll. For text, the name
 * it declares, and a field for a name or a description where it has none.
 * Install for offers Just me,
 * and Everyone in the workspace to any member outside a personal
 * workspace. Install sends the paste again whole, as the service
 * reads it afresh; a refusal is said in plain words under the box.
 */

/** How long the box stands still before the service previews it. */
const PREVIEW_PAUSE_MS = 400;

/** The name and description fields as a new paste leaves them. */
const EMPTY_FILL: TextFill = { name: "", description: "" };

/** How the line under the box is drawn: understood with its dot, a problem in the attention tint, or plain while it waits. */
const LINE_STATE = {
  [DETECTED_TONE.DETECTED]: "connected",
  [DETECTED_TONE.PROBLEM]: "attention",
  [DETECTED_TONE.WAITING]: "plain",
} as const satisfies Record<DetectedTone, string>;

/** The service's preview as the dialog holds it: of which text, and what it answered. */
interface Previewed {
  readonly text: string;
  readonly view: InstalledSkillPreviewView;
}

/** The line under the box, in the tint its tone takes and announced as it changes. */
function DetectedText({ line }: { line: DetectedLine }): React.JSX.Element {
  return (
    <span className="settings-state" data-state={LINE_STATE[line.tone]} role="status">
      {line.text}
    </span>
  );
}

/** One skill a repository holds, with its box, its line, and why it cannot be ticked where it cannot. */
function CandidateRow({
  candidate,
  ticked,
  disabled,
  onTick,
}: {
  candidate: InstalledSkillCandidate;
  ticked: boolean;
  disabled: boolean;
  onTick: (ticked: boolean) => void;
}): React.JSX.Element {
  return (
    <Checkbox
      checked={ticked && tickable(candidate)}
      disabled={disabled || !tickable(candidate)}
      onChange={onTick}
    >
      <Stack gap={GAP.NONE}>
        <Text variant={TEXT_VARIANT.LABEL} as={TEXT_ELEMENT.SPAN}>
          {candidate.name}
        </Text>
        <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED} as={TEXT_ELEMENT.SPAN}>
          {candidateLine(candidate)}
        </Text>
      </Stack>
    </Checkbox>
  );
}

/**
 * What a repository holds, each skill with its box, and first the names
 * asked for that it does not hold: the part of the card that gives way and
 * scrolls. Note that the missing names scroll with the skills, because a
 * paste may name any number of them and a line that long would push the
 * card's foot off the window.
 */
function SourcePreview({
  preview,
  ticked,
  disabled,
  onTick,
}: {
  preview: Extract<InstalledSkillPreview, { kind: typeof SKILL_PASTE_KIND.SOURCE }>;
  ticked: ReadonlySet<string>;
  disabled: boolean;
  onTick: (name: string, ticked: boolean) => void;
}): React.JSX.Element {
  const missing = missingLine(preview.missing);
  return (
    <ScrollArea size={SCROLL_SIZE.CONTENT} fade={SCROLL_FADE.BOTH}>
      <Stack gap={GAP.CONTROL} inset={INSET.RING} aria-label="Skills found">
        {missing === undefined ? null : (
          <span className="settings-state" data-state={LINE_STATE[DETECTED_TONE.PROBLEM]}>
            {missing}
          </span>
        )}
        {preview.skills.map((candidate) => (
          <CandidateRow
            key={candidate.path}
            candidate={candidate}
            ticked={ticked.has(candidate.name)}
            disabled={disabled}
            onTick={(tick) => onTick(candidate.name, tick)}
          />
        ))}
      </Stack>
    </ScrollArea>
  );
}

/** A skill's text's own fields where it lacks them, and what still keeps it from installing. */
function TextPreview({
  preview,
  fill,
  disabled,
  onFill,
}: {
  preview: Extract<InstalledSkillPreview, { kind: typeof SKILL_PASTE_KIND.TEXT }>;
  fill: TextFill;
  disabled: boolean;
  onFill: (fill: TextFill) => void;
}): React.JSX.Element {
  const asks = textFields(preview);
  const left = textProblems(preview.problems, fill);
  // Note that a field's own emptiness is said by the field, so only what it cannot say is listed.
  const shown = left.filter(
    (problem) =>
      !(asks.name && problem === INSTALLED_SKILL_PROBLEM.NAME_MISSING) &&
      !(asks.description && problem === INSTALLED_SKILL_PROBLEM.DESCRIPTION_MISSING),
  );
  return (
    <Stack gap={GAP.FIELD}>
      {asks.name ? (
        <FormField label="Name" description="Lowercase words joined by hyphens, such as pr-style.">
          {(field) => (
            <TextField
              field={field}
              value={fill.name}
              spellCheck={false}
              disabled={disabled}
              onChange={(name) => onFill({ ...fill, name })}
            />
          )}
        </FormField>
      ) : null}
      {asks.description ? (
        <FormField
          label="Description"
          description="Agents read this to know when to use the skill."
        >
          {(field) => (
            <TextField
              field={field}
              value={fill.description}
              disabled={disabled}
              onChange={(description) => onFill({ ...fill, description })}
            />
          )}
        </FormField>
      ) : null}
      {shown.length === 0 ? null : (
        <span className="settings-state" data-state={LINE_STATE[DETECTED_TONE.PROBLEM]}>
          {problemsLine(shown)}
        </span>
      )}
    </Stack>
  );
}

/** The dialog Settings › Skills' Add skill opens, over the workspace the page shows. */
export function AddSkillDialog({
  workspace,
  onInstalled,
  onClose,
  pause = rendererPause,
}: {
  workspace: Workspace;
  /** The skills an install made, for the page to list. */
  onInstalled: (skills: readonly InstalledSkillSummary[]) => void;
  onClose: () => void;
  /** The wait before a preview, the renderer's own where none is handed in. */
  pause?: (ms: number) => Promise<void>;
}): React.JSX.Element {
  const { act } = useAct();
  const [text, setText] = useState("");
  const [previewed, setPreviewed] = useState<Previewed | undefined>(undefined);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const [fill, setFill] = useState<TextFill>(EMPTY_FILL);
  const [scope, setScope] = useState<InstalledSkillScope>(INSTALLED_SKILL_SCOPE.PERSONAL);
  const [installing, setInstalling] = useState(false);
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const paste = useMemo(() => parseSkillPaste(text), [text]);
  const scopes = installScopes(workspace);

  // Note that only a source or a skill's text goes to the service: an empty or unsupported box says all there is at once.
  const asks = paste.kind === SKILL_PASTE_KIND.SOURCE || paste.kind === SKILL_PASTE_KIND.TEXT;
  useEffect(() => {
    if (!asks) return;
    let current = true;
    void pause(PREVIEW_PAUSE_MS)
      .then(() =>
        current
          ? act(ACT_KIND.INSTALLED_SKILLS_PREVIEW, { workspaceId: workspace.id, text })
          : undefined,
      )
      .catch(() => undefined)
      .then((view) => {
        if (!current || view === undefined) return;
        setPreviewed({ text, view });
        if (!("failure" in view)) setTicked(initialTicks(view));
      });
    return () => {
      current = false;
    };
  }, [act, asks, pause, text, workspace.id]);

  const view = asks && previewed?.text === text ? previewed.view : undefined;
  const preview = view === undefined || "failure" in view ? undefined : view;
  const line =
    view === undefined
      ? pastedLine(paste)
      : "failure" in view
        ? { text: failureLine(view), tone: DETECTED_TONE.PROBLEM }
        : previewLine(view);
  const request = installRequest({
    workspaceId: workspace.id,
    text,
    scope,
    preview,
    ticked,
    fill,
  });

  const install = () => {
    if (request === undefined || installing) return;
    setInstalling(true);
    setRefusal(undefined);
    void act(ACT_KIND.INSTALLED_SKILLS_INSTALL, request)
      .catch(() => undefined)
      .then((answer) => {
        setInstalling(false);
        if (answer === undefined)
          return setRefusal(failureLine({ failure: INSTALLED_SKILL_CALL_FAILURE.UNANSWERED }));
        if ("failure" in answer) {
          // Note that a skill whose files were refused is marked where it is listed, and can no longer be ticked.
          setPreviewed((held) =>
            held === undefined || "failure" in held.view
              ? held
              : { ...held, view: withRefusal(held.view, answer) },
          );
          return setRefusal(failureLine(answer));
        }
        onInstalled(answer.skills);
        onClose();
      });
  };

  return (
    <Dialog
      title="Add skill"
      size={DIALOG_SIZE.WIDE}
      busy={installing}
      onDismiss={onClose}
      actions={
        <>
          <Button variant={BUTTON_VARIANT.QUIET} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={BUTTON_VARIANT.PRIMARY}
            disabled={request === undefined}
            busy={installing}
            busyLabel="Installing"
            onClick={install}
          >
            Install
          </Button>
        </>
      }
    >
      {/* Note that the card's parts are its own flex items, so the box and its line stay at its head, the found skills and the names missing among them give way and scroll, and Install for stays above the answers however many a repository holds. */}
      <Stack gap={GAP.FIELD}>
        <FormField label={SKILLS_LINE.PASTE_LABEL} error={refusal}>
          {(field) => (
            <TextArea
              field={field}
              value={text}
              rows={4}
              grow
              font={TEXT_FIELD_FONT.MONO}
              spellCheck={false}
              autoFocus
              busy={installing}
              placeholder="npx skills add vercel-labs/agent-skills"
              onSubmit={install}
              onChange={(next) => {
                setText(next);
                // Note that what was typed beside one paste is never sent with another.
                if (next !== text) setFill(EMPTY_FILL);
                setRefusal(undefined);
              }}
            />
          )}
        </FormField>
        {line === undefined ? null : <DetectedText line={line} />}
      </Stack>
      {preview?.kind === SKILL_PASTE_KIND.SOURCE ? (
        <SourcePreview
          preview={preview}
          ticked={ticked}
          disabled={installing}
          onTick={(name, tick) => {
            const next = new Set(ticked);
            if (tick) next.add(name);
            else next.delete(name);
            setTicked(next);
          }}
        />
      ) : null}
      {preview?.kind === SKILL_PASTE_KIND.TEXT ? (
        <TextPreview preview={preview} fill={fill} disabled={installing} onFill={setFill} />
      ) : null}
      {scopes.length > 1 ? (
        <FormField label={SKILLS_LINE.INSTALL_FOR}>
          {() => (
            <ChoiceBar
              label={SKILLS_LINE.INSTALL_FOR}
              items={scopes.map((each) => ({ value: each.value, label: each.label }))}
              value={scope}
              look={CHOICE_BAR_LOOK.SEGMENTED}
              disabled={installing}
              onChange={setScope}
            />
          )}
        </FormField>
      ) : null}
    </Dialog>
  );
}
