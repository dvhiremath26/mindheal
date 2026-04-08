/**
 * RAG (Retrieval-Augmented Generation) module.
 *
 * Provides context-aware AI healing by maintaining a knowledge store
 * of healing history, page objects, git changes, DOM snapshots,
 * component docs, and test specs.
 */

export { KnowledgeStore } from './knowledge-store';
export { ContextRetriever } from './context-retriever';
export { tokenize, buildTermVector, cosineSimilarity, textSimilarity } from './embeddings';
export type { TermVector } from './embeddings';
