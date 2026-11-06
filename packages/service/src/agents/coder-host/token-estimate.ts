const BYTES_PER_TOKEN = 4;

export function estimatedTokens(json: string): number {
  return Math.ceil(new TextEncoder().encode(json).byteLength / BYTES_PER_TOKEN);
}
