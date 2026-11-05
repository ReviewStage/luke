import {
  type InstalledSkillCandidate,
  type InstalledSkillSummary,
  SKILL_PASTE_KIND,
} from "@repo/features/installed-skill-route-wire";
import {
  INSTALLED_SKILL_CALL_FAILURE,
  type InstalledSkillPreviewView,
} from "@repo/features/installed-skill-view";
import {
  INSTALLED_SKILL_SCOPE,
  type InstalledSkillScope,
} from "@repo/features/installed-skill-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import type { Workspace } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import {
  ANNOUNCE,
  BUTTON_VARIANT,
  Button,
  CHOICE_BAR_LOOK,
  Checkbox,
  ChoiceBar,
  DIALOG_SIZE,
  Dialog,
  ErrorState,
  FormField,
  GAP,
  GlyphSlot,
  INSET,
  Inline,
  SCROLL_FADE,
  SCROLL_SIZE,
  ScrollArea,
  SearchField,
  STATUS_TONE,
  Stack,
  TEXT_ELEMENT,
  TEXT_FIELD_FONT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  TextArea,
  TextField,
} from "@repo/ui";
import { useEffect, useRef, useState } from "react";
import { useAct } from "../act.js";
import { failureShown, refusedShown } from "../failure-report.js";
import { rendererPause } from "../renderer-runtime.js";
import { SkillMark } from "../tasks/skill-ref.js";
import { useAnnounceShown } from "../use-announce-shown.js";
import {
  candidateFacts,
  type DetectedLine,
  failureLine,
  initialTicks,
  installLabel,
  installRequest,
  installScopes,
  previewLine,
  previewRetries,
  SKILLS_LINE,
  searchesSkills,
  shownSkills,
  type TextFill,
  textFill,
} from "./skills-model.js";

/**
 * add-skill-dialog.tsx -- Settings › Skills' Add skill: one box that takes a GitHub repository, a link to one of its folders, an `npx skills add` line, or a skill's text, then what it would install, and Install.
 *
 * A short pause after the box last changed, the service previews it. A
 * GitHub source's skills are one list to tick, with a search once it is
 * long, the skills the paste named or the one skill there is ticked as it
 * lands; a skill's text is its name and the description agents read, both
 * filled from its frontmatter and both the member's to change. Install for
 * stands at the foot's start and the button names what Install will do; a
 * refusal is said under the box in plain words.
 */

/** How long the box stands still before the service previews it. */
const PREVIEW_PAUSE_MS = 400;

/** How the line under the box is drawn: a problem in the attention tint, or plain while it waits. */
const LINE_STATE = {
  [STATUS_TONE.ATTENTION]: "attention",
  [STATUS_TONE.NEUTRAL]: "plain",
} as const satisfies Record<DetectedLine["tone"], string>;

/** The service's preview as the dialog holds it: of which text, and what it answered. */
interface Previewed {
  readonly text: string;
  readonly view: InstalledSkillPreviewView;
}

/** A line in its tone's tint, announced as it lands and as it changes: an alert where it needs a hand. */
function DetectedText({ line }: { line: DetectedLine }): React.JSX.Element {
  useAnnounceShown(
    line.tone === STATUS_TONE.ATTENTION ? ANNOUNCE.ALERT : ANNOUNCE.POLITE,
    line.text,
  );
  return (
    <span className="settings-state" data-state={LINE_STATE[line.tone]}>
      {line.text}
    </span>
  );
}

/** One found skill to tick: its name, its description, and where it is and how large. */
function SkillOption({
  candidate,
  ticked,
  disabled,
  onTick,
}: {
  candidate: InstalledSkillCandidate;
  ticked: boolean;
  disabled: boolean;
  onTick: (name: string, on: boolean) => void;
}): React.JSX.Element {
  return (
    <Checkbox checked={ticked} disabled={disabled} onChange={(on) => onTick(candidate.name, on)}>
      <Stack gap={GAP.NONE}>
        <Inline gap={GAP.ICON}>
          <GlyphSlot>
            <SkillMark />
          </GlyphSlot>
          <Text variant={TEXT_VARIANT.LABEL} as={TEXT_ELEMENT.SPAN}>
            {candidate.name}
          </Text>
        </Inline>
        {candidate.description === undefined ? null : (
          <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED} as={TEXT_ELEMENT.SPAN}>
            {candidate.description}
          </Text>
        )}
        <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED} as={TEXT_ELEMENT.SPAN}>
          {candidateFacts(candidate)}
        </Text>
      </Stack>
    </Checkbox>
  );
}

