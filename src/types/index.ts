import type { Page, Locator, TestInfo } from '@playwright/test';

// ─── Configuration Types ───────────────────────────────────────────────────────

export interface MindHealConfig {
  ai: AIConfig;
  healing: HealingConfig;
  enterprise: EnterpriseConfig;
  rag: RAGConfig;
  analytics: AnalyticsConfig;
  smartRetry: SmartRetryConfig;
  parallel: ParallelConfig;
  visualVerification: VisualVerificationConfig;
  git: GitConfig;
  reviewServer: ReviewServerConfig;
  reporting: ReportingConfig;
  logging: LoggingConfig;
}

export type AIProviderName =
  | 'anthropic'
  | 'openai'
  | 'azure-openai'
  | 'gemini'
  | 'ollama'
  | 'aws-bedrock'
  | 'deepseek'
  | 'groq'
  | 'qwen'
  | 'meta'
  | 'perplexity';

export interface AIConfig {
  provider: AIProviderName;
  apiKey: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  baseUrl?: string;

  // Azure OpenAI specific
  azureDeploymentName?: string;
  azureApiVersion?: string;

  // AWS Bedrock specific
  awsRegion?: string;
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;
  awsSessionToken?: string;

  // Ollama specific
  ollamaHost?: string;
}

export interface HealingConfig {
  enabled: boolean;
  maxRetries: number;
  strategies: HealingStrategyName[];
  confidenceThreshold: number;
  cacheHeals: boolean;
  cachePath?: string;
  excludePatterns?: string[];
  domSnapshotDepth?: number;
  handleDialogs: boolean | DialogHandlingConfig;
}

export type EnterprisePlatform =
  | 'auto'
  | 'salesforce'
  | 'sap'
  | 'oracle'
  | 'workday'
  | 'servicenow'
  | 'dynamics';

export interface EnterpriseConfig {
  /** Enable enterprise-specific healing strategies. Default: true */
  enabled: boolean;
  /** Auto-detect platform or specify explicitly. Default: 'auto' */
  platform: EnterprisePlatform;
  /** Wait for enterprise loading indicators before healing. Default: true */
  waitForLoad: boolean;
  /** Max time (ms) to wait for loading indicators. Default: 15000 */
  loadTimeout: number;
  /** Attempt virtual scroll to bring elements into view. Default: true */
  virtualScrolling: boolean;
  /** Custom virtual scroll container selector. Default: auto-detected */
  scrollContainerSelector?: string;
  /** Extra stable attribute names to prioritize (added to built-in list). Default: [] */
  customStableAttributes: string[];
  /** Custom dynamic ID patterns (regex strings) to detect and strip. Default: [] */
  customDynamicIdPatterns: string[];
}

export interface DialogHandlingConfig {
  /** Auto-dismiss alert() dialogs. Default: true */
  dismissAlerts: boolean;
  /** Auto-accept confirm() dialogs. Default: true */
  acceptConfirms: boolean;
  /** Auto-respond to prompt() dialogs with this value. Default: '' */
  promptResponse: string;
  /** Log dialog events. Default: true */
  logDialogs: boolean;
}

export interface GitConfig {
  enabled: boolean;
  provider: 'github' | 'gitlab' | 'bitbucket';
  token: string;
  baseBranch?: string;
  branchPrefix?: string;
  autoCreatePR: boolean;
  commitMessagePrefix?: string;
  prLabels?: string[];
  prReviewers?: string[];
  repoOwner?: string;
  repoName?: string;
}

export interface ReviewServerConfig {
  enabled: boolean | 'auto';
  port: number;
  openBrowser: boolean;
  autoCloseAfterReview: boolean;
}

export interface ReportingConfig {
  outputDir?: string;
  generateHTML: boolean;
  generateJSON: boolean;
}

export interface LoggingConfig {
  level: 'debug' | 'info' | 'warn' | 'error';
  file?: string;
}

// ─── Healing Types ─────────────────────────────────────────────────────────────

export type HealingStrategyName =
  | 'cache'
  | 'attribute'
  | 'text'
  | 'role'
  | 'css'
  | 'xpath'
  | 'table'
  | 'modal'
  | 'enterprise'
  | 'ai';

export interface HealingResult {
  success: boolean;
  originalLocator: LocatorInfo;
  healedLocator: LocatorInfo | null;
  strategy: HealingStrategyName | null;
  confidence: number;
  reasoning: string;
  duration: number;
  attempts: StrategyAttempt[];
}

export interface StrategyAttempt {
  strategy: HealingStrategyName;
  locator: LocatorInfo | null;
  confidence: number;
  duration: number;
  error?: string;
}

export interface LocatorInfo {
  type: LocatorType;
  selector: string;
  options?: Record<string, unknown>;
  playwrightExpression: string;
}

export type LocatorType =
  | 'css'
  | 'xpath'
  | 'role'
  | 'text'
  | 'testid'
  | 'label'
  | 'placeholder'
  | 'alttext'
  | 'title';

