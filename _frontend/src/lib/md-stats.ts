export interface MdStats {
  chars: number;
  words: number;
  lines: number;
  tokens: number;
}

export function calculateMdStats(content: string): MdStats {
  const chars = content.length;
  const words = content.trim() ? content.trim().split(/\s+/).length : 0;
  const lines = content ? content.split("\n").length : 0;
  // Rough token estimate: ~4 chars per token for English text
  const tokens = Math.ceil(chars / 4);
  return { chars, words, lines, tokens };
}

export function formatStats(stats: MdStats): string {
  return `${stats.chars} chars | ${stats.words} words | ${stats.lines} lines | ${stats.tokens} tokens`;
}