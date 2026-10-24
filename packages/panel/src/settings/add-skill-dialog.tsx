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
import { countWords, TERM } from "@luke/features/words";
import type { Workspace } from "@luke/features/workspace-wire";
import { ACT_KIND } from "@luke/host/acts";
import {
  ALIGN,
  BADGE_TONE,
  Badge,
  type BadgeTone,
  BUTTON_VARIANT,
  Button,
  CARD_LOOK,
  CARD_PADDING,
  Card,
  CHOICE_BAR_LOOK,
  Checkbox,
  ChoiceBar,
  DIALOG_SIZE,
  Dialog,
  FILE_TEXT_EXTENT,
  FileText,
  FormField,
  GAP,
  GlyphSlot,
  INSET,
  Inline,
  JUSTIFY,
  SCROLL_FADE,
  SCROLL_SIZE,
  ScrollArea,
  SearchField,
  Spinner,
  Stack,
  TEXT_BUTTON_TONE,
  TEXT_ELEMENT,
  TEXT_FIELD_FONT,
  TEXT_FONT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  TextArea,
  TextButton,
  TextField,
} from "@luke/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAct } from "../act.js";
import { rendererPause } from "../renderer-runtime.js";
import { SkillMark } from "../tasks/skill-ref.js";
import {
  ADD_SKILL_SCREEN,
  addSkillScreen,
  addSkillTitle,
  auditParts,
  candidateFacts,
  candidateMarks,
  candidateNote,
  confirmView,
  DETECTED_TONE,
  type DetectedLine,
  type DetectedTone,
  everyTicked,
  failureLine,
  initialTicks,
  installable,
  installLabel,
  installPlan,
  installRequest,
  installScopes,
  missingLine,
  othersLine,
  type PulledSkill,
  pastedAtOnce,
  pastedLine,
  previewLine,
  previewSourceLine,
  problemsLine,
  pulledLine,
  SKILL_MARK_TONE,
  SKILLS_LINE,
  type SkillListGroup,
  type SkillMarkTone,
  type SkillTicks,
  skillList,
  type TextDeclares,
  type TextFill,
  textDeclares,
  textFill,
  textProblems,
  withEvery,
  withRefusal,
  withTick,
} from "./skills-model.js";

/**
 * add-skill-dialog.tsx -- Settings › Skills' Add skill: one box that takes an `npx skills add` command, a GitHub link, or a skill's text, then what it would install, and Install.
 *
 * The box is read the moment it changes (`parseSkillPaste`), so the line
 * under it says at once whether it is a GitHub repository, a skill's text,
 * or something Luke does not install from. A short pause after the last
 * keystroke the service previews it, and a paste folds the box into one
 * line naming where the skills come from, with Change to open it again.
 * What follows is `npx skills add`'s own choice: a paste that named skills,
 * or a repository holding one, is confirmed as a card for each, with the
 * sibling skills each hands off to coming along ticked; one that named
 * none, every one, or one the repository lacks is browsed, searched and
 * ticked by hand. Each skill says where a skill of its name already stands
 * in the scope chosen, whether it ships scripts, and skills.sh's ratings,
 * and opens its `SKILL.md` in place. Text shows its name and the
 * description agents read, the member's to type where the text lacks them.
 * Install for stands at the foot's start and the button names what Install
 * will do; it sends the paste again whole, as the service reads it afresh,
 * and a refusal is said in plain words.
 */

/** How long the box stands still before the service previews it. */
const PREVIEW_PAUSE_MS = 400;

/** How the line under the box is drawn: understood with its dot, a problem in the attention tint, or plain while it waits. */
const LINE_STATE = {
  [DETECTED_TONE.DETECTED]: "connected",
  [DETECTED_TONE.PROBLEM]: "attention",
  [DETECTED_TONE.WAITING]: "plain",
} as const satisfies Record<DetectedTone, string>;

