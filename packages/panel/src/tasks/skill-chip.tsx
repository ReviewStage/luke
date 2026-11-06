import type { MarkdownComponents, MarkdownNodeProps } from "@repo/ui/markdown";
import {
  holdsSlashWord,
  type SkillOption,
  skillTokens,
  skillWord,
  type TextRange,
} from "@repo/ui/skill-mention";
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
import { afterPaint } from "../after-paint.js";
import type { SkillSource } from "./skill-picker.js";
import { opensFile, SkillRef, type SkillSubject, type SkillWithFile } from "./skill-ref.js";
import { type TranscriptElement, TranscriptWords } from "./transcript-blocks.js";

interface SkillFileDoors {
  readonly skills: ReadonlyMap<string, SkillOption> | undefined;
  readonly ask: () => void;
  readonly onOpen: (skill: SkillOption) => void;
}

const SKILL_ELEMENT = {
  TAG: "app-skill",
  NAME: "name",
} as const;

const SkillFileContext = createContext<SkillFileDoors | undefined>(undefined);

function useKnownSkills(wanted: boolean): ReadonlyMap<string, SkillOption> | undefined {
  const doors = useContext(SkillFileContext);
  const ask = doors?.ask;
  useEffect(() => {
    if (wanted) ask?.();
  }, [wanted, ask]);
  return doors?.skills;
}

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

function SkillElement({ node }: MarkdownNodeProps): ReactNode {
  const doors = useContext(SkillFileContext);
  const name = String(node?.properties[SKILL_ELEMENT.NAME] ?? "");
  const skill = doors?.skills?.get(name);
  if (doors === undefined || skill === undefined) return skillWord(name);
  const onOpen = opensFile(skill) ? () => doors.onOpen(skill) : undefined;
  return <SkillRef name={name} skill={skill} onOpen={onOpen} />;
}

const SKILL_COMPONENTS: MarkdownComponents = { [SKILL_ELEMENT.TAG]: SkillElement };

export function SkillFiles({
  source,
  onOpen,
  children,
}: {
  source: SkillSource | undefined;
  onOpen: (skill: SkillWithFile) => void;
  children: ReactNode;
}): React.JSX.Element {
  const latest = useRef(onOpen);
  latest.current = onOpen;
  const [read, setRead] = useState<
    { source: SkillSource; skills: ReadonlyMap<string, SkillOption> } | undefined
  >(undefined);
  const asked = useRef<SkillSource | undefined>(undefined);
  const skills = read !== undefined && read.source === source ? read.skills : undefined;
  const ask = useCallback(() => {
    if (source === undefined || asked.current === source) return;
    asked.current = source;
    afterPaint(() => {
      if (asked.current !== source) return;
      source().then((answer) => {
        if (asked.current !== source) return;
        if ("skills" in answer) {
          setRead({ source, skills: new Map(answer.skills.map((skill) => [skill.name, skill])) });
        } else {
          asked.current = undefined;
        }
      });
    });
  }, [source]);
  const doors = useMemo(
    () => ({
      skills,
      ask,
      onOpen: (skill: SkillOption) => (opensFile(skill) ? latest.current(skill) : undefined),
    }),
    [skills, ask],
  );
  return <SkillFileContext.Provider value={doors}>{children}</SkillFileContext.Provider>;
}

export function useSkill(name: string | undefined): SkillSubject | undefined {
  const onOpen = useContext(SkillFileContext)?.onOpen;
  const skill = useKnownSkills(name !== undefined && name !== "")?.get(name ?? "");
  if (skill === undefined || onOpen === undefined) return undefined;
  return { skill, onOpen: () => onOpen(skill) };
}

export function useSkillOpener(): ((skill: SkillOption) => void) | undefined {
  return useContext(SkillFileContext)?.onOpen;
}

export function SentWords({
  text,
  asDocument = false,
  line = false,
}: {
  text: string;
  asDocument?: boolean | undefined;
  line?: boolean | undefined;
}): ReactNode {
  const skills = useKnownSkills(holdsSlashWord(text));
  const tokens = skills === undefined ? [] : skillTokens(text, new Set(skills.keys()));
  if (tokens.length === 0) {
    return <TranscriptWords text={text} typed asDocument={asDocument} line={line} />;
  }
  const element: TranscriptElement = {
    markdown: withChips(text, tokens),
    tag: SKILL_ELEMENT.TAG,
    attributes: [SKILL_ELEMENT.NAME],
    components: SKILL_COMPONENTS,
  };
  return (
    <TranscriptWords text={text} element={element} typed asDocument={asDocument} line={line} />
  );
}
