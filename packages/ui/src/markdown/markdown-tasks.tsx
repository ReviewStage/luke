import { isWireString } from "@repo/wire";
import type { Element, ElementContent, Root } from "hast";
import { Fragment } from "react";
import type { Components } from "streamdown";
import { Checkbox } from "../components/checkbox/checkbox.js";
import { MARKDOWN_CLASS } from "./markdown-class.js";

const TASK_BOX_CLASS = MARKDOWN_CLASS.TASK_BOX;

interface TaskItem {
  readonly at: number | undefined;
  readonly label: string;
}

export interface TaskWrite {
  readonly run: (ticked: boolean) => void;
  readonly asked: boolean | undefined;
}

export interface TaskBoxItem {
  readonly at: number;
  readonly label: string;
  readonly checked: boolean;
}

export type MarkdownTaskBox = (item: TaskBoxItem) => React.ReactNode;

const TASK_ITEMS = new WeakMap<Element, TaskItem>();

function itemWords(node: ElementContent): string {
  if (node.type === "text") return node.value;
  if (node.type !== "element" || node.tagName === "ul" || node.tagName === "ol") return "";
  if (node.tagName === "img") return isWireString(node.properties.alt) ? node.properties.alt : "";
  return node.children.map(itemWords).join("");
}

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

export const placeTaskItems = () => (tree: Root) => placeTasks(tree, undefined);

export function TaskBox({
  label,
  checked,
  write,
}: {
  label: string;
  checked: boolean;
  write: TaskWrite;
}): React.JSX.Element {
  return (
    <span className={TASK_BOX_CLASS}>
      <Checkbox label={label} checked={write.asked ?? checked} onChange={write.run} />
    </span>
  );
}

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

export function taskInput(drawBox: MarkdownTaskBox): NonNullable<Components["input"]> {
  return ({ node, ...props }) => {
    const item = node === undefined ? undefined : TASK_ITEMS.get(node);
    const at = item?.at;
    return item === undefined || at === undefined ? (
      <Checkbox label="Task" checked={props.checked === true} disabled onChange={() => undefined} />
    ) : (
      <Fragment key={String(props.checked === true)}>
        {drawBox({ at, label: item.label, checked: props.checked === true })}
      </Fragment>
    );
  };
}