/** The badge each mark wears. */
const MARK_BADGE = {
  [SKILL_MARK_TONE.NEUTRAL]: BADGE_TONE.NEUTRAL,
  [SKILL_MARK_TONE.COMPLETE]: BADGE_TONE.COMPLETE,
  [SKILL_MARK_TONE.WORKING]: BADGE_TONE.WORKING,
  [SKILL_MARK_TONE.ATTENTION]: BADGE_TONE.ATTENTION,
} as const satisfies Record<SkillMarkTone, BadgeTone>;

/** The service's preview as the dialog holds it: of which text, and what it answered. */
interface Previewed {
  readonly text: string;
  readonly view: InstalledSkillPreviewView;
}

/** A `SKILL.md` the preview carried none of, as its read stands. */
type FileRead =
  | { readonly reading: true }
  | { readonly markdown: string }
  | { readonly failed: string };

/** Each found skill's `SKILL.md` as the dialog shows it: opened or not, and what was read for it. */
interface SkillFiles {
  readonly opened: ReadonlySet<string>;
  readonly read: ReadonlyMap<string, FileRead>;
  readonly onView: (candidate: InstalledSkillCandidate) => void;
}

/** What every found skill's card and row is drawn against. */
interface SkillContext {
  readonly scope: InstalledSkillScope;
  readonly workspace: Workspace;
  readonly files: SkillFiles;
  readonly disabled: boolean;
}

/** A line in its tone's tint, announced as it changes. */
function DetectedText({ line }: { line: DetectedLine }): React.JSX.Element {
  return (
    <span className="settings-state" data-state={LINE_STATE[line.tone]} role="status">
      {line.text}
    </span>
  );
}

/** A found skill's name, or the words standing for it, and the marks beside it, its high and critical ratings among them where `ratings`. */
function SkillName({
  candidate,
  context,
  ratings,
  title = candidate.name,
}: {
  candidate: InstalledSkillCandidate;
  context: SkillContext;
  ratings: boolean;
  title?: string;
}): React.JSX.Element {
  const marks = candidateMarks(candidate, context.scope, context.workspace);
  const warnings = ratings ? auditParts(candidate).filter((part) => part.warn) : [];
  return (
    <Inline gap={GAP.ICON}>
      <GlyphSlot>
        <SkillMark />
      </GlyphSlot>
      <Text variant={TEXT_VARIANT.LABEL} as={TEXT_ELEMENT.SPAN}>
        {title}
      </Text>
      {marks.map((mark) => (
        <Badge key={mark.text} tone={MARK_BADGE[mark.tone]}>
          {mark.text}
        </Badge>
      ))}
      {warnings.map((part) => (
        <Badge key={part.text} tone={BADGE_TONE.ATTENTION}>
          {part.text}
        </Badge>
      ))}
    </Inline>
  );
}

/** skills.sh's ratings, muted, a high or critical one marked as a warning; nothing where there are none. */
function AuditLine({
  candidate,
}: {
  candidate: InstalledSkillCandidate;
}): React.JSX.Element | null {
  const parts = auditParts(candidate);
  if (parts.length === 0) return null;
  return (
    <Inline gap={GAP.ICON} aria-label="skills.sh ratings">
      {parts.map((part, index) => (
        <Inline key={part.text} gap={GAP.ICON}>
          {index === 0 ? null : (
            <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.SUBTLE} as={TEXT_ELEMENT.SPAN}>
              ·
            </Text>
          )}
          {part.warn ? (
            <Badge tone={BADGE_TONE.ATTENTION}>{part.text}</Badge>
          ) : (
            <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED} as={TEXT_ELEMENT.SPAN}>
              {part.text}
            </Text>
          )}
        </Inline>
      ))}
    </Inline>
  );
}

/** The words a found skill's View SKILL.md toggles between. */
function viewWords(candidate: InstalledSkillCandidate, files: SkillFiles): string {
  return files.opened.has(candidate.name)
    ? SKILLS_LINE.HIDE_SKILL_FILE
    : SKILLS_LINE.VIEW_SKILL_FILE;
}

