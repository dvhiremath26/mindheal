import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { tokenize, buildTermVector, cosineSimilarity, textSimilarity } from '../../src/rag/embeddings';
import { KnowledgeStore } from '../../src/rag/knowledge-store';
import { ContextRetriever } from '../../src/rag/context-retriever';
import type { RAGConfig, LocatorInfo, HealingEvent } from '../../src/types/index';

// ─── Embeddings Tests ─────────────────────────────────────────────────────────

describe('tokenize', () => {
  it('should lowercase and split on non-alphanumeric characters', () => {
    const tokens = tokenize('Submit Button');
    expect(tokens).toContain('submit');
    expect(tokens).toContain('button');
  });

  it('should generate bigrams', () => {
    const tokens = tokenize('submit button click');
    expect(tokens).toContain('submit_button');
    expect(tokens).toContain('button_click');
  });

  it('should return empty array for empty input', () => {
    expect(tokenize('')).toEqual([]);
  });

  it('should handle special characters in selectors', () => {
    const tokens = tokenize('#login-form .submit-btn[data-testid="submit"]');
    expect(tokens).toContain('login');
    expect(tokens).toContain('form');
    expect(tokens).toContain('submit');
    expect(tokens).toContain('btn');
    expect(tokens).toContain('testid');
  });
});

describe('buildTermVector', () => {
  it('should create a normalized term frequency map', () => {
    const vec = buildTermVector(['hello', 'world', 'hello']);
    expect(vec.get('hello')).toBeCloseTo(2 / 3);
    expect(vec.get('world')).toBeCloseTo(1 / 3);
  });

  it('should handle empty token list', () => {
    const vec = buildTermVector([]);
    expect(vec.size).toBe(0);
  });
});

describe('cosineSimilarity', () => {
  it('should return 1 for identical vectors', () => {
    const vec = buildTermVector(['hello', 'world']);
    expect(cosineSimilarity(vec, vec)).toBeCloseTo(1.0);
  });

  it('should return 0 for completely different vectors', () => {
    const a = buildTermVector(['hello', 'world']);
    const b = buildTermVector(['foo', 'bar']);
    expect(cosineSimilarity(a, b)).toBe(0);
  });

  it('should return a value between 0 and 1 for partially overlapping vectors', () => {
    const a = buildTermVector(['hello', 'world', 'foo']);
    const b = buildTermVector(['hello', 'bar', 'baz']);
    const sim = cosineSimilarity(a, b);
    expect(sim).toBeGreaterThan(0);
    expect(sim).toBeLessThan(1);
  });

  it('should handle empty vectors', () => {
    const empty = new Map<string, number>();
    const vec = buildTermVector(['hello']);
    expect(cosineSimilarity(empty, vec)).toBe(0);
    expect(cosineSimilarity(vec, empty)).toBe(0);
  });
});

describe('textSimilarity', () => {
  it('should return high similarity for related texts', () => {
    const sim = textSimilarity(
      'page.getByRole button submit',
      'page.getByRole button submit form',
    );
    expect(sim).toBeGreaterThan(0.5);
  });

  it('should return 0 for completely unrelated texts', () => {
    const sim = textSimilarity('apple banana cherry', 'xyz qwerty foobar');
    expect(sim).toBe(0);
  });

  it('should return 0 for empty strings', () => {
    expect(textSimilarity('', 'hello')).toBe(0);
    expect(textSimilarity('hello', '')).toBe(0);
  });
});

// ─── KnowledgeStore Tests ─────────────────────────────────────────────────────

// Mock file-utils so we don't touch the real filesystem
vi.mock('../../src/utils/file-utils', () => ({
  readJsonFile: vi.fn(),
  writeJsonFile: vi.fn(),
  fileExists: vi.fn().mockReturnValue(false),
  ensureDirectory: vi.fn(),
}));

