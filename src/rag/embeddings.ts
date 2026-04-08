/**
 * Lightweight text similarity engine for RAG retrieval.
 *
 * Uses TF-IDF-style term weighting with cosine similarity — no external
 * embedding model or vector DB required. This is intentionally simple so
 * MindHeal works offline (e.g. with Ollama) without any extra infrastructure.
 *
 * For large knowledge bases, consumers can swap in a real vector DB via the
 * `ContextRetriever` interface.
 */

// ─── Tokenization ────────────────────────────────────────────────────────────

/**
 * Tokenizes text into lowercase alphanumeric terms, splitting on non-word
 * characters. Also generates bigrams for better matching on locator patterns
 * like "submit-btn" or "getByTestId".
 */
export function tokenize(text: string): string[] {
  const raw = text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);

  // Add bigrams for compound terms
  const bigrams: string[] = [];
  for (let i = 0; i < raw.length - 1; i++) {
    bigrams.push(`${raw[i]}_${raw[i + 1]}`);
  }

  return [...raw, ...bigrams];
}

// ─── TF-IDF Vectors ──────────────────────────────────────────────────────────

export type TermVector = Map<string, number>;

/**
 * Builds a term-frequency vector from a list of tokens.
 */
export function buildTermVector(tokens: string[]): TermVector {
  const freq = new Map<string, number>();
  for (const token of tokens) {
    freq.set(token, (freq.get(token) ?? 0) + 1);
  }

  // Normalize by document length
  const len = tokens.length || 1;
  for (const [term, count] of freq) {
    freq.set(term, count / len);
  }

  return freq;
}

/**
 * Computes cosine similarity between two term vectors.
 * Returns a value between 0 (completely different) and 1 (identical).
 */
export function cosineSimilarity(a: TermVector, b: TermVector): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (const [term, weightA] of a) {
    normA += weightA * weightA;
    const weightB = b.get(term) ?? 0;
    dotProduct += weightA * weightB;
  }

  for (const [, weightB] of b) {
    normB += weightB * weightB;
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}

/**
 * Computes similarity between two text strings.
 * Convenience wrapper over tokenize → buildTermVector → cosineSimilarity.
 */
export function textSimilarity(textA: string, textB: string): number {
  const tokensA = tokenize(textA);
  const tokensB = tokenize(textB);

  if (tokensA.length === 0 || tokensB.length === 0) return 0;

  const vecA = buildTermVector(tokensA);
  const vecB = buildTermVector(tokensB);

  return cosineSimilarity(vecA, vecB);
}