/** A found skill's `SKILL.md` once opened: as the preview carried it, while it is read, or why it could not be. */
function SkillFile({
  candidate,
  files,
}: {
  candidate: InstalledSkillCandidate;
  files: SkillFiles;
}): React.JSX.Element | null {
  const read: FileRead | undefined =
    candidate.markdown === undefined
      ? files.read.get(candidate.name)
      : { markdown: candidate.markdown };
  if (!files.opened.has(candidate.name) || read === undefined) return null;
  if ("reading" in read) return <Spinner label={`Reading ${candidate.name}'s SKILL.md`} />;
  if ("failed" in read) {
    return <DetectedText line={{ text: read.failed, tone: DETECTED_TONE.PROBLEM }} />;
  }
  return <FileText text={read.markdown} label={`${candidate.name}'s SKILL.md`} />;
}

/** A found skill's facts, its View SKILL.md, and the file under them once opened. */
function SkillDetail({
  candidate,
  context,
}: {
  candidate: InstalledSkillCandidate;
  context: SkillContext;
}): React.JSX.Element {
  const { files } = context;
  const note = candidateNote(candidate, context.scope);
  return (
    <Stack gap={GAP.ITEM}>
      <Inline gap={GAP.CONTROL}>
        <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED} as={TEXT_ELEMENT.SPAN}>
          {candidateFacts(candidate)}
        </Text>
        <TextButton tone={TEXT_BUTTON_TONE.ACCENT} onClick={() => files.onView(candidate)}>
          {viewWords(candidate, files)}
        </TextButton>
      </Inline>
      <AuditLine candidate={candidate} />
      {note === undefined ? null : <DetectedText line={note} />}
      <SkillFile candidate={candidate} files={files} />
    </Stack>
  );
}

/** One skill the paste named, as a card to confirm. */
function SkillCard({
  candidate,
  context,
}: {
  candidate: InstalledSkillCandidate;
  context: SkillContext;
}): React.JSX.Element {
  return (
    <Card look={CARD_LOOK.OUTLINE} padding={CARD_PADDING.COMPACT}>
      <Stack gap={GAP.ITEM}>
        <SkillName candidate={candidate} context={context} ratings={false} />
        {candidate.description === undefined ? null : (
          <Text variant={TEXT_VARIANT.BODY} tone={TEXT_TONE.MUTED}>
            {candidate.description}
          </Text>
        )}
        <SkillDetail candidate={candidate} context={context} />
      </Stack>
    </Card>
  );
}

/** A skill a confirmed one hands off to, ticked to come along, and why. */
function PulledCard({
  pulled,
  install,
  context,
  onTick,
}: {
  pulled: PulledSkill;
  install: readonly string[];
  context: SkillContext;
  onTick: (name: string, on: boolean) => void;
}): React.JSX.Element {
  const { candidate } = pulled;
  const may = installable(candidate, context.scope);
  return (
    <Card look={CARD_LOOK.TINT} padding={CARD_PADDING.COMPACT}>
      <Stack gap={GAP.ITEM}>
        <Checkbox
          checked={may && install.includes(candidate.name)}
          disabled={context.disabled || !may}
          onChange={(on) => onTick(candidate.name, on)}
        >
          <Stack gap={GAP.NONE}>
            <SkillName
              candidate={candidate}
              context={context}
              ratings={false}
              title={`Also installing ${candidate.name}`}
            />
            <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED} as={TEXT_ELEMENT.SPAN}>
              {pulledLine(pulled)}
            </Text>
          </Stack>
        </Checkbox>
        <SkillDetail candidate={candidate} context={context} />
      </Stack>
    </Card>
  );
}