vi.mock('../../src/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('KnowledgeStore', () => {
  let store: KnowledgeStore;

  beforeEach(() => {
    store = new KnowledgeStore('/fake/path/knowledge.json');
    store.load();
  });

  it('should start empty when no file exists', () => {
    expect(store.size).toBe(0);
    expect(store.getAll()).toEqual([]);
  });

  it('should add entries', () => {
    const entry = store.add({
      source: 'healing-history',
      content: 'Test healing entry',
      tags: ['submit', 'button'],
      metadata: { testFile: 'test.spec.ts' },
    });

    expect(entry.id).toBeTruthy();
    expect(entry.createdAt).toBeGreaterThan(0);
    expect(store.size).toBe(1);
  });

  it('should upsert entries (update if matching source + tags)', () => {
    store.add({
      source: 'healing-history',
      content: 'Original content',
      tags: ['submit', 'button'],
      metadata: { testFile: 'test.spec.ts' },
    });

    const updated = store.upsert({
      source: 'healing-history',
      content: 'Updated content',
      tags: ['submit', 'button'],
      metadata: { testFile: 'test.spec.ts', extra: 'value' },
    });

    expect(store.size).toBe(1);
    expect(updated.content).toBe('Updated content');
  });

  it('should create new entry on upsert if tags differ', () => {
    store.add({
      source: 'healing-history',
      content: 'First entry',
      tags: ['submit'],
      metadata: {},
    });

    store.upsert({
      source: 'healing-history',
      content: 'Second entry',
      tags: ['cancel'],
      metadata: {},
    });

    expect(store.size).toBe(2);
  });

  it('should filter by source', () => {
    store.add({
      source: 'healing-history',
      content: 'Healing entry',
      tags: ['tag1'],
      metadata: {},
    });

    store.add({
      source: 'page-objects',
      content: 'Page object entry',
      tags: ['tag2'],
      metadata: {},
    });

    expect(store.getBySource('healing-history')).toHaveLength(1);
    expect(store.getBySource('page-objects')).toHaveLength(1);
    expect(store.getBySource('git-changes')).toHaveLength(0);
  });

  it('should search entries by text similarity', () => {
    store.add({
      source: 'healing-history',
      content: 'page.getByRole button submit login form',
      tags: ['submit', 'button', 'login'],
      metadata: {},
    });

    store.add({
      source: 'healing-history',
      content: 'page.getByText search input query box',
      tags: ['search', 'input'],
      metadata: {},
    });

    const results = store.search('submit button login', {
      similarityThreshold: 0.1,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].content).toContain('submit');
  });

  it('should filter search by source', () => {
    store.add({
      source: 'healing-history',
      content: 'submit button locator healing',
      tags: ['submit'],
      metadata: {},
    });

    store.add({
      source: 'page-objects',
      content: 'submit button page object',
      tags: ['submit'],
      metadata: {},
    });

    const results = store.search('submit button', {
      sources: ['page-objects'],
      similarityThreshold: 0.1,
    });

    expect(results.every((r) => r.source === 'page-objects')).toBe(true);
  });

  it('should return empty results for empty query', () => {
    store.add({
      source: 'healing-history',
      content: 'some content',
      tags: ['tag'],
      metadata: {},
    });

    const results = store.search('');
    expect(results).toEqual([]);
  });

  it('should respect maxResults', () => {
    for (let i = 0; i < 10; i++) {
      store.add({
        source: 'healing-history',
        content: `entry ${i} with common words test locator`,
        tags: ['common'],
        metadata: {},
      });
    }

    const results = store.search('common words test locator', {
      maxResults: 3,
      similarityThreshold: 0.1,
    });

    expect(results.length).toBeLessThanOrEqual(3);
  });
});

// ─── ContextRetriever Tests ──────────────────────────────────────────────────