/** A skill's text's name and description, filled from its frontmatter and the member's to change. */
function TextFields({
  fill,
  disabled,
  onFill,
}: {
  fill: TextFill;
  disabled: boolean;
  onFill: (fill: TextFill) => void;
}): React.JSX.Element {
  return (
    <Stack gap={GAP.FIELD}>
      <FormField label={SKILLS_LINE.NAME} description={SKILLS_LINE.NAME_HINT}>
        {(field) => (
          <TextField
            field={field}
            value={fill.name}
            autoCorrect={false}
            spellCheck={false}
            disabled={disabled}
            onChange={(name) => onFill({ ...fill, name })}
          />
        )}
      </FormField>
      <FormField label={SKILLS_LINE.WHEN}>
        {(field) => (
          <TextArea
            field={field}
            value={fill.description}
            rows={2}
            grow
            disabled={disabled}
            onChange={(description) => onFill({ ...fill, description })}
          />
        )}
      </FormField>
    </Stack>
  );
}

/** The dialog Settings › Skills' Add skill opens, over the workspace the page shows. */
export function AddSkillDialog({
  open = true,
  workspace,
  onInstalled,
  onClose,
  onExited,
  pause = rendererPause,
}: {
  /** Whether the card stands; falling, it fades out, then tells its owner it is gone. Standing while mounted where it is left out. */
  open?: boolean | undefined;
  workspace: Workspace;
  /** The skills an install made, in the order asked. */
  onInstalled: (skills: readonly InstalledSkillSummary[]) => void;
  onClose: () => void;
  /** Its fade has run and it is gone, which its owner takes it out on. */
  onExited?: (() => void) | undefined;
  /** The wait before a preview, the renderer's own where none is handed in. */
  pause?: (ms: number) => Promise<void>;
}): React.JSX.Element {
  const { act } = useAct();
  const [text, setText] = useState("");
  const [previewed, setPreviewed] = useState<Previewed | undefined>(undefined);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const [fill, setFill] = useState<TextFill>(() => textFill(undefined));
  const [scope, setScope] = useState<InstalledSkillScope>(INSTALLED_SKILL_SCOPE.PERSONAL);
  const [query, setQuery] = useState("");
  const [installing, setInstalling] = useState(false);
  // Note that Retry asks again by changing this, which the preview's effect reads.
  const [attempt, setAttempt] = useState(0);
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const box = useRef<HTMLTextAreaElement | null>(null);
  const scopes = installScopes(workspace);

  const asks = text.trim() !== "";
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
      .then((answer) => {
        if (!current) return;
        // Note that a call with no answer is a failed preview, so the line under the box stops reading.
        const view = answer ?? { failure: INSTALLED_SKILL_CALL_FAILURE.UNANSWERED };
        setPreviewed({ text, view });
        if ("failure" in view) return;
        setTicked(initialTicks(view));
        setFill(textFill(view));
        setQuery("");
      });
    return () => {
      current = false;
    };
  }, [act, asks, attempt, pause, text, workspace.id]);

  const view = asks && previewed?.text === text ? previewed.view : undefined;
  const preview = view === undefined || "failure" in view ? undefined : view;
  const skills = preview?.kind === SKILL_PASTE_KIND.SOURCE ? preview.skills : [];
  const shown = shownSkills(skills, query);
  const line = asks ? previewLine(view) : undefined;
  const failed = view !== undefined && "failure" in view ? view : undefined;
  const request = installRequest({
    workspaceId: workspace.id,
    text,
    scope,
    preview,
    ticked,
    fill,
  });
  const label = installLabel(
    request?.skills ?? (request?.name === undefined ? [] : [request.name]),
  );

  const tick = (name: string, on: boolean) => {
    const next = new Set(ticked);
    if (on) next.add(name);
    else next.delete(name);
    setTicked(next);
  };

  const install = () => {
    if (request === undefined || installing) return;
    setInstalling(true);
    setRefusal(undefined);
    void act(ACT_KIND.INSTALLED_SKILLS_INSTALL, request)
      .catch(() => undefined)
      .then((answer) => {
        setInstalling(false);
        if (answer === undefined) {
          return setRefusal(failureLine({ failure: INSTALLED_SKILL_CALL_FAILURE.UNANSWERED }));
        }
        if ("failure" in answer) return setRefusal(failureLine(answer));
        onInstalled(answer.skills);
        onClose();
      });
  };

  return (
    <Dialog
      open={open}
      title={SKILLS_LINE.ADD_SKILL}
      size={DIALOG_SIZE.WIDE}
      busy={installing}
      holding={asks}
      initialFocus={box}
      onDismiss={onClose}
      onExited={onExited}
      actionsStart={
        scopes.length > 1 ? (
          <ChoiceBar
            label={SKILLS_LINE.INSTALL_FOR}
            items={scopes.map((each) => ({ value: each.value, label: each.label }))}
            value={scope}
            look={CHOICE_BAR_LOOK.SEGMENTED}
            disabled={installing}
            onChange={setScope}
          />
        ) : undefined
      }
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
            {label}
          </Button>
        </>
      }
    >
      {/* Note that the card's parts are its own flex items, so the box stays at its head, what it would install gives way and scrolls, and Install for stays at the foot however many skills a repository holds. */}
      <Stack gap={GAP.FIELD}>
        <FormField
          label={SKILLS_LINE.PASTE_LABEL}
          description={SKILLS_LINE.PASTE_HINT}
          error={refusedShown(refusal, FAILURE_SURFACE.SKILL_ADD)}
        >
          {(field) => (
            <TextArea
              field={field}
              value={text}
              rows={4}
              grow
              font={TEXT_FIELD_FONT.MONO}
              spellCheck={false}
              ref={box}
              autoFocus
              busy={installing}
              placeholder="npx skills add vercel-labs/agent-skills --skill frontend-design"
              onChange={(next) => {
                setText(next);
                setRefusal(undefined);
              }}
            />
          )}
        </FormField>
        {line === undefined ? null : failed !== undefined && previewRetries(failed) ? (
          <ErrorState
            failure={failureShown({ surface: FAILURE_SURFACE.SKILL_PREVIEW, cause: failed })}
            onRetry={() => {
              setPreviewed(undefined);
              setAttempt((was) => was + 1);
            }}
          >
            {line.text}
          </ErrorState>
        ) : (
          <DetectedText line={line} />
        )}
        {searchesSkills(skills) ? (
          <SearchField
            label={SKILLS_LINE.SEARCH}
            placeholder={SKILLS_LINE.SEARCH}
            value={query}
            onChange={setQuery}
            onClear={() => setQuery("")}
          />
        ) : null}
      </Stack>
      {preview === undefined || line !== undefined ? null : (
        <ScrollArea size={SCROLL_SIZE.CONTENT} fade={SCROLL_FADE.BOTH}>
          <Stack gap={GAP.CONTROL} inset={INSET.RING} aria-label="Skills to install">
            {preview.kind === SKILL_PASTE_KIND.TEXT ? (
              <TextFields fill={fill} disabled={installing} onFill={setFill} />
            ) : shown.length === 0 ? (
              <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
                {SKILLS_LINE.NO_MATCH}
              </Text>
            ) : (
              shown.map((candidate) => (
                <SkillOption
                  key={candidate.path}
                  candidate={candidate}
                  ticked={ticked.has(candidate.name)}
                  disabled={installing}
                  onTick={tick}
                />
              ))
            )}
          </Stack>
        </ScrollArea>
      )}
    </Dialog>
  );
}
