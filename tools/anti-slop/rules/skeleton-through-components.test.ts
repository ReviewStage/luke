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
    panel(
      "function RowsSkeleton() { return <SkeletonRegion label={l}><ListRow title={<Skeleton />} /></SkeletonRegion>; }",
    ),
    panel(
      "const ComposerSkeleton = () => <ComposerCard field={<ComposerFieldRoom />} trail={<Skeleton shape={CIRCLE} />} />;",
    ),
    panel(
      'function LogSkeleton() { return <div className="agent-log-skeleton">{widths.map((w) => <Skeleton key={w} width={w} />)}</div>; }',
    ),
    panel(
      'function PartSkeleton({ wide }) { return <div className={wide ? "pr-skeleton pr-skeleton-wide" : "pr-skeleton"} />; }',
    ),
    panel("function RowSkeleton(props) { return <ListRow {...props} title={<Skeleton />} />; }"),
    panel(
      "function TableSkeleton() { const bone = (w) => <Skeleton width={w} />; return <Table>{bone(1)}</Table>; }",
    ),
    {
      code: 'function Skeleton() { return <span className="ui-skeleton" />; }',
      filename: UI_FILE,
    },
    panel('function Composer() { return <div className="agent-composer" />; }'),
  ],
  invalid: [
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
      code: 'const RowSkeleton = () => <div className="ui-settings-row" data-density="card" />;',
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
