import { BookOpenIcon } from "lucide-react";
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
import { CardDetail } from "../desktop/plan-card";
import { Tooltip } from "../tooltip";
import { FileTypeIcon } from "./file-type-icon";
import { holdsSlashWord, type SkillOption, skillTokens, type TextRange } from "./skill-mention";
import type { SkillSource } from "./skill-picker";
import { type TranscriptElement, TranscriptWords } from "./transcript-blocks";

/**
 * skill-chip.tsx -- a skill named in a sent message, drawn as the composer draws a chosen one, which opens the skill's `SKILL.md` in a File tab.
 *
 * A message the developer sent a coding agent names a skill as the words
 * `/name` (`skill-mention.ts`), and its bubble draws each `/name` that names
 * one of the plan's repository's skills as the chip the composer drew it as
 * while it was typed (`.skill-chip`), where Claude Code and Codex draw a
 * slash command as a token too; a `/word` that names none stays words. The
 * chip is a button: a press, or Enter once it has the focus, opens the
 * skill's `SKILL.md` in a File tab of the side panel, at the default branch
 * as the repository's skills were read, and its hover card says what the
 * skill is for and where it stands, drawn from a plan card's rows
 * (`plan-card.tsx`) as a pinned tab's is: the skill's mark and name at its
 * head, what it is for under it, and its file's line, which opens it too.
 * A chip the composer drew opens the same file on a press
 * (`skill-picker.tsx`). The words stay the message's own underneath, so a
 * copy of the message and a find in the tab read `/name`.
 * The skills are the ones the composer offers, read once for the plan
 * (`repository-skills.ts`), and only once a transcript holds a word they
 * could name, so a conversation naming none reads nothing. The "Loaded
 * skill" row of a call that loaded one opens the same file
 * (`useSkillFile`).
 */

/** The plan's skills as read, by name, the ask that reads them, and what opening one's file does, handed to every transcript of the plan. */
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

/** The plan's skills, by name, read once a reader wants them; nothing before they land, or where they were not read. */
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
    written += `${text.slice(at, token.start)}<${SKILL_ELEMENT.TAG} ${SKILL_ELEMENT.NAME}="${name}">/${name}</${SKILL_ELEMENT.TAG}>`;
    at = token.end;
  }
  return written + text.slice(at);
}

/**
 * What the hover card of a skill's chip says, in a plan card's rows: the
 * skill's mark and its name as the chip says it, what it is for, and the
 * line of its file, named from the repository's root, which a press opens.
 */
function SkillCard({
  skill,
  onOpen,
}: {
  skill: SkillOption;
  onOpen: () => void;
}): React.JSX.Element {
  return (
    <div className="plan-card" data-skill-card="">
      <div className="plan-card-heading">
        <div className="plan-card-head">
          <span className="plan-card-glyph">
            <BookOpenIcon aria-hidden="true" />
          </span>
          <span className="plan-card-name">/{skill.name}</span>
        </div>
        {skill.description === "" ? null : <p className="plan-card-note">{skill.description}</p>}
        <CardDetail
          glyph={<FileTypeIcon name={skill.path} />}
          label={skill.path}
          onPress={onOpen}
        />
      </div>
    </div>
  );
}

/** A skill named in a sent message: the composer's chip, as a button that opens its file, hanging a card that says what it is. */
function SkillChip({
  skill,
  onOpen,
}: {
  skill: SkillOption;
  onOpen: () => void;
}): React.JSX.Element {
  return (
    <Tooltip label={skill.path} card={<SkillCard skill={skill} onOpen={onOpen} />}>
      <button type="button" className="skill-chip" onClick={onOpen}>
        /{skill.name}
      </button>
    </Tooltip>
  );
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
  if (doors === undefined || skill === undefined) return `/${name}`;
  return <SkillChip skill={skill} onOpen={() => doors.onOpen(skill)} />;
}

const SKILL_COMPONENTS: Components = { [SKILL_ELEMENT.TAG]: SkillElement };

/** Hands every transcript under it the plan's skills and what opening one's file does. */
export function SkillFiles({
  source,
  onOpen,
  children,
}: {
  /** Where the plan's skills are read from; nothing while the plan names no repository. */
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
      // A read for a plan or repository left since is no answer for this one.
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

/** What opens the named skill's `SKILL.md`; nothing where no skill of the plan's is so named, or its skills are not read. */
export function useSkillFile(name: string | undefined): (() => void) | undefined {
  const onOpen = useContext(SkillFileContext)?.onOpen;
  const skill = useKnownSkills(name !== undefined && name !== "")?.get(name ?? "");
  if (skill === undefined || onOpen === undefined) return undefined;
  return () => onOpen(skill);
}

/** What opens a skill's `SKILL.md`, for the composer's chips, which read the skills themselves; nothing outside a plan's page. */
export function useSkillOpener(): ((skill: SkillOption) => void) | undefined {
  return useContext(SkillFileContext)?.onOpen;
}

/** A message the developer sent, as markdown, each skill it names drawn as its chip. */
export function SentWords({ text }: { text: string }): ReactNode {
  const skills = useKnownSkills(holdsSlashWord(text));
  const tokens = skills === undefined ? [] : skillTokens(text, new Set(skills.keys()));
  if (tokens.length === 0) return <TranscriptWords text={text} />;
  const element: TranscriptElement = {
    markdown: withChips(text, tokens),
    tag: SKILL_ELEMENT.TAG,
    attributes: [SKILL_ELEMENT.NAME],
    components: SKILL_COMPONENTS,
  };
  return <TranscriptWords text={text} element={element} />;
}
