import {
  holdsSlashWord,
  type SkillOption,
  skillTokens,
  skillWord,
  type TextRange,
} from "@luke/ui/skill-mention";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Components, ExtraProps } from "streamdown";
import type { SkillSource } from "./skill-picker.js";
import { SkillRef, type SkillSubject } from "./skill-ref.js";
import { type TranscriptElement, TranscriptWords } from "./transcript-blocks.js";

/**
 * skill-chip.tsx -- a skill named in a sent message, drawn as the composer draws a chosen one, which opens the skill's `SKILL.md` in a File tab.
 *
 * A message the developer sent a coding agent names a skill as the words
 * `/name` (`skill-mention.ts`), and its bubble draws each `/name` that names
 * one of the task's repository's skills as the chip the composer drew it as
 * while it was typed (`skill-ref.tsx`), where Claude Code and Codex draw a
 * slash command as a token too; a `/word` that names none stays words. The
 * chip is a button: a press, or Enter once it has the focus, opens the
 * skill's `SKILL.md` in a File tab of the side panel, at the default branch
 * as the repository's skills were read, and it hangs the skill's card.
 * A chip the composer drew opens the same file on a press
 * (`skill-picker.tsx`). The words stay the message's own underneath, so a
 * copy of the message and a find in the tab read `/name`.
 * The skills are the ones the composer offers, read once for the task
 * (`repository-skills.ts`), and only once a transcript holds a word they
 * could name, so a conversation naming none reads nothing. The "Loaded
 * skill" row of a call that loaded one hangs the same card and opens the
 * same file (`useSkill`).
 */

/** The task's skills as read, by name, the ask that reads them, and what opening one's file does, handed to every transcript of the task. */
interface SkillFileDoors {
  /** The skills, by name; nothing before a reader asked and the read landed, or where it did not. */
  readonly skills: ReadonlyMap<string, SkillOption> | undefined;
  readonly ask: () => void;
  readonly onOpen: (skill: SkillOption) => void;
}

/** The element a chip is written into the words as, and the one attribute it carries. */
const SKILL_ELEMENT = {
  TAG: "luke-skill",
  NAME: "name",
} as const;

const SkillFileContext = createContext<SkillFileDoors | undefined>(undefined);

/** The task's skills, by name, read once a reader wants them; nothing before they land, or where they were not read. */
function useKnownSkills(wanted: boolean): ReadonlyMap<string, SkillOption> | undefined {
  const doors = useContext(SkillFileContext);
  const ask = doors?.ask;
  useEffect(() => {
    if (wanted) ask?.();
  }, [wanted, ask]);
  return doors?.skills;
}

/** The words with each chip written in as its element, the `/name` it stands for its content. */
function withChips(text: string, tokens: readonly TextRange[]): string {
  let written = "";
  let at = 0;
  for (const token of tokens) {
    const name = text.slice(token.start + 1, token.end);
    written += `${text.slice(at, token.start)}<${SKILL_ELEMENT.TAG} ${SKILL_ELEMENT.NAME}="${name}">${skillWord(name)}</${SKILL_ELEMENT.TAG}>`;
    at = token.end;
  }
  return written + text.slice(at);
}

/**
 * The element a chip was written in as: the chip, where it names a skill the
 * message's skills hold, and its `/name` as words otherwise, as an element
 * typed into the message by hand is.
 */
function SkillElement({ node }: ExtraProps): ReactNode {
  const doors = useContext(SkillFileContext);
  const name = String(node?.properties[SKILL_ELEMENT.NAME] ?? "");
  const skill = doors?.skills?.get(name);
  if (doors === undefined || skill === undefined) return skillWord(name);
  return <SkillRef subject={{ skill, onOpen: () => doors.onOpen(skill) }} />;
}

const SKILL_COMPONENTS: Components = { [SKILL_ELEMENT.TAG]: SkillElement };

/** Hands every transcript under it the task's skills and what opening one's file does. */
export function SkillFiles({
  source,
  onOpen,
  children,
}: {
  /** Where the task's skills are read from; nothing while the task names no repository. */
  source: SkillSource | undefined;
  onOpen: (skill: SkillOption) => void;
  children: ReactNode;
}): React.JSX.Element {
  // Note that the press is read through a ref, so a new one each render
  // does not draw every transcript under it again.
  const latest = useRef(onOpen);
  latest.current = onOpen;
  const [read, setRead] = useState<
    { source: SkillSource; skills: ReadonlyMap<string, SkillOption> } | undefined
  >(undefined);
  const asked = useRef<SkillSource | undefined>(undefined);
  const skills = read !== undefined && read.source === source ? read.skills : undefined;
  // Note that the skills are read once for every reader that asks, and a
  // read that did not land is asked again by the next reader that asks.
  const ask = useCallback(() => {
    if (source === undefined || asked.current === source) return;
    asked.current = source;
    source().then((answer) => {
      // A read for a task or repository left since is no answer for this one.
      if (asked.current !== source) return;
      if ("skills" in answer) {
        setRead({ source, skills: new Map(answer.skills.map((skill) => [skill.name, skill])) });
      } else {
        asked.current = undefined;
      }
    });
  }, [source]);
  const doors = useMemo(
    () => ({ skills, ask, onOpen: (skill: SkillOption) => latest.current(skill) }),
    [skills, ask],
  );
  return <SkillFileContext.Provider value={doors}>{children}</SkillFileContext.Provider>;
}

/** The named skill and what opens its `SKILL.md`; nothing where no skill of the task's is so named, or its skills are not read. */
export function useSkill(name: string | undefined): SkillSubject | undefined {
  const onOpen = useContext(SkillFileContext)?.onOpen;
  const skill = useKnownSkills(name !== undefined && name !== "")?.get(name ?? "");
  if (skill === undefined || onOpen === undefined) return undefined;
  return { skill, onOpen: () => onOpen(skill) };
}

/** What opens a skill's `SKILL.md`, for the composer's chips, which read the skills themselves; nothing outside a task's page. */
export function useSkillOpener(): ((skill: SkillOption) => void) | undefined {
  return useContext(SkillFileContext)?.onOpen;
}

/** A message the developer sent, as markdown with every line break typed kept, each skill it names drawn as its chip. */
export function SentWords({ text }: { text: string }): ReactNode {
  const skills = useKnownSkills(holdsSlashWord(text));
  const tokens = skills === undefined ? [] : skillTokens(text, new Set(skills.keys()));
  if (tokens.length === 0) return <TranscriptWords text={text} typed />;
  const element: TranscriptElement = {
    markdown: withChips(text, tokens),
    tag: SKILL_ELEMENT.TAG,
    attributes: [SKILL_ELEMENT.NAME],
    components: SKILL_COMPONENTS,
  };
  return <TranscriptWords text={text} element={element} typed />;
}
