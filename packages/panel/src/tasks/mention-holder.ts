export type MentionHolder = { readonly taskId: string } | { readonly agentId: string };

export function holderTaskId(holder: MentionHolder | undefined): string | undefined {
  return holder !== undefined && "taskId" in holder ? holder.taskId : undefined;
}