/** The confirm screen: a card for each skill the paste named, the skills they pull in, and a way to the rest. */
function ConfirmSkills({
  skills,
  install,
  pulled,
  context,
  onTick,
  onBrowse,
}: {
  skills: readonly InstalledSkillCandidate[];
  install: readonly string[];
  pulled: ReadonlyMap<string, string>;
  context: SkillContext;
  onTick: (name: string, on: boolean) => void;
  onBrowse: () => void;
}): React.JSX.Element {
  const shown = confirmView(skills, { install, pulled });
  return (
    <Stack gap={GAP.CONTROL} aria-label="Skills to install">
      {shown.cards.map((candidate) => (
        <SkillCard key={candidate.path} candidate={candidate} context={context} />
      ))}
      {shown.pulled.map((each) => (
        <PulledCard
          key={each.candidate.path}
          pulled={each}
          install={install}
          context={context}
          onTick={onTick}
        />
      ))}
      {shown.others === 0 ? null : (
        <Inline gap={GAP.ICON}>
          <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED} as={TEXT_ELEMENT.SPAN}>
            {`${othersLine(shown.others)} ·`}
          </Text>
          <TextButton tone={TEXT_BUTTON_TONE.ACCENT} onClick={onBrowse}>
            {SKILLS_LINE.BROWSE}
          </TextButton>
        </Inline>
      )}
    </Stack>
  );
}

/** One skill of the browse list: its box, its name and marks, its description on one line, who pulls it in, and its View SKILL.md beside the box. */
function SkillRow({
  candidate,
  install,
  ticks,
  pulledBy,
  context,
  onTick,
}: {
  candidate: InstalledSkillCandidate;
  install: readonly string[];
  ticks: SkillTicks;
  pulledBy: string | undefined;
  context: SkillContext;
  onTick: (name: string, on: boolean) => void;
}): React.JSX.Element {
  const may = installable(candidate, context.scope);
  const ticked = may && install.includes(candidate.name);
  const note = candidateNote(candidate, context.scope);
  const along = ticked && !ticks.ticked.has(candidate.name) && pulledBy !== undefined;
  const line = [candidate.description, along ? `with ${pulledBy}` : undefined]
    .filter((each) => each !== undefined)
    .join(" · ");
  return (
    <Stack gap={GAP.ITEM}>
      <Inline gap={GAP.CONTROL} align={ALIGN.START} wrap={false} growFirst>
        <Checkbox
          checked={ticked}
          disabled={context.disabled || !may}
          onChange={(on) => onTick(candidate.name, on)}
        >
          <Stack gap={GAP.NONE}>
            <SkillName candidate={candidate} context={context} ratings />
            {line === "" ? null : (
              <Text
                variant={TEXT_VARIANT.CAPTION}
                tone={TEXT_TONE.MUTED}
                as={TEXT_ELEMENT.SPAN}
                truncate
              >
                {line}
              </Text>
            )}
            {note === undefined ? null : (
              <span className="settings-state" data-state={LINE_STATE[note.tone]}>
                {note.text}
              </span>
            )}
          </Stack>
        </Checkbox>
        <TextButton tone={TEXT_BUTTON_TONE.LINK} onClick={() => context.files.onView(candidate)}>
          {viewWords(candidate, context.files)}
        </TextButton>
      </Inline>
      <SkillFile candidate={candidate} files={context.files} />
    </Stack>
  );
}

/** The browse screen's head, which stays put while the list scrolls: the search, and Select all over the skills it shows. */
function BrowseHead({
  count,
  query,
  shown,
  install,
  disabled,
  onQuery,
  onEvery,
}: {
  count: number;
  query: string;
  shown: readonly string[];
  install: readonly string[];
  disabled: boolean;
  onQuery: (query: string) => void;
  onEvery: (names: readonly string[], on: boolean) => void;
}): React.JSX.Element {
  const every = everyTicked(shown, install);
  return (
    <Stack gap={GAP.CONTROL}>
      <SearchField
        label={SKILLS_LINE.SEARCH}
        placeholder={`Search ${countWords(count, TERM.SKILL)}`}
        value={query}
        onChange={onQuery}
        onClear={() => onQuery("")}
      />
      <Checkbox
        checked={every.checked}
        mixed={every.mixed}
        disabled={disabled || shown.length === 0}
        onChange={() => onEvery(shown, !every.checked)}
      >
        {SKILLS_LINE.SELECT_ALL}
      </Checkbox>
    </Stack>
  );
}

