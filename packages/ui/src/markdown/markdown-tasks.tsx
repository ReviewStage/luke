/**
 * markdown-tasks.tsx -- a note's task items a reader can tick, and any words' a reader cannot: each item's checkbox named by its item's words and placed by its marker's offset, drawn as the shared `Checkbox` in the bullet's gutter.
 */

import { isWireString } from "@repo/wire";
import type { Element, ElementContent, Root } from "hast";
import type { Components } from "streamdown";
import { Checkbox } from "../components/checkbox/checkbox.js";
import { MARKDOWN_CLASS } from "./markdown-class.js";

/** The class the box a reader can tick stands in, in the bullet's gutter (`prose.css`), the description's editor's box alike. */
const TASK_BOX_CLASS = MARKDOWN_CLASS.TASK_BOX;

/** A task item's checkbox as drawn: the offset its item starts at in the words, where they say it, and the item's own words, which name it. */
interface TaskItem {
  readonly at: number | undefined;
  readonly label: string;
}

/**
 * A task item's tick as its caller's mutation stands (`useMutation`): how
 * the box asks for a state, and the state it was pressed to while that ask is
 * out or once it saved, none once refused or never asked. Note that it names
 * the state the box was pressed to rather than a flip, so a press waiting
 * behind one that failed still asks for what the reader saw.
 */
export interface TaskWrite {
  readonly run: (ticked: boolean) => void;
  readonly asked: boolean | undefined;
}

/**
 * The hook that ticks or clears the task item whose marker starts at an
 * offset in the words, called once by that item's box as it draws, so the
 * box draws from the mutation the caller holds for it.
 */
export type MarkdownTaskTick = (at: number) => TaskWrite;

/** Each task item's checkbox, by the tree's own node. */
const TASK_ITEMS = new WeakMap<Element, TaskItem>();

/** A list item's own words, a picture's alt text among them, without the words of a list nested in it. */
function itemWords(node: ElementContent): string {
  if (node.type === "text") return node.value;
  if (node.type !== "element" || node.tagName === "ul" || node.tagName === "ol") return "";
  if (node.tagName === "img") return isWireString(node.properties.alt) ? node.properties.alt : "";
  return node.children.map(itemWords).join("");
}

/**
 * Gives each task item's checkbox the offset its list item starts at in the
 * words, its marker's, which the tree keeps on the item and not on the box,
 * and the item's words as its name. Note that the nearest item is the box's
 * own, so a nested list's box names its own item rather than the one around it,
 * and that a box from HTML has no offset, so it is named but never ticked.
 */
function placeTasks(parent: Root | Element, item: Element | undefined): void {
  for (const child of parent.children) {
    if (child.type !== "element") continue;
    const own = child.tagName === "li" ? child : item;
    const at = own?.position?.start.offset;
    if (child.tagName === "input" && child.properties.type === "checkbox" && own) {
      TASK_ITEMS.set(child, { at, label: own.children.map(itemWords).join("").trim() });
    }
    placeTasks(child, own);
  }
}

/** The rehype step that names each task item's checkbox by its item's offset. */
export const placeTaskItems = () => (tree: Root) => placeTasks(tree, undefined);

/**
 * A task item's checkbox that ticks or clears its item. It stands at the
 * state pressed while its tick is out and once it saved, since the words come
 * back changed only after, and at the words' own state where it was refused.
 * Note that its caller keys it by the words' own state, so a change arriving
 * from anyone redraws it from them.
 */
function TaskBox({
  item,
  checked,
  useTick,
}: {
  item: { readonly at: number; readonly label: string };
  checked: boolean;
  useTick: MarkdownTaskTick;
}): React.JSX.Element {
  const tick = useTick(item.at);
  // Note that the box stands in the bullet's gutter (`prose.css`), and
  // takes a finger's press around it there, as the editor's does.
  return (
    <span className={TASK_BOX_CLASS}>
      <Checkbox label={item.label} checked={tick.asked ?? checked} onChange={tick.run} />
    </span>
  );
}

/**
 * How a note draws a task item's checkbox where its reader cannot tick it: the
 * shared `Checkbox`, read-only, named by its item's words, in the gutter a box
 * the reader can tick stands in. Note that a read-only box keeps its words' own
 * ink, where the browser's disabled box fades its tick past reading.
 */
export const readTaskInput: NonNullable<Components["input"]> = ({ node, ...props }) => {
  const item = node === undefined ? undefined : TASK_ITEMS.get(node);
  if (props.type !== "checkbox") return <input {...props} />;
  return (
    <span className={TASK_BOX_CLASS}>
      <Checkbox
        label={item?.label ?? "Task"}
        checked={props.checked === true}
        readOnly
        onChange={() => undefined}
      />
    </span>
  );
};

/** How a note draws a task item's checkbox where its reader can tick it, through the tick `useTick` holds for it. */
export function taskInput(useTick: MarkdownTaskTick): NonNullable<Components["input"]> {
  return ({ node, ...props }) => {
    const item = node === undefined ? undefined : TASK_ITEMS.get(node);
    const at = item?.at;
    return item === undefined || at === undefined ? (
      <Checkbox label="Task" checked={props.checked === true} disabled onChange={() => undefined} />
    ) : (
      <TaskBox
        key={String(props.checked === true)}
        item={{ at, label: item.label }}
        checked={props.checked === true}
        useTick={useTick}
      />
    );
  };
}
