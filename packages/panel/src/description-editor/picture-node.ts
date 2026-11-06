import type { JSONContent } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import { Fragment, type Node as PmNode, Slice } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import type { PictureNode, PictureTaken, DescriptionEditorPictures } from "./contract.js";

const PICTURE_NODE = "image";

const PASTED_ALT = "Screenshot";

function escaped(words: string, ends: RegExp): string {
  return words.replace(ends, "\\$&");
}

function pictureMarkdown(attrs: JSONContent["attrs"]): string {
  if (String(attrs?.upload ?? "") !== "") return "";
  const alt = escaped(String(attrs?.alt ?? ""), /[\\[\]]/gu);
  const src = escaped(String(attrs?.src ?? ""), /[\\()]/gu);
  const title = attrs?.title ? ` "${escaped(String(attrs.title), /[\\"]/gu)}"` : "";
  return `![${alt}](${src}${title})`;
}

function pictureOf(node: PmNode): PictureNode {
  return {
    src: String(node.attrs.src ?? ""),
    alt: String(node.attrs.alt ?? ""),
    title: String(node.attrs.title ?? ""),
    upload: String(node.attrs.upload ?? ""),
  };
}

function uploadName(): string {
  return crypto.randomUUID();
}

function altOf(file: File): string {
  const stem = file.name.replace(/\.[^.]*$/u, "").trim();
  return stem === "" || stem === "image" ? PASTED_ALT : stem;
}

function imageFiles(list: FileList | null | undefined): File[] {
  return [...(list ?? [])].filter((file) => file.type.startsWith("image/"));
}

export function pictureNode(pictures: DescriptionEditorPictures | undefined) {
  const node = Image.extend({
    addAttributes() {
      return { ...this.parent?.(), upload: { default: "", rendered: false } };
    },
    renderMarkdown: (held: JSONContent) => pictureMarkdown(held.attrs),
  }).configure({ inline: true });
  if (pictures === undefined) return node;
  return node.extend({
    addNodeView() {
      return ({ node: held, getPos, editor }) => {
        const dom = document.createElement("span");
        dom.className = "editor-picture block";
        dom.contentEditable = "false";
        let current = held;
        let selected = false;
        const drawing = pictures.draw(dom, pictureOf(held), {
          describe: (change) => {
            const pos = getPos();
            if (pos === undefined) return;
            editor.view.dispatch(
              editor.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, ...change }),
            );
          },
          remove: () => {
            const pos = getPos();
            if (pos !== undefined) removedAt(editor.view, pos);
          },
        });
        return {
          dom,
          update: (next) => {
            if (next.type !== current.type) return false;
            current = next;
            drawing.redraw(pictureOf(next), selected);
            return true;
          },
          selectNode: () => {
            selected = true;
            drawing.redraw(pictureOf(current), true);
          },
          deselectNode: () => {
            selected = false;
            drawing.redraw(pictureOf(current), false);
          },
          stopEvent: (event) =>
            event.target instanceof Element &&
            event.target.closest("button, input, textarea") !== null,
          ignoreMutation: () => true,
          destroy: () => drawing.undraw(),
        };
      };
    },
  });
}

function removedAt(view: EditorView, pos: number): void {
  const $pos = view.state.doc.resolve(pos);
  const alone = $pos.parent.type.name === "paragraph" && $pos.parent.childCount === 1;
  const from = alone ? $pos.before() : pos;
  const to = alone ? $pos.after() : pos + ($pos.nodeAfter?.nodeSize ?? 1);
  view.dispatch(view.state.tr.delete(from, to));
}

export function laidInPictures(
  view: EditorView,
  files: readonly File[],
  pictures: DescriptionEditorPictures,
  pos?: number,
): void {
  if (files.length === 0) return;
  const { state } = view;
  const $at = state.doc.resolve(pos ?? state.selection.from);
  const after = $at.depth === 0 ? $at.pos : $at.after(1);
  const taken: PictureTaken[] = [];
  const paragraphs = files.map((file) => {
    const upload = uploadName();
    taken.push({ upload, file });
    const picture = state.schema.node(PICTURE_NODE, { src: "", alt: altOf(file), upload });
    return state.schema.node("paragraph", null, [picture]);
  });
  view.dispatch(state.tr.insert(after, paragraphs).scrollIntoView());
  pictures.take(taken);
}

function waitingAt(view: EditorView, upload: string): number | undefined {
  let found: number | undefined;
  view.state.doc.descendants((node, pos) => {
    if (found === undefined && node.type.name === PICTURE_NODE && node.attrs.upload === upload) {
      found = pos;
    }
  });
  return found;
}

export function settledPicture(view: EditorView, upload: string, src: string): void {
  const pos = waitingAt(view, upload);
  const node = pos === undefined ? undefined : view.state.doc.nodeAt(pos);
  if (pos === undefined || node === undefined || node === null) return;
  view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, src, upload: "" }));
}

export function removedPicture(view: EditorView, upload: string): void {
  const pos = waitingAt(view, upload);
  if (pos !== undefined) removedAt(view, pos);
}

export function pastedPictures(
  view: EditorView,
  event: ClipboardEvent,
  pictures: DescriptionEditorPictures,
): boolean {
  const files = imageFiles(event.clipboardData?.files);
  if (files.length === 0) return false;
  laidInPictures(view, files, pictures);
  return true;
}

export function droppedPictures(
  view: EditorView,
  event: DragEvent,
  moved: boolean,
  pictures: DescriptionEditorPictures,
): boolean {
  const files = imageFiles(event.dataTransfer?.files);
  if (moved || files.length === 0) return false;
  const landed = view.posAtCoords({ left: event.clientX, top: event.clientY });
  laidInPictures(view, files, pictures, landed?.pos);
  return true;
}

function withPictures(fragment: Fragment, change: (picture: PmNode) => PmNode): Fragment {
  const nodes: PmNode[] = [];
  fragment.forEach((child) => {
    if (child.type.name === PICTURE_NODE) nodes.push(change(child));
    else nodes.push(child.isLeaf ? child : child.copy(withPictures(child.content, change)));
  });
  return Fragment.fromArray(nodes);
}

export function copiedPictures(slice: Slice, pictures: DescriptionEditorPictures): Slice {
  const taken: PictureTaken[] = [];
  const content = withPictures(slice.content, (picture) => {
    const src = String(picture.attrs.src ?? "");
    if (!pictures.copies(src)) return picture;
    const upload = uploadName();
    taken.push({ upload, from: src });
    return picture.type.create({ ...picture.attrs, src: "", upload }, null, picture.marks);
  });
  if (taken.length === 0) return slice;
  pictures.take(taken);
  return new Slice(content, slice.openStart, slice.openEnd);
}
