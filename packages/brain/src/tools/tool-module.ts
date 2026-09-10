import type { RunOrigin, SessionKey, ToolExecutionContext } from "@sidecar/runtime/vocabulary";
import { isRecord, type Schema, type UnparsedWireValue, type WireRecord } from "@sidecar/wire";

/**
 * The shape every tool of the brain is declared in: what it is called, what
 * it does in the model's words, the schema of what it takes, and the one
 * function that carries a call out. It is the shape eve's `defineTool` and
 * the AI SDK's `tool()` both take, so the catalog, the executor, and a later
 * runtime read the same module. The schema is the wire `Schema` the tool's
 * fields are declared in once — it parses a call and emits what the model is
 * shown, and the AI SDK's `tool()` takes it through `jsonSchema()` — rather
 * than a second statement of the same rule in another schema language.
 *
 * A module under this directory reaches the brain's own internals through
 * its context and nothing else: the repository check refuses an import from
 * outside the directory, so a tool can be read, tested, and moved without
 * the agent that runs it.
 */

/**
 * The standing a tool's call runs under: which conversation and turn it
 * belongs to, which run, who opened it, and whether it still stands. The
 * origin is attribution, never a permission; `isRevoked()` is asked again
 * after every await and once more before an effect.
 */
export interface ToolContext extends ToolExecutionContext {
  readonly conversationId: SessionKey;
  /** The turn the call was emitted in: the primary run's id for an ask's turn, the turn's own for the rest. */
  readonly turnId: string;
  readonly origin: RunOrigin;
}

/** A call's arguments as a module takes them: the record they parse to, or nothing when they are not one. */
export function toolArguments(argumentsJson: string): WireRecord | undefined {
  try {
    // SAFETY: JSON.parse answers a wire value; the record check is the validation.
    const parsed = JSON.parse(argumentsJson) as UnparsedWireValue;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export interface ToolModule<Output extends WireRecord, Context extends ToolContext> {
  readonly name: string;
  readonly description: string;
  /** The tool's fields as the model is offered them and as a call is read; declared once, in `@sidecar/wire`'s schema. */
  readonly inputSchema: Schema<unknown>;
  /** Carries one call whose arguments parsed as a record; everything the call may do runs inside. */
  execute(input: WireRecord, context: Context): Promise<Output>;
}
