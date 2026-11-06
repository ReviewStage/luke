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
import { ReplayMask, ReplayUnmask, ReplayWords } from "@repo/ui/session-replay-marks";
import { queryOptions, type UseQueryResult, useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { askAct } from "../act.js";
import { actMutation } from "../act-mutations.js";
import { failureShown, refusedShown } from "../failure-report.js";
import { QUERY_ROOT } from "../query-keys.js";
import { rendererPause } from "../renderer-runtime.js";
import { SkillMark } from "../tasks/skill-ref.js";
import { useAnnounceShown } from "../use-announce-shown.js";
import { replayMaskedError } from "./marks.js";
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

const PREVIEW_PAUSE_MS = 400;

const LINE_STATE = {
  [STATUS_TONE.ATTENTION]: "attention",
  [STATUS_TONE.NEUTRAL]: "plain",
} as const satisfies Record<DetectedLine["tone"], string>;

function skillPreviewQueryOptions(workspaceId: string, text: string) {
  return queryOptions({
    queryKey: [QUERY_ROOT.INSTALLED_SKILL_PREVIEW, workspaceId, text],
    queryFn: () => askAct(ACT_KIND.INSTALLED_SKILLS_PREVIEW, { workspaceId, text }),
    retry: false,
  });
}

function previewView(
  previewed: UseQueryResult<InstalledSkillPreviewView>,
): InstalledSkillPreviewView | undefined {
  if (previewed.isPending || previewed.isFetching) return undefined;
  if (previewed.isError) return { failure: INSTALLED_SKILL_CALL_FAILURE.UNANSWERED };
  return previewed.data;
}

function DetectedText({ line }: { line: DetectedLine }): React.JSX.Element {
  useAnnounceShown(
    line.tone === STATUS_TONE.ATTENTION ? ANNOUNCE.ALERT : ANNOUNCE.POLITE,
    line.text,
  );
  return (
    <span className="settings-state" data-state={LINE_STATE[line.tone]}>
      <ReplayMask>{line.text}</ReplayMask>
    </span>
  );
}

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
            <ReplayMask>{candidate.name}</ReplayMask>
          </Text>
        </Inline>
        {candidate.description === undefined ? null : (
          <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED} as={TEXT_ELEMENT.SPAN}>
            <ReplayMask>{candidate.description}</ReplayMask>
          </Text>
        )}
        <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED} as={TEXT_ELEMENT.SPAN}>
          <ReplayMask>{candidateFacts(candidate)}</ReplayMask>
        </Text>
      </Stack>
    </Checkbox>
  );
}

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

export function AddSkillDialog({
  open = true,
  workspace,
  onInstalled,
  onClose,
  onExited,
  pause = rendererPause,
}: {
  open?: boolean | undefined;
  workspace: Workspace;
  onInstalled: (skills: readonly InstalledSkillSummary[]) => void;
  onClose: () => void;
  onExited?: (() => void) | undefined;
  pause?: (ms: number) => Promise<void>;
}): React.JSX.Element {
  const { mutateAsync: sendInstalledSkillsInstall } = useMutation(
    actMutation(ACT_KIND.INSTALLED_SKILLS_INSTALL),
  );
  const [text, setText] = useState("");
  const [settled, setSettled] = useState<string | undefined>(undefined);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const [fill, setFill] = useState<TextFill>(() => textFill(undefined));
  const [scope, setScope] = useState<InstalledSkillScope>(INSTALLED_SKILL_SCOPE.PERSONAL);
  const [query, setQuery] = useState("");
  const [installing, setInstalling] = useState(false);
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const box = useRef<HTMLTextAreaElement | null>(null);
  const scopes = installScopes(workspace);

  const asks = text.trim() !== "";
  useEffect(() => {
    if (!asks) return;
    let current = true;
    void pause(PREVIEW_PAUSE_MS).then(() => {
      if (current) setSettled(text);
    });
    return () => {
      current = false;
    };
  }, [asks, pause, text]);
  const previewing = asks && settled === text;
  const previewed = useQuery({
    ...skillPreviewQueryOptions(workspace.id, text),
    enabled: previewing,
  });
  const view = previewing ? previewView(previewed) : undefined;
  const [landedOn, setLandedOn] = useState<InstalledSkillPreviewView | undefined>(undefined);
  if (view !== undefined && !("failure" in view) && view !== landedOn) {
    setLandedOn(view);
    setTicked(initialTicks(view));
    setFill(textFill(view));
    setQuery("");
  }
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
  const toInstall = request?.skills ?? (request?.name === undefined ? [] : [request.name]);
  const label = installLabel(toInstall);

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
    void sendInstalledSkillsInstall(request)
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
      replayUnmasked
      busy={installing}
      holding={asks}
      initialFocus={box}
      onDismiss={onClose}
      onExited={onExited}
      actionsStart={
        scopes.length > 1 ? (
          <ReplayUnmask>
            <ChoiceBar
              label={SKILLS_LINE.INSTALL_FOR}
              items={scopes.map((each) => ({
                value: each.value,
                label: each.label,
                replayMasked: each.value === INSTALLED_SKILL_SCOPE.WORKSPACE,
              }))}
              value={scope}
              look={CHOICE_BAR_LOOK.SEGMENTED}
              disabled={installing}
              onChange={setScope}
            />
          </ReplayUnmask>
        ) : undefined
      }
      actions={
        <>
          <Button variant={BUTTON_VARIANT.QUIET} onClick={onClose}>
            <ReplayUnmask>Cancel</ReplayUnmask>
          </Button>
          <Button
            variant={BUTTON_VARIANT.PRIMARY}
            disabled={request === undefined}
            busy={installing}
            busyLabel="Installing"
            onClick={install}
          >
            <ReplayWords unmasked={toInstall.length !== 1}>{label}</ReplayWords>
          </Button>
        </>
      }
    >
      <Stack gap={GAP.FIELD}>
        <FormField
          label={SKILLS_LINE.PASTE_LABEL}
          description={SKILLS_LINE.PASTE_HINT}
          error={replayMaskedError(refusedShown(refusal, FAILURE_SURFACE.SKILL_ADD))}
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
            onRetry={() => void previewed.refetch()}
          >
            <ReplayMask>{line.text}</ReplayMask>
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