export interface HealingEvent {
  id: string;
  timestamp: number;
  testTitle: string;
  testFile: string;
  pageUrl: string;
  action: string;
  originalLocator: LocatorInfo;
  healedLocator: LocatorInfo | null;
  strategy: HealingStrategyName | null;
  confidence: number;
  reasoning: string;
  duration: number;
  sourceLocation: SourceLocation | null;
  status: 'healed' | 'failed';
  reviewStatus: 'pending' | 'approved' | 'rejected';
}

export interface SourceLocation {
  filePath: string;
  line: number;
  column: number;
}

// ─── DOM Snapshot Types ────────────────────────────────────────────────────────

export interface DOMSnapshot {
  html: string;
  url: string;
  title: string;
  timestamp: number;
  rootSelector?: string;
}

export interface DOMElement {
  tag: string;
  id?: string;
  classes?: string[];
  attributes: Record<string, string>;
  text?: string;
  children: DOMElement[];
  role?: string;
  ariaLabel?: string;
  testId?: string;
}

// ─── AI Provider Types ─────────────────────────────────────────────────────────

export interface AIProvider {
  name: string;
  suggestLocator(request: AIHealingRequest): Promise<AIHealingResponse>;
}

export interface AIHealingRequest {
  originalLocator: LocatorInfo;
  domSnapshot: string;
  pageUrl: string;
  action: string;
  errorMessage: string;
  nearbyElements?: string;
  /** RAG-retrieved context chunks to enhance the AI prompt */
  ragContext?: RAGContextChunk[];
}

export interface AIHealingResponse {
  selector: string;
  locatorType: LocatorType;
  confidence: number;
  reasoning: string;
  playwrightExpression: string;
}

// ─── Git Types ─────────────────────────────────────────────────────────────────

export interface PRDetails {
  title: string;
  body: string;
  sourceBranch: string;
  targetBranch: string;
  labels: string[];
  reviewers: string[];
}

export interface PRResult {
  url: string;
  number: number;
  provider: string;
}

export interface CodeModification {
  filePath: string;
  line: number;
  column: number;
  originalCode: string;
  modifiedCode: string;
  healingEvent: HealingEvent;
}

// ─── Review Server Types ───────────────────────────────────────────────────────

export interface ReviewAction {
  eventId: string;
  action: 'approve' | 'reject' | 'edit';
  editedLocator?: string;
}

export interface ReviewSummary {
  total: number;
  approved: number;
  rejected: number;
  pending: number;
}

// ─── Cache Types ───────────────────────────────────────────────────────────────

export interface CacheEntry {
  originalSelector: string;
  originalType: LocatorType;
  healedSelector: string;
  healedType: LocatorType;
  healedExpression: string;
  pageUrlPattern: string;
  confidence: number;
  strategy: HealingStrategyName;
  createdAt: number;
  usageCount: number;
  lastUsed: number;
}

export interface HealCache {
  version: string;
  entries: Record<string, CacheEntry>;
}

// ─── Reporter Types ────────────────────────────────────────────────────────────

export interface HealReport {
  sessionId: string;
  startTime: number;
  endTime: number;
  totalTests: number;
  totalHeals: number;
  successfulHeals: number;
  failedHeals: number;
  events: HealingEvent[];
  config: Partial<MindHealConfig>;
}

// ─── Session Types ─────────────────────────────────────────────────────────────

export interface HealingSession {
  id: string;
  startTime: number;
  events: HealingEvent[];
  config: MindHealConfig;
}

// ─── RAG Types ────────────────────────────────────────────────────────────────

export interface RAGConfig {
  /** Enable RAG-enhanced AI healing. Default: true */
  enabled: boolean;
  /** Path to the knowledge store file. Default: '.mindheal/knowledge.json' */
  storePath: string;
  /** Maximum number of context chunks to include in the AI prompt. Default: 5 */
  maxContextChunks: number;
  /** Minimum similarity score (0-1) for a chunk to be included. Default: 0.3 */
  similarityThreshold: number;
  /** Knowledge sources to enable. Default: all sources */
  sources: RAGSourceName[];
  /** Paths to scan for page object source files. Default: ['pages', 'src/pages', 'page-objects'] */
  pageObjectPaths: string[];
  /** Paths to scan for component/design system docs. Default: [] */
  componentDocPaths: string[];
}

export type RAGSourceName =
  | 'healing-history'
  | 'page-objects'
  | 'git-changes'
  | 'dom-snapshots'
  | 'component-docs'
  | 'test-specs';

export interface RAGContextChunk {
  source: RAGSourceName;
  content: string;
  relevanceScore: number;
  metadata: Record<string, string>;
}

export interface RAGKnowledgeEntry {
  id: string;
  source: RAGSourceName;
  content: string;
  tags: string[];
  metadata: Record<string, string>;
  createdAt: number;
  updatedAt: number;
}

export interface RAGKnowledgeStore {
  version: string;
  entries: RAGKnowledgeEntry[];
}