/** The browse screen's list: the repository's skills the search shows, sorted by name, grouped where its plugins group them, after any name the paste asked for that it lacks. */
function BrowseSkills({
  preview,
  groups,
  install,
  ticks,
  pulled,
  context,
  onTick,
}: {
  preview: InstalledSkillPreview;
  groups: readonly SkillListGroup[];
  install: readonly string[];
  ticks: SkillTicks;
  pulled: ReadonlyMap<string, string>;
  context: SkillContext;
  onTick: (name: string, on: boolean) => void;
}): React.JSX.Element {
  const missing = missingLine(preview);
  return (
    <Stack gap={GAP.CONTROL}>
      {missing === undefined ? null : (
        <DetectedText line={{ text: missing, tone: DETECTED_TONE.PROBLEM }} />
      )}
      {groups.length === 0 ? (
        <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
          {SKILLS_LINE.NO_MATCH}
        </Text>
      ) : null}
      {groups.map((group) => (
        <Stack key={group.title ?? ""} gap={GAP.ITEM} aria-label={group.title ?? "Skills found"}>
          {group.title === undefined ? null : (
            <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.SUBTLE}>
              {`${group.title} · ${group.skills.length}`}
            </Text>
          )}
          {group.skills.map((candidate) => (
            <SkillRow
              key={candidate.path}
              candidate={candidate}
              install={install}
              ticks={ticks}
              pulledBy={pulled.get(candidate.name)}
              context={context}
              onTick={onTick}
            />
          ))}
        </Stack>
      ))}
    </Stack>
  );
}

/** A skill's text: its name and the description agents read, typed where the text lacks them, what still keeps it out, and a peek of the text. */
function TextSkill({
  preview,
  markdown,
  fill,
  declares,
  disabled,
  onFill,
}: {
  preview: Extract<InstalledSkillPreview, { kind: typeof SKILL_PASTE_KIND.TEXT }>;
  markdown: string;
  fill: TextFill;
  declares: TextDeclares;
  disabled: boolean;
  onFill: (fill: TextFill) => void;
}): React.JSX.Element {
  const left = textProblems(preview.problems, fill, declares);
  // Note that an empty field says so itself, so only what it cannot say is listed.
  const shown = left.filter(
    (problem) =>
      problem !== INSTALLED_SKILL_PROBLEM.NAME_MISSING &&
      problem !== INSTALLED_SKILL_PROBLEM.DESCRIPTION_MISSING,
  );
  return (
    <Card look={CARD_LOOK.OUTLINE} padding={CARD_PADDING.COMPACT}>
      <Stack gap={GAP.FIELD}>
        <FormField
          label={SKILLS_LINE.NAME}
          description={
            declares.name
              ? SKILLS_LINE.DECLARED
              : "Lowercase words joined by hyphens, such as pr-style."
          }
        >
          {(field) => (
            <TextField
              field={field}
              value={fill.name}
              spellCheck={false}
              readOnly={declares.name}
              disabled={disabled}
              onChange={(name) => onFill({ ...fill, name })}
            />
          )}
        </FormField>
        <FormField
          label={SKILLS_LINE.WHEN}
          description={declares.description ? SKILLS_LINE.DECLARED : undefined}
        >
          {(field) => (
            <TextArea
              field={field}
              value={fill.description}
              rows={2}
              grow
              readOnly={declares.description}
              disabled={disabled}
              onChange={(description) => onFill({ ...fill, description })}
            />
          )}
        </FormField>
        {shown.length === 0 ? null : (
          <DetectedText line={{ text: problemsLine(shown), tone: DETECTED_TONE.PROBLEM }} />
        )}
        <FileText text={markdown} label="Pasted text" extent={FILE_TEXT_EXTENT.PEEK} />
      </Stack>
    </Card>
  );
}

