import path from "node:path";
import { fileURLToPath } from "node:url";

import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import { skeletonThroughComponentsRule } from "./skeleton-through-components.ts";

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const PANEL_FILE = path.join(REPOSITORY_ROOT, "packages/panel/src/tasks/example.tsx");
const UI_FILE = path.join(REPOSITORY_ROOT, "packages/ui/src/components/example/example.tsx");

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester();

function panel(code: string): { code: string; filename: string } {
  return { code, filename: PANEL_FILE };
}

tester.run("skeleton-through-components", skeletonThroughComponentsRule, {
  valid: [
    // A skeleton draws its blocks through the components the loaded state draws with.
    panel(
      "function RowsSkeleton() { return <SkeletonRegion label={l}><ListRow title={<Skeleton />} /></SkeletonRegion>; }",
    ),
    panel(
      "const ComposerSkeleton = () => <ComposerCard field={<ComposerFieldRoom />} trail={<Skeleton shape={CIRCLE} />} />;",
    ),
    // A class of the skeleton's own names itself one, and a row's callback is the skeleton's own.
    panel(
      'function LogSkeleton() { return <div className="agent-log-skeleton">{widths.map((w) => <Skeleton key={w} width={w} />)}</div>; }',
    ),
    panel(
      'function PartSkeleton({ wide }) { return <div className={wide ? "pr-skeleton pr-skeleton-wide" : "pr-skeleton"} />; }',
    ),
    // A lowercase helper inside a skeleton is the skeleton's own.
    // A spread on a component is the component's to read, as the loaded state's is.
    panel("function RowSkeleton(props) { return <ListRow {...props} title={<Skeleton />} />; }"),
    panel(
      "function TableSkeleton() { const bone = (w) => <Skeleton width={w} />; return <Table>{bone(1)}</Table>; }",
    ),
    // `@luke/ui`'s own block is a skeleton's, and a classed box outside any skeleton is no business of the rule's.
    {
      code: 'function Skeleton() { return <span className="luke-skeleton" />; }',
      filename: UI_FILE,
    },
    panel('function Composer() { return <div className="agent-composer" />; }'),
  ],
  invalid: [
    // Blocks drawn by a component that is no skeleton, or by no component at all.
    {
      ...panel(
        "function Generating() { return <SkeletonRegion label={l}><Skeleton /></SkeletonRegion>; }",
      ),
      errors: [
        {
          messageId: "blockOutsideSkeleton",
          data: { tag: "SkeletonRegion", component: "Generating" },
        },
        { messageId: "blockOutsideSkeleton", data: { tag: "Skeleton", component: "Generating" } },
      ],
    },
    {
      ...panel("function Page() { return loading ? <Skeleton /> : <Rows />; }"),
      errors: [{ messageId: "blockOutsideSkeleton" }],
    },
    { ...panel("const block = <Skeleton />;"), errors: [{ messageId: "blockOutsideSkeleton" }] },
    // A skeleton copying a box of the surface it stands for, in `@luke/ui` as anywhere.
    {
      ...panel(
        'function ComposerSkeleton() { return <div className="agent-composer"><Skeleton /></div>; }',
      ),
      errors: [
        {
          messageId: "copiedBox",
          data: { name: "agent-composer", tag: "div", component: "ComposerSkeleton" },
        },
      ],
    },
    {
      code: 'const RowSkeleton = () => <div className="luke-settings-row" data-density="card" />;',
      filename: UI_FILE,
      errors: [{ messageId: "copiedBox" }],
    },
    {
      ...panel(
        'function LogSkeleton() { return <div className="agent-log-skeleton agent-log" />; }',
      ),
      errors: [
        {
          messageId: "copiedBox",
          data: { name: "agent-log", tag: "div", component: "LogSkeleton" },
        },
      ],
    },
    {
      ...panel(
        'function PartSkeleton({ wide }) { return <div className={wide ? "pr-skeleton" : "pr-row"} />; }',
      ),
      errors: [
        { messageId: "copiedBox", data: { name: "pr-row", tag: "div", component: "PartSkeleton" } },
      ],
    },
    // A spread on an intrinsic element may carry a copied class, whether its source is a literal or not.
    {
      ...panel(
        'function ComposerSkeleton() { return <div {...{ className: "agent-composer" }}><Skeleton /></div>; }',
      ),
      errors: [{ messageId: "spreadBox", data: { tag: "div", component: "ComposerSkeleton" } }],
    },
    {
      ...panel("function PartSkeleton(props) { return <div {...props} />; }"),
      errors: [{ messageId: "spreadBox" }],
    },
    // A class the rule cannot read may be a copied box.
    {
      ...panel("function PartSkeleton({ className }) { return <div className={className} />; }"),
      errors: [{ messageId: "unknownClass" }],
    },
    {
      ...panel('function PartSkeleton() { return <div className={cn("pr-skeleton", extra)} />; }'),
      errors: [{ messageId: "unknownClass" }],
    },
  ],
});