describe('ContextRetriever', () => {
  let retriever: ContextRetriever;
  let store: KnowledgeStore;
  let ragConfig: RAGConfig;

  beforeEach(() => {
    ragConfig = {
      enabled: true,
      storePath: '/fake/path/knowledge.json',
      maxContextChunks: 5,
      similarityThreshold: 0.1,
      sources: [
        'healing-history',
        'page-objects',
        'git-changes',
        'dom-snapshots',
        'component-docs',
        'test-specs',
      ],
      pageObjectPaths: ['pages'],
      componentDocPaths: [],
    };

    store = new KnowledgeStore(ragConfig.storePath);
    store.load();
    retriever = new ContextRetriever(ragConfig, store);
  });

  const testLocator: LocatorInfo = {
    type: 'css',
    selector: '#submit-btn',
    playwrightExpression: "page.locator('#submit-btn')",
  };

  it('should return empty array when RAG is disabled', () => {
    const disabledConfig = { ...ragConfig, enabled: false };
    const disabledRetriever = new ContextRetriever(disabledConfig, store);

    const results = disabledRetriever.retrieve(
      testLocator,
      'http://example.com/login',
      'click',
      'Timeout waiting for selector',
    );

    expect(results).toEqual([]);
  });

  it('should retrieve relevant context from the store', () => {
    store.add({
      source: 'healing-history',
      content: 'submit btn button click login page locator healed',
      tags: ['submit-btn', 'css', 'http://example.com/login', 'click'],
      metadata: { testFile: 'login.spec.ts' },
    });

    const results = retriever.retrieve(
      testLocator,
      'http://example.com/login',
      'click',
      'Timeout waiting for selector #submit-btn',
    );

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].source).toBe('healing-history');
  });

  it('should ingest healing events', () => {
    const event: HealingEvent = {
      id: 'test_event_1',
      timestamp: Date.now(),
      testTitle: 'should login successfully',
      testFile: 'login.spec.ts',
      pageUrl: 'http://example.com/login',
      action: 'click',
      originalLocator: testLocator,
      healedLocator: {
        type: 'role',
        selector: 'button',
        playwrightExpression: "page.getByRole('button', { name: 'Submit' })",
      },
      strategy: 'role',
      confidence: 0.95,
      reasoning: 'Found matching button by role',
      duration: 150,
      sourceLocation: null,
      status: 'healed',
      reviewStatus: 'pending',
    };

    retriever.ingestHealingEvent(event);
    expect(store.size).toBe(1);
    expect(store.getBySource('healing-history')).toHaveLength(1);
  });

  it('should ingest page object metadata', () => {
    retriever.ingestPageObject(
      'pages/LoginPage.ts',
      ['#username', '#password', '#submit-btn'],
      'LoginPage',
    );

    expect(store.size).toBe(1);
    expect(store.getBySource('page-objects')).toHaveLength(1);
  });

  it('should ingest git changes', () => {
    retriever.ingestGitChange(
      'src/components/Button.tsx',
      '- <button id="submit-btn">\n+ <button id="submit-button">',
      'feat: rename submit button',
    );

    expect(store.size).toBe(1);
    expect(store.getBySource('git-changes')).toHaveLength(1);
  });

  it('should ingest DOM snapshots', () => {
    retriever.ingestDOMSnapshot(
      'http://example.com/login',
      '<form><button id="submit">Submit</button></form>',
      'Login Page',
    );

    expect(store.size).toBe(1);
    expect(store.getBySource('dom-snapshots')).toHaveLength(1);
  });

  it('should ingest component docs', () => {
    retriever.ingestComponentDoc(
      'Button',
      'Primary button component with variants: primary, secondary, danger',
      'docs/Button.md',
    );

    expect(store.size).toBe(1);
    expect(store.getBySource('component-docs')).toHaveLength(1);
  });

  it('should ingest test specs', () => {
    retriever.ingestTestSpec(
      'login.spec.ts',
      'should login with valid credentials',
      ['Navigate to login page', 'Fill username', 'Fill password', 'Click submit'],
    );

    expect(store.size).toBe(1);
    expect(store.getBySource('test-specs')).toHaveLength(1);
  });

  it('should skip ingestion for disabled sources', () => {
    const limitedConfig: RAGConfig = {
      ...ragConfig,
      sources: ['healing-history'], // Only healing-history enabled
    };
    const limitedRetriever = new ContextRetriever(limitedConfig, store);

    limitedRetriever.ingestPageObject('pages/LoginPage.ts', ['#btn'], 'LoginPage');
    limitedRetriever.ingestGitChange('file.ts', 'diff', 'commit');
    limitedRetriever.ingestDOMSnapshot('http://example.com', '<html>', 'Page');
    limitedRetriever.ingestComponentDoc('Button', 'doc', 'docs/Button.md');
    limitedRetriever.ingestTestSpec('test.ts', 'test', ['step1']);

    // None of these should have been ingested since their sources are disabled
    expect(store.size).toBe(0);
  });

  it('should expose the knowledge store', () => {
    expect(retriever.getStore()).toBe(store);
  });
});
