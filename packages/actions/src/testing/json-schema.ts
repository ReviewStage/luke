import type { JsonSchemaNode } from "@sidecar/wire";

/** The property table of an emitted object node, for a test that reads one. */
export function objectProperties(node: JsonSchemaNode): { readonly [key: string]: JsonSchemaNode } {
  return "properties" in node ? node.properties : {};
}

/** The enum an emitted array-of-strings node offers, or nothing. */
export function itemEnum(node: JsonSchemaNode | undefined): readonly string[] {
  if (!node || !("items" in node)) return [];
  const items = node.items;
  return "type" in items && items.type === "string" ? (items.enum ?? []) : [];
}