// ─── Analytics Types ─────────────────────────────────────────────────────────

export interface AnalyticsConfig {
  /** Enable analytics tracking. Default: true */
  enabled: boolean;
  /** Path to the analytics data file. Default: '.mindheal/analytics.json' */
  storePath: string;
  /** Track per-locator healing frequency. Default: true */
  trackLocators: boolean;
  /** Track per-strategy effectiveness. Default: true */
  trackStrategies: boolean;
  /** Track per-test stability scores. Default: true */
  trackTestStability: boolean;
  /** Max history entries to retain. Default: 5000 */
  maxEntries: number;
  /** Auto-prune entries older than this many days. Default: 90 */
  retentionDays: number;
}

export interface AnalyticsEntry {
  timestamp: number;
  testFile: string;
  testTitle: string;
  pageUrl: string;
  locatorExpression: string;
  action: string;
  strategy: HealingStrategyName | null;
  confidence: number;
  duration: number;
  success: boolean;
}

export interface AnalyticsSnapshot {
  version: string;
  entries: AnalyticsEntry[];
  strategyStats: Record<string, StrategyStats>;
  locatorStats: Record<string, LocatorStats>;
  testStability: Record<string, TestStabilityRecord>;
  lastUpdated: number;
}

export interface StrategyStats {
  name: string;
  totalAttempts: number;
  successCount: number;
  failCount: number;
  avgConfidence: number;
  avgDuration: number;
  successRate: number;
}

export interface LocatorStats {
  expression: string;
  healCount: number;
  failCount: number;
  lastHealed: number;
  strategies: string[];
  pages: string[];
}

export interface TestStabilityRecord {
  testFile: string;
  testTitle: string;
  totalRuns: number;
  healsNeeded: number;
  failedHeals: number;
  stabilityScore: number; // 0-100
  lastRun: number;
  trend: 'improving' | 'stable' | 'degrading';
}

// ─── Smart Retry Types ──────────────────────────────────────────────────────

export interface SmartRetryConfig {
  /** Enable smart retry intelligence. Default: true */
  enabled: boolean;
  /** Wait for network idle before healing. Default: true */
  waitForNetworkIdle: boolean;
  /** Network idle timeout in ms. Default: 5000 */
  networkIdleTimeout: number;
  /** Use exponential backoff between retry attempts. Default: true */
  exponentialBackoff: boolean;
  /** Base delay (ms) for exponential backoff. Default: 500 */
  backoffBaseDelay: number;
  /** Max delay (ms) for exponential backoff. Default: 10000 */
  backoffMaxDelay: number;
  /** Enable flaky test detection. Default: true */
  flakyDetection: boolean;
  /** Number of consecutive failures before marking as flaky (vs broken). Default: 3 */
  flakyThreshold: number;
  /** Path to flaky test tracking data. Default: '.mindheal/flaky-tests.json' */
  flakyStorePath: string;
}

export interface FlakyTestEntry {
  testFile: string;
  testTitle: string;
  locatorExpression: string;
  failureCount: number;
  successCount: number;
  consecutiveFailures: number;
  isFlaky: boolean;
  lastSeen: number;
  history: Array<{ timestamp: number; passed: boolean }>;
}

export interface FlakyTestStore {
  version: string;
  entries: Record<string, FlakyTestEntry>;
}

// ─── Parallel Safety Types ──────────────────────────────────────────────────

export interface ParallelConfig {
  /** Enable parallel-safe file operations. Default: true */
  enabled: boolean;
  /** Lock timeout in ms. Default: 10000 */
  lockTimeout: number;
  /** Retry interval for acquiring locks in ms. Default: 50 */
  lockRetryInterval: number;
  /** Stale lock threshold in ms (auto-release). Default: 30000 */
  staleLockThreshold: number;
}

// ─── Visual Verification Types ──────────────────────────────────────────────

export interface VisualVerificationConfig {
  /** Enable visual verification after healing. Default: false */
  enabled: boolean;
  /** Directory to store verification screenshots. Default: '.mindheal/screenshots' */
  screenshotDir: string;
  /** Pixel difference threshold (0-1). Default: 0.1 */
  diffThreshold: number;
  /** Capture element screenshot after healing for comparison. Default: true */
  captureElement: boolean;
  /** Capture full page screenshot for context. Default: false */
  captureFullPage: boolean;
  /** Keep screenshots after verification. Default: true */
  keepScreenshots: boolean;
}

export interface VisualVerificationResult {
  verified: boolean;
  elementScreenshotPath: string | null;
  fullPageScreenshotPath: string | null;
  boundingBox: { x: number; y: number; width: number; height: number } | null;
  elementVisible: boolean;
  elementInViewport: boolean;
  timestamp: number;
}

// ─── Playwright Extended Types ─────────────────────────────────────────────────

export interface MindHealFixtures {
  page: Page;
}

export interface MindHealWorkerFixtures {
  _mindHealSession: HealingSession;
}