/** The one line the box folds into: where the skills come from, and Change or Edit to open the box again. */
function SourceRow({
  line,
  action,
  disabled,
  onOpen,
}: {
  line: string;
  action: string;
  disabled: boolean;
  onOpen: () => void;
}): React.JSX.Element {
  return (
    <Card look={CARD_LOOK.WELL} padding={CARD_PADDING.SNUG}>
      <Inline justify={JUSTIFY.BETWEEN} wrap={false}>
        <Text variant={TEXT_VARIANT.CAPTION} font={TEXT_FONT.MONO} as={TEXT_ELEMENT.SPAN} truncate>
          {line}
        </Text>
        {disabled ? null : (
          <TextButton tone={TEXT_BUTTON_TONE.ACCENT} onClick={onOpen}>
            {action}
          </TextButton>
        )}
      </Inline>
    </Card>
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
  /** The skills an install made, in the order asked: the ones named, then those they pull in. */
  onInstalled: (skills: readonly InstalledSkillSummary[]) => void;
  onClose: () => void;
  /** The wait before a preview, the renderer's own where none is handed in. */
  pause?: (ms: number) => Promise<void>;
}): React.JSX.Element {
  const { act } = useAct();
  const [text, setText] = useState("");
  const [previewed, setPreviewed] = useState<Previewed | undefined>(undefined);
  const [ticks, setTicks] = useState<SkillTicks>(() => initialTicks(undefined));
  const [fill, setFill] = useState<TextFill>(() => textFill(undefined));
  const [scope, setScope] = useState<InstalledSkillScope>(INSTALLED_SKILL_SCOPE.PERSONAL);
  const [editing, setEditing] = useState(true);
  const [browsing, setBrowsing] = useState(false);
  const [query, setQuery] = useState("");
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const [read, setRead] = useState<ReadonlyMap<string, FileRead>>(new Map());
  const [installing, setInstalling] = useState(false);
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  // Note that only a change that came at once folds the box, so a skill typed by hand keeps its box while the writer pauses.
  const pasted = useRef(false);
  const paste = useMemo(() => parseSkillPaste(text), [text]);
  const declares = useMemo(() => textDeclares(paste), [paste]);
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
        if ("failure" in view) return;
        setTicks(initialTicks(view));
        setFill(textFill(view));
        setBrowsing(false);
        setQuery("");
        setOpened(new Set());
        setRead(new Map());
        const folds =
          view.kind === SKILL_PASTE_KIND.TEXT ||
          (view.kind === SKILL_PASTE_KIND.SOURCE && view.skills.length > 0);
        if (folds && pasted.current) setEditing(false);
      });
    return () => {
      current = false;
    };
  }, [act, asks, pause, text, workspace.id]);

  const view = asks && previewed?.text === text ? previewed.view : undefined;
  const preview = view === undefined || "failure" in view ? undefined : view;
  const screen = addSkillScreen(preview, paste, browsing);
  const skills = preview?.kind === SKILL_PASTE_KIND.SOURCE ? preview.skills : [];
  const plan = installPlan(skills, ticks, scope);
  const groups = screen === ADD_SKILL_SCREEN.BROWSE ? skillList(skills, query) : [];
  const shown = groups
    .flatMap((group) => group.skills)
    .filter((each) => installable(each, scope))
    .map((each) => each.name);
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
    install: plan.install,
    fill,
    declares,
  });
  const label =
    preview?.kind === SKILL_PASTE_KIND.TEXT
      ? installLabel(fill.name.trim() === "" ? [] : [fill.name.trim()])
      : installLabel(plan.install);

  const tick = (name: string, on: boolean) => setTicks(withTick(skills, ticks, scope, name, on));

  const viewFile = (candidate: InstalledSkillCandidate) => {
    const next = new Set(opened);
    if (next.has(candidate.name)) next.delete(candidate.name);
    else next.add(candidate.name);
    setOpened(next);
    // Note that a read that failed is asked again, since what failed it may have passed.
    const held = read.get(candidate.name);
    const fetched = candidate.markdown !== undefined || (held !== undefined && !("failed" in held));
    if (fetched || preview?.kind !== SKILL_PASTE_KIND.SOURCE) return;
    const { name } = candidate;
    const sought = { owner: preview.owner, repo: preview.repo, sha: preview.sha };
    setRead((held) => new Map(held).set(name, { reading: true }));
    void act(ACT_KIND.INSTALLED_SKILLS_PREVIEW_FILE, {
      workspaceId: workspace.id,
      ...sought,
      path: candidate.path,
    })
      .catch(() => undefined)
      .then((answer) => {
        const got: FileRead =
          answer === undefined
            ? { failed: failureLine({ failure: INSTALLED_SKILL_CALL_FAILURE.UNANSWERED }) }
            : "failure" in answer
              ? { failed: failureLine(answer) }
              : { markdown: answer.markdown };
        setRead((held) => new Map(held).set(name, got));
      });
  };

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

  const context: SkillContext = {
    scope,
    workspace,
    files: { opened, read, onView: viewFile },
    disabled: installing,
  };
  const folded = !editing && preview !== undefined && screen !== ADD_SKILL_SCREEN.PASTE;

  return (
    <Dialog
      title={addSkillTitle(screen, preview)}
      size={DIALOG_SIZE.WIDE}
      busy={installing}
      onDismiss={onClose}
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
      {/* Note that the card's parts are its own flex items, so the box or its folded line stays at its head, what it would install gives way and scrolls, and Install for stays at the foot however many skills a repository holds. */}
      <Stack gap={GAP.FIELD}>
        {folded ? (
          <SourceRow
            line={previewSourceLine(screen, preview)}
            action={screen === ADD_SKILL_SCREEN.TEXT ? SKILLS_LINE.EDIT : SKILLS_LINE.CHANGE}
            disabled={installing}
            onOpen={() => setEditing(true)}
          />
        ) : (
          <FormField
            label={SKILLS_LINE.PASTE_LABEL}
            description={SKILLS_LINE.PASTE_HINT}
            error={refusal}
          >
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
                placeholder="npx skills add mattpocock/skills --skill grill-me"
                onSubmit={install}
                onChange={(next) => {
                  pasted.current = pastedAtOnce(text, next);
                  setText(next);
                  setRefusal(undefined);
                }}
              />
            )}
          </FormField>
        )}
        {folded || line === undefined ? null : <DetectedText line={line} />}
        {screen === ADD_SKILL_SCREEN.BROWSE ? (
          <BrowseHead
            count={skills.length}
            query={query}
            shown={shown}
            install={plan.install}
            disabled={installing}
            onQuery={setQuery}
            onEvery={(names, on) => setTicks(withEvery(skills, ticks, scope, names, on))}
          />
        ) : null}
        {folded && refusal !== undefined ? (
          <span
            className="settings-state"
            data-state={LINE_STATE[DETECTED_TONE.PROBLEM]}
            role="alert"
          >
            {refusal}
          </span>
        ) : null}
      </Stack>
      {screen === ADD_SKILL_SCREEN.PASTE ? null : (
        <ScrollArea size={SCROLL_SIZE.CONTENT} fade={SCROLL_FADE.BOTH}>
          <Stack gap={GAP.CONTROL} inset={INSET.RING}>
            {screen === ADD_SKILL_SCREEN.CONFIRM ? (
              <ConfirmSkills
                skills={skills}
                install={plan.install}
                pulled={plan.pulled}
                context={context}
                onTick={tick}
                onBrowse={() => setBrowsing(true)}
              />
            ) : null}
            {screen === ADD_SKILL_SCREEN.BROWSE && preview !== undefined ? (
              <BrowseSkills
                preview={preview}
                groups={groups}
                install={plan.install}
                ticks={ticks}
                pulled={plan.pulled}
                context={context}
                onTick={tick}
              />
            ) : null}
            {preview?.kind === SKILL_PASTE_KIND.TEXT && paste.kind === SKILL_PASTE_KIND.TEXT ? (
              <TextSkill
                preview={preview}
                markdown={paste.markdown}
                fill={fill}
                declares={declares}
                disabled={installing}
                onFill={setFill}
              />
            ) : null}
          </Stack>
        </ScrollArea>
      )}
    </Dialog>
  );
}
