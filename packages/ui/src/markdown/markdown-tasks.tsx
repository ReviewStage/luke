/**
 * markdown-tasks.tsx -- a note's task items a reader can tick: each item's checkbox named by its item's words and placed by its marker's offset, drawn as the shared `Checkbox` in the bullet's gutter.
 */

import { isWireString } from "@luke/wire";
import type { Element, ElementContent, Root } from "hast";
import { useState } from "react";
import type { Components } from "streamdown";
import { Checkbox } from "../components/checkbox/checkbox.js";

/** The class the box a reader can tick stands in, in the bullet's gutter (`prose.css`). */
const TASK_BOX_CLASS = "luke-markdown-task";

/** A task item's checkbox as drawn: the offset its item starts at in the words, and the item's own words, which name it. */
interface TaskItem {
  readonly at: number;
  readonly label: string;
}

/**
 * Ticks or clears the task item whose marker starts at an offset in the
 * words, answering whether the change was saved.
 */
export type MarkdownTaskToggler = (at: number) => Promise<boolean>;

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
 * own, so a nested list's box names its own item rather than the one around it.
 */
function placeTasks(parent: Root | Element, item: Element | undefined): void {
  for (const child of parent.children) {
    if (child.type !== "element") continue;
    const own = child.tagName === "li" ? child : item;
    const at = own?.position?.start.offset;
    if (
      child.tagName === "input" &&
      child.properties.type === "checkbox" &&
      own &&
      at !== undefined
    ) {
      TASK_ITEMS.set(child, { at, label: own.children.map(itemWords).join("").trim() });
    }
    placeTasks(child, own);
  }
}

/** The rehype step that names each task item's checkbox by its item's offset. */
export const placeTaskItems = () => (tree: Root) => placeTasks(tree, undefined);

/**
 * A task item's checkbox that ticks or clears its item. It flips at the
 * press, since the words come back changed only once the change is saved,
 * and flips back where it was not. Note that its caller keys it by the
 * words' own state, so a change arriving from anyone redraws it from them.
 */
function TaskBox({
  item,
  checked,
  toggle,
}: {
  item: TaskItem;
  checked: boolean;
  toggle: MarkdownTaskToggler;
}): React.JSX.Element {
  const [shown, setShown] = useState(checked);
  // Note that the box stands in the bullet's gutter (`prose.css`), and
  // takes a finger's press around it there, as the editor's does.
  return (
    <span className={TASK_BOX_CLASS}>
      <Checkbox
        label={item.label}
        checked={shown}
        onChange={(next) => {
          setShown(next);
          toggle(item.at).then((saved) => {
            if (!saved) setShown(checked);
          });
        }}
      />
    </span>
  );
}

/** How a note draws a task item's checkbox where its reader can tick it, asking `toggle` at the press. */
export function taskInput(toggle: MarkdownTaskToggler): NonNullable<Components["input"]> {
  return ({ node, ...props }) => {
    const item = node === undefined ? undefined : TASK_ITEMS.get(node);
    return item === undefined ? (
      <Checkbox label="Task" checked={props.checked === true} disabled onChange={() => undefined} />
    ) : (
      <TaskBox
        key={String(props.checked === true)}
        item={item}
        checked={props.checked === true}
        toggle={toggle}
      />
    );
  };
}
