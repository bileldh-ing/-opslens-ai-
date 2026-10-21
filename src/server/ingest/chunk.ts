/** Rough token estimate (≈4 chars/token) — good enough for chunk budgeting. */
export function estimateTokens(text: string) {
  return Math.ceil(text.length / 4);
}

/**
 * Splits markdown/code into overlapping chunks, preferring heading and paragraph boundaries
 * so retrieved context stays coherent.
 */
export function chunkText(text: string, maxTokens = 400, overlapTokens = 50): string[] {
  const sections = text.split(/\n(?=#{1,6} )|\n{2,}/).map((s) => s.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const section of sections) {
    const candidate = current ? `${current}\n\n${section}` : section;
    if (estimateTokens(candidate) <= maxTokens) {
      current = candidate;
      continue;
    }
    if (current) chunks.push(current);
    if (estimateTokens(section) > maxTokens) {
      const size = maxTokens * 4;
      const step = (maxTokens - overlapTokens) * 4;
      for (let i = 0; i < section.length; i += step) chunks.push(section.slice(i, i + size));
      current = "";
    } else {
      const tail = current.slice(-overlapTokens * 4);
      current = tail ? `${tail}\n\n${section}` : section;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
