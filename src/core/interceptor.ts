import { test as baseTest, type Page, type Locator, type Frame, type FrameLocator, type TestInfo } from '@playwright/test';
import type {
  MindHealConfig,
  HealingSession,
  HealingEvent,
  LocatorInfo,
  LocatorType,
  SourceLocation,
  HealingResult,
  DialogHandlingConfig,
  MindHealFixtures,
  MindHealWorkerFixtures,
} from '../types/index';
import { Healer } from './healer';
import { SelfHealCache } from './self-heal-cache';
import { analyzeLocator, getLocatorHash } from './locator-analyzer';
import { createAIProvider } from '../ai/ai-provider';
import { loadConfig } from '../config/config-loader';
import { logger } from '../utils/logger';
import { isCI } from '../utils/environment';
import { KnowledgeStore } from '../rag/knowledge-store';
import { ContextRetriever } from '../rag/context-retriever';
import { SmartRetry } from './smart-retry';
import { VisualVerifier } from './visual-verification';
import { HealingAnalytics } from '../analytics/healing-analytics';
import { FileLock } from '../utils/file-lock';

// ─── Global session manager ──────────────────────────────────────────────────

/**
 * A global map that allows the reporter (which runs in a separate context)
 * to access healing sessions keyed by a deterministic test-worker id.
 */
const _sessions = new Map<string, HealingSession>();

export function getHealingSession(sessionId: string): HealingSession | undefined {
  return _sessions.get(sessionId);
}

export function getAllHealingSessions(): HealingSession[] {
  return Array.from(_sessions.values());
}

// ─── Source location extraction ──────────────────────────────────────────────

/**
 * Parses an Error stack trace to find the originating test file and line.
 * Skips frames that originate from node_modules or from this module itself.
 */
function extractSourceLocation(error: Error): SourceLocation | null {
  const stack = error.stack;
  if (!stack) return null;

  const lines = stack.split('\n');
  for (const line of lines) {
    // Skip frames from mindheal internals and node_modules
    if (line.includes('node_modules')) continue;
    if (line.includes('interceptor.ts') || line.includes('interceptor.js')) continue;
    if (line.includes('healer.ts') || line.includes('healer.js')) continue;

    // Match common stack frame patterns:
    //   at Function (file:line:col)
    //   at file:line:col
    const match = line.match(/\(?([^()]+?):(\d+):(\d+)\)?$/);
    if (match) {
      const filePath = match[1].replace(/^file:\/\/\//, '');
      const lineNum = parseInt(match[2], 10);
      const column = parseInt(match[3], 10);
      if (!isNaN(lineNum) && !isNaN(column)) {
        return { filePath, line: lineNum, column };
      }
    }
  }

  return null;
}

// ─── Event ID generation ─────────────────────────────────────────────────────

function generateEventId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `evt_${timestamp}_${random}`;
}

// ─── Method-to-type mapping ──────────────────────────────────────────────────

const PAGE_LOCATOR_METHODS = [
  'locator',
  'getByRole',
  'getByText',
  'getByTestId',
  'getByLabel',
  'getByPlaceholder',
  'getByAltText',
  'getByTitle',
] as const;

type PageLocatorMethod = (typeof PAGE_LOCATOR_METHODS)[number];

const METHOD_TO_TYPE: Record<PageLocatorMethod, LocatorType> = {
  locator: 'css',
  getByRole: 'role',
  getByText: 'text',
  getByTestId: 'testid',
  getByLabel: 'label',
  getByPlaceholder: 'placeholder',
  getByAltText: 'alttext',
  getByTitle: 'title',
};

/**
 * Actions that perform mutations or interactions and should trigger healing on failure.
 */
const INTERCEPTED_ACTIONS = new Set([
  'click',
  'fill',
  'type',
  'check',
  'uncheck',
  'selectOption',
  'hover',
  'press',
  'dblclick',
  'textContent',
  'innerText',
  'innerHTML',
  'inputValue',
  'isVisible',
  'isEnabled',
  'isChecked',
  'waitFor',
]);

// ─── Locator info helpers ────────────────────────────────────────────────────

function buildLocatorInfo(
  method: PageLocatorMethod,
  args: unknown[],
): LocatorInfo {
  const selector = typeof args[0] === 'string' ? args[0] : String(args[0]);
  const options = args.length > 1 && typeof args[1] === 'object' && args[1] !== null
    ? (args[1] as Record<string, unknown>)
    : undefined;

  let expression: string;
  if (method === 'locator') {
    expression = options
      ? `page.locator('${selector}', ${JSON.stringify(options)})`
      : `page.locator('${selector}')`;
  } else if (options) {
    expression = `page.${method}('${selector}', ${JSON.stringify(options)})`;
  } else {
    expression = `page.${method}('${selector}')`;
  }

  return {
    type: METHOD_TO_TYPE[method],
    selector,
    options,
    playwrightExpression: expression,
  };
}

// ─── Error classification ────────────────────────────────────────────────────

/**
 * Determines whether an error is a locator-resolution failure that healing
 * can potentially fix (timeout waiting for element, strict mode violation, etc.).
 */
function isHealableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const msg = error.message.toLowerCase();

  // Playwright TimeoutError when waiting for a selector
  if (error.name === 'TimeoutError') return true;

  // Strict mode violation (multiple elements matched)
  if (msg.includes('strict mode violation')) return true;

  // Element not found patterns
  if (msg.includes('waiting for selector') || msg.includes('waiting for locator')) return true;
  if (msg.includes('no element matches selector')) return true;
  if (msg.includes('resolved to') && msg.includes('element')) return true;

  return false;
}

// ─── Locator Proxy ───────────────────────────────────────────────────────────

/**
 * Wraps a Playwright Locator so that any intercepted action automatically
 * triggers the healing pipeline when the original locator fails.
 */
function createHealingLocatorProxy(
  originalLocator: Locator,
  locatorInfo: LocatorInfo,
  page: Page,
  healer: Healer,
  session: HealingSession,
  config: MindHealConfig,
): Locator {
  const handler: ProxyHandler<Locator> = {
    get(target: Locator, prop: string | symbol, receiver: unknown): unknown {
      const value = Reflect.get(target, prop, receiver);

      // Only intercept known action methods.
      if (typeof prop !== 'string' || !INTERCEPTED_ACTIONS.has(prop)) {
        // Special-case: the .locator() method on a Locator returns a chained
        // locator. We need to wrap it so healing propagates.
        if (prop === 'locator' && typeof value === 'function') {
          return function chainedLocator(this: Locator, ...args: unknown[]): Locator {
            const childLocator = (value as Function).apply(target, args);
            const childSelector = typeof args[0] === 'string' ? args[0] : String(args[0]);
            const childInfo: LocatorInfo = {
              type: 'css',
              selector: childSelector,
              playwrightExpression: `${locatorInfo.playwrightExpression}.locator('${childSelector}')`,
            };
            return createHealingLocatorProxy(
              childLocator,
              childInfo,
              page,
              healer,
              session,
              config,
            );
          };
        }

        // Bind functions so they keep the correct `this`.
        if (typeof value === 'function') {
          return (value as Function).bind(target);
        }
        return value;
      }

      // Return a wrapper function for the intercepted action.
      return async function interceptedAction(this: Locator, ...args: unknown[]): Promise<unknown> {
        const actionName = prop as string;

        try {
          // Happy path: try the original locator action.
          return await (value as Function).apply(target, args);
        } catch (originalError) {
          // Only attempt healing for locator-resolution failures.
          if (!isHealableError(originalError) || !config.healing.enabled) {
            throw originalError;
          }

          logger.info(
            `Action "${actionName}" failed on "${locatorInfo.playwrightExpression}". Attempting healing...`,
          );

          const sourceLocation = extractSourceLocation(originalError as Error);

          let healingResult: HealingResult;
          try {
            healingResult = await healer.heal(
              page,
              locatorInfo,
              actionName,
              originalError as Error,
            );
          } catch (healError) {
            const msg = healError instanceof Error ? healError.message : String(healError);
            logger.error(`Healing itself threw an error: ${msg}`);
            // Record the failure and re-throw the ORIGINAL error.
            recordHealingEvent(session, page, locatorInfo, null, actionName, sourceLocation, false);
            throw originalError;
          }

          if (!healingResult.success || !healingResult.healedLocator) {
            logger.warn(
              `Healing failed for "${locatorInfo.playwrightExpression}". Re-throwing original error.`,
            );
            recordHealingEvent(session, page, locatorInfo, healingResult, actionName, sourceLocation, false);
            throw originalError;
          }

          // Healing succeeded -- record the event and retry the action with the
          // healed locator.
          logger.info(
            `Retrying "${actionName}" with healed locator: ${healingResult.healedLocator.playwrightExpression}`,
          );

          recordHealingEvent(session, page, locatorInfo, healingResult, actionName, sourceLocation, true);

          try {
            const healedPwLocator = resolveLocator(page, healingResult.healedLocator);
            return await (healedPwLocator as unknown as Record<string, Function>)[actionName](...args);
          } catch (retryError) {
            logger.error(
              `Retry with healed locator also failed: ${(retryError as Error).message}`,
            );
            // Throw the ORIGINAL error so the test's error message stays sensible.
            throw originalError;
          }
        }
      };
    },
  };

  return new Proxy(originalLocator, handler);
}

// ─── Locator resolution ──────────────────────────────────────────────────────

/**
 * Converts a LocatorInfo back into a live Playwright Locator on the given page.
 */
function resolveLocator(page: Page, info: LocatorInfo): Locator {
  switch (info.type) {
    case 'role': {
      const name = info.options?.['name'] as string | undefined;
      const opts = name ? { name } : undefined;
      return page.getByRole(info.selector as Parameters<Page['getByRole']>[0], opts);
    }
    case 'text':
      return page.getByText(info.selector);
    case 'testid':
      return page.getByTestId(info.selector);
    case 'label':
      return page.getByLabel(info.selector);
    case 'placeholder':
      return page.getByPlaceholder(info.selector);
    case 'alttext':
      return page.getByAltText(info.selector);
    case 'title':
      return page.getByTitle(info.selector);
    case 'css':
    case 'xpath':
    default:
      return page.locator(info.selector);
  }
}

// ─── Healing event recording ─────────────────────────────────────────────────

function recordHealingEvent(
  session: HealingSession,
  page: Page,
  originalLocator: LocatorInfo,
  healingResult: HealingResult | null,
  action: string,
  sourceLocation: SourceLocation | null,
  success: boolean,
): void {
  let pageUrl = 'unknown';
  try {
    pageUrl = page.url();
  } catch {
    // Page may have been closed.
  }

  const event: HealingEvent = {
    id: generateEventId(),
    timestamp: Date.now(),
    testTitle: '',
    testFile: sourceLocation?.filePath ?? '',
    pageUrl,
    action,
    originalLocator,
    healedLocator: healingResult?.healedLocator ?? null,
    strategy: healingResult?.strategy ?? null,
    confidence: healingResult?.confidence ?? 0,
    reasoning: healingResult?.reasoning ?? 'Healing was not attempted or failed.',
    duration: healingResult?.duration ?? 0,
    sourceLocation,
    status: success ? 'healed' : 'failed',
    reviewStatus: 'pending',
  };

  session.events.push(event);
}

// ─── Frame Proxy ────────────────────────────────────────────────────────────

/**
 * Wraps a Playwright Frame so that locator-creation methods on the frame
 * also go through the healing pipeline.
 */
function createHealingFrameProxy(
  frame: Frame,
  page: Page,
  healer: Healer,
  session: HealingSession,
  config: MindHealConfig,
): Frame {
  const handler: ProxyHandler<Frame> = {
    get(target: Frame, prop: string | symbol, receiver: unknown): unknown {
      const value = Reflect.get(target, prop, receiver);

      if (typeof prop !== 'string') {
        if (typeof value === 'function') {
          return (value as Function).bind(target);
        }
        return value;
      }

      // Intercept locator-creation methods on the Frame.
      if ((PAGE_LOCATOR_METHODS as readonly string[]).includes(prop)) {
        return function interceptedFrameLocatorCreation(...args: unknown[]): Locator {
          const method = prop as PageLocatorMethod;
          const originalLocator: Locator = (value as Function).apply(target, args);

          if (!config.healing.enabled) {
            return originalLocator;
          }

          const locatorInfo = buildLocatorInfo(method, args);
          // Prefix expression with frame context
          locatorInfo.playwrightExpression = `frame.${locatorInfo.playwrightExpression.replace('page.', '')}`;
          return createHealingLocatorProxy(
            originalLocator,
            locatorInfo,
            page,
            healer,
            session,
            config,
          );
        };
      }

      // Intercept frameLocator on Frame (nested frames)
      if (prop === 'frameLocator' && typeof value === 'function') {
        return function interceptedNestedFrameLocator(...args: unknown[]): FrameLocator {
          const originalFrameLocator: FrameLocator = (value as Function).apply(target, args);
          return createHealingFrameLocatorProxy(
            originalFrameLocator,
            page,
            healer,
            session,
            config,
          );
        };
      }

      if (typeof value === 'function') {
        return (value as Function).bind(target);
      }
      return value;
    },
  };

  return new Proxy(frame, handler);
}

// ─── FrameLocator Proxy ─────────────────────────────────────────────────────

/**
 * Wraps a Playwright FrameLocator so that locator-creation methods on it
 * produce healing-enabled locators. FrameLocator is a builder — it returns
 * Locators that resolve inside the iframe.
 */
function createHealingFrameLocatorProxy(
  frameLocator: FrameLocator,
  page: Page,
  healer: Healer,
  session: HealingSession,
  config: MindHealConfig,
): FrameLocator {
  const handler: ProxyHandler<FrameLocator> = {
    get(target: FrameLocator, prop: string | symbol, receiver: unknown): unknown {
      const value = Reflect.get(target, prop, receiver);

      if (typeof prop !== 'string') {
        if (typeof value === 'function') {
          return (value as Function).bind(target);
        }
        return value;
      }

      // Intercept locator-creation methods on the FrameLocator.
      if ((PAGE_LOCATOR_METHODS as readonly string[]).includes(prop)) {
        return function interceptedFrameLocatorCreation(...args: unknown[]): Locator {
          const method = prop as PageLocatorMethod;
          const originalLocator: Locator = (value as Function).apply(target, args);

          if (!config.healing.enabled) {
            return originalLocator;
          }

          const locatorInfo = buildLocatorInfo(method, args);
          locatorInfo.playwrightExpression = `frameLocator.${locatorInfo.playwrightExpression.replace('page.', '')}`;
          return createHealingLocatorProxy(
            originalLocator,
            locatorInfo,
            page,
            healer,
            session,
            config,
          );
        };
      }

      // Nested frameLocator (e.g., page.frameLocator('#outer').frameLocator('#inner'))
      if (prop === 'frameLocator' && typeof value === 'function') {
        return function nestedFrameLocator(...args: unknown[]): FrameLocator {
          const nested: FrameLocator = (value as Function).apply(target, args);
          return createHealingFrameLocatorProxy(nested, page, healer, session, config);
        };
      }

      if (typeof value === 'function') {
        return (value as Function).bind(target);
      }
      return value;
    },
  };

  return new Proxy(frameLocator, handler);
}

// ─── Page Proxy ──────────────────────────────────────────────────────────────

/**
 * Wraps a Playwright Page in a Proxy that intercepts locator-creation methods
 * so every returned Locator is automatically wrapped with healing logic.
 * Also intercepts frame() and frameLocator() to propagate healing into iframes.
 */
function createHealingPageProxy(
  page: Page,
  healer: Healer,
  session: HealingSession,
  config: MindHealConfig,
): Page {
  // Attach the session to the page for reporter access.
  (page as unknown as Record<string, unknown>)['_mindHealSession'] = session;

  const handler: ProxyHandler<Page> = {
    get(target: Page, prop: string | symbol, receiver: unknown): unknown {
      const value = Reflect.get(target, prop, receiver);

      if (typeof prop !== 'string') {
        if (typeof value === 'function') {
          return (value as Function).bind(target);
        }
        return value;
      }

      // Intercept locator-creation methods.
      if ((PAGE_LOCATOR_METHODS as readonly string[]).includes(prop)) {
        return function interceptedLocatorCreation(...args: unknown[]): Locator {
          const method = prop as PageLocatorMethod;
          const originalLocator: Locator = (value as Function).apply(target, args);

          if (!config.healing.enabled) {
            return originalLocator;
          }

          const locatorInfo = buildLocatorInfo(method, args);
          return createHealingLocatorProxy(
            originalLocator,
            locatorInfo,
            target,
            healer,
            session,
            config,
          );
        };
      }

      // Intercept page.frame() — returns a Frame or null.
      if (prop === 'frame' && typeof value === 'function') {
        return function interceptedFrame(...args: unknown[]): Frame | null {
          const frame: Frame | null = (value as Function).apply(target, args);
          if (!frame || !config.healing.enabled) return frame;
          return createHealingFrameProxy(frame, target, healer, session, config);
        };
      }

      // Intercept page.frameLocator() — returns a FrameLocator.
      if (prop === 'frameLocator' && typeof value === 'function') {
        return function interceptedFrameLocator(...args: unknown[]): FrameLocator {
          const frameLocator: FrameLocator = (value as Function).apply(target, args);
          if (!config.healing.enabled) return frameLocator;
          return createHealingFrameLocatorProxy(frameLocator, target, healer, session, config);
        };
      }

      // Intercept page.frames() — returns Frame[].
      if (prop === 'frames' && typeof value === 'function') {
        return function interceptedFrames(...args: unknown[]): Frame[] {
          const frames: Frame[] = (value as Function).apply(target, args);
          if (!config.healing.enabled) return frames;
          return frames.map((f) => createHealingFrameProxy(f, target, healer, session, config));
        };
      }

      // Intercept page.mainFrame() — returns Frame.
      if (prop === 'mainFrame' && typeof value === 'function') {
        return function interceptedMainFrame(...args: unknown[]): Frame {
          const frame: Frame = (value as Function).apply(target, args);
          if (!config.healing.enabled) return frame;
          return createHealingFrameProxy(frame, target, healer, session, config);
        };
      }

      // Bind all other functions so they keep correct `this`.
      if (typeof value === 'function') {
        return (value as Function).bind(target);
      }
      return value;
    },
  };

  return new Proxy(page, handler);
}

// ─── Dialog handling ────────────────────────────────────────────────────────

/**
 * Default dialog handling configuration.
 */
const DEFAULT_DIALOG_CONFIG: DialogHandlingConfig = {
  dismissAlerts: true,
  acceptConfirms: true,
  promptResponse: '',
  logDialogs: true,
};

/**
 * Resolves the dialog handling config from the healing config.
 */
function resolveDialogConfig(config: MindHealConfig): DialogHandlingConfig | null {
  const handleDialogs = config.healing.handleDialogs;

  if (handleDialogs === false) return null;
  if (handleDialogs === true) return DEFAULT_DIALOG_CONFIG;
  if (typeof handleDialogs === 'object') {
    return { ...DEFAULT_DIALOG_CONFIG, ...handleDialogs };
  }
  return DEFAULT_DIALOG_CONFIG;
}

/**
 * Installs an automatic dialog handler on the page that handles
 * alert(), confirm(), and prompt() browser dialogs so they don't
 * block test execution.
 *
 * Returns a cleanup function to remove the listener.
 */
function installDialogHandler(
  page: Page,
  dialogConfig: DialogHandlingConfig,
  session: HealingSession,
): () => void {
  const handler = async (dialog: { type: () => string; message: () => string; accept: (promptText?: string) => Promise<void>; dismiss: () => Promise<void> }) => {
    const dialogType = dialog.type(); // 'alert' | 'confirm' | 'prompt' | 'beforeunload'
    const message = dialog.message();

    if (dialogConfig.logDialogs) {
      logger.info(`[MindHeal] Browser ${dialogType} dialog intercepted: "${message.substring(0, 200)}"`);
    }

    // Record as a session event for reporting
    const event: HealingEvent = {
      id: generateEventId(),
      timestamp: Date.now(),
      testTitle: '',
      testFile: '',
      pageUrl: safeGetUrl(page),
      action: `dialog:${dialogType}`,
      originalLocator: {
        type: 'css',
        selector: `[dialog:${dialogType}]`,
        playwrightExpression: `page.on('dialog') // ${dialogType}: "${message.substring(0, 100)}"`,
      },
      healedLocator: {
        type: 'css',
        selector: `[dialog:${dialogType}:auto-handled]`,
        playwrightExpression: dialogType === 'alert'
          ? 'dialog.dismiss()'
          : dialogType === 'confirm'
            ? 'dialog.accept()'
            : `dialog.accept('${dialogConfig.promptResponse}')`,
      },
      strategy: null,
      confidence: 1.0,
      reasoning: `Auto-handled browser ${dialogType} dialog: "${message.substring(0, 100)}"`,
      duration: 0,
      sourceLocation: null,
      status: 'healed',
      reviewStatus: 'approved',
    };
    session.events.push(event);

    try {
      switch (dialogType) {
        case 'alert':
          if (dialogConfig.dismissAlerts) {
            await dialog.dismiss();
          } else {
            await dialog.accept();
          }
          break;

        case 'confirm':
          if (dialogConfig.acceptConfirms) {
            await dialog.accept();
          } else {
            await dialog.dismiss();
          }
          break;

        case 'prompt':
          await dialog.accept(dialogConfig.promptResponse);
          break;

        case 'beforeunload':
          await dialog.accept();
          break;

        default:
          await dialog.dismiss();
          break;
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn(`[MindHeal] Failed to handle ${dialogType} dialog: ${msg}`);
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  page.on('dialog', handler as any);

  return () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    page.off('dialog', handler as any);
  };
}

function safeGetUrl(page: Page): string {
  try {
    return page.url();
  } catch {
    return 'unknown';
  }
}

// ─── Fixture factory ─────────────────────────────────────────────────────────

/**
 * Creates a Playwright fixture that wraps the built-in `page` fixture with the
 * MindHeal healing proxy. Tests require zero changes; failures are healed
 * transparently.
 *
 * Usage:
 * ```ts
 * import { createMindHealFixture } from 'mindheal';
 * const test = createMindHealFixture(myConfig);
 * ```
 */
export function createMindHealFixture(config: MindHealConfig) {
  // Shared, long-lived objects -- one per worker.
  let cache: SelfHealCache | null = null;
  let healer: Healer | null = null;

  return baseTest.extend<MindHealFixtures, MindHealWorkerFixtures>({
    // Worker-scoped fixture: one healing session per worker.
    _mindHealSession: [
      async ({}, use) => {
        const sessionId = `session_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
        const session: HealingSession = {
          id: sessionId,
          startTime: Date.now(),
          events: [],
          config,
        };
        _sessions.set(sessionId, session);

        // Initialise cache and healer once per worker.
        cache = new SelfHealCache(config.healing.cachePath);
        cache.load();

        let aiProvider = null;
        if (config.ai.apiKey && config.healing.strategies.includes('ai')) {
          try {
            aiProvider = createAIProvider(config.ai);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.warn(`Failed to create AI provider: ${msg}. AI strategy will be skipped.`);
          }
        }

        // Initialize RAG context retriever if enabled.
        let contextRetriever: ContextRetriever | null = null;
        if (config.rag?.enabled) {
          try {
            const knowledgeStore = new KnowledgeStore(config.rag.storePath);
            knowledgeStore.load();
            contextRetriever = new ContextRetriever(config.rag, knowledgeStore);
            logger.debug(`RAG context retriever initialized (${knowledgeStore.size} entries)`);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.warn(`Failed to initialize RAG: ${msg}. Continuing without RAG.`);
          }
        }

        // Initialize smart retry, visual verifier, and analytics.
        let smartRetry: SmartRetry | null = null;
        if (config.smartRetry?.enabled) {
          smartRetry = new SmartRetry(config.smartRetry);
          smartRetry.load();
        }

        let visualVerifier: VisualVerifier | null = null;
        if (config.visualVerification?.enabled) {
          visualVerifier = new VisualVerifier(config.visualVerification);
        }

        let analytics: HealingAnalytics | null = null;
        if (config.analytics?.enabled) {
          analytics = new HealingAnalytics(config.analytics);
          analytics.load();
        }

        healer = new Healer(config, aiProvider, cache, contextRetriever, smartRetry, visualVerifier, analytics);

        // Stash references for post-healing operations.
        (session as unknown as Record<string, unknown>)['_contextRetriever'] = contextRetriever;
        (session as unknown as Record<string, unknown>)['_analytics'] = analytics;
        (session as unknown as Record<string, unknown>)['_smartRetry'] = smartRetry;

        await use(session);

        // Teardown: ingest healing events into RAG store and analytics, then save.
        for (const event of session.events) {
          if (contextRetriever) contextRetriever.ingestHealingEvent(event);
          if (analytics) analytics.recordEvent(event);
          if (smartRetry) {
            smartRetry.recordAttempt(
              event.testFile, event.testTitle, event.originalLocator, event.status === 'healed',
            );
          }
        }

        // Parallel-safe saves with file locking
        const fileLock = config.parallel?.enabled ? new FileLock(config.parallel) : null;
        if (analytics) {
          if (fileLock) {
            await fileLock.withLock(config.analytics.storePath, () => analytics!.save());
          } else {
            analytics.save();
          }
        }
        if (smartRetry) {
          if (fileLock) {
            await fileLock.withLock(config.smartRetry.flakyStorePath, () => smartRetry!.save());
          } else {
            smartRetry.save();
          }
        }
        if (visualVerifier) {
          visualVerifier.cleanup();
        }

        const healed = session.events.filter((e) => e.status === 'healed').length;
        const failed = session.events.filter((e) => e.status === 'failed').length;
        if (session.events.length > 0) {
          logger.info(
            `Session ${sessionId} complete: ${healed} healed, ${failed} failed out of ${session.events.length} total healing attempts.`,
          );
        }
      },
      { scope: 'worker' },
    ],

    // Test-scoped page fixture override.
    page: async ({ page, _mindHealSession }, use, testInfo: TestInfo) => {
      if (!config.healing.enabled || !healer) {
        await use(page);
        return;
      }

      // Check exclude patterns against the test file path.
      const excludePatterns = config.healing.excludePatterns ?? [];
      const testFilePath = testInfo.file ?? '';
      const excluded = excludePatterns.some((pattern) => {
        try {
          return new RegExp(pattern).test(testFilePath);
        } catch {
          return testFilePath.includes(pattern);
        }
      });

      if (excluded) {
        logger.debug(`Test file excluded from healing: ${testFilePath}`);
        await use(page);
        return;
      }

      // Install dialog auto-handler for alert/confirm/prompt.
      let removeDialogHandler: (() => void) | null = null;
      const dialogConfig = resolveDialogConfig(config);
      if (dialogConfig) {
        removeDialogHandler = installDialogHandler(page, dialogConfig, _mindHealSession);
      }

      const proxiedPage = createHealingPageProxy(page, healer, _mindHealSession, config);

      await use(proxiedPage);

      // Cleanup dialog handler.
      if (removeDialogHandler) {
        removeDialogHandler();
      }
    },
  });
}

// ─── High-level config helper ────────────────────────────────────────────────

/**
 * Convenience function that returns a partial Playwright config object
 * pre-configured with the MindHeal fixture and reporter.
 *
 * Usage in `playwright.config.ts`:
 * ```ts
 * import { mindHealConfig } from 'mindheal';
 * import { defineConfig } from '@playwright/test';
 *
 * export default defineConfig({
 *   ...mindHealConfig({ ai: { provider: 'anthropic', apiKey: '...' } }),
 * });
 * ```
 */
export function mindHealConfig(userConfig: Partial<MindHealConfig> = {}) {
  const resolvedConfig = loadConfig(userConfig);
  const mindHealTest = createMindHealFixture(resolvedConfig);

  // Store the resolved config globally so the auto-fixture can access it.
  _globalConfig = resolvedConfig;

  return {
    // The test instance with the fixture applied. Consumers can import `test`
    // from their config or re-export it.
    test: mindHealTest,
    // Provide the projects entry that uses our fixture.
    use: {},
    // Reporter setup -- users can merge this with their own reporters.
    reporter: [
      ['list' as const],
      ...(resolvedConfig.reporting.generateJSON
        ? [
            [
              'json' as const,
              {
                outputFile: `${resolvedConfig.reporting.outputDir ?? '.mindheal/reports'}/results.json`,
              },
            ],
          ]
        : []),
    ],
    // Pass config through metadata so custom reporters can access it.
    metadata: {
      mindHealConfig: resolvedConfig,
    },
  };
}

// ─── Global config for auto-fixture ──────────────────────────────────────────

let _globalConfig: MindHealConfig | null = null;

/**
 * Returns the resolved config set by `mindHealConfig()`. Used internally by
 * the auto-fixture export so that `import { test } from 'mindheal'` works
 * without consumers having to thread the config themselves.
 */
export function getGlobalConfig(): MindHealConfig | null {
  return _globalConfig;
}

/**
 * Pre-built `test` fixture that reads config from `mindHealConfig()` call in
 * `playwright.config.ts`. This enables zero-change imports:
 *
 * ```ts
 * // playwright.config.ts
 * import { mindHealConfig } from 'mindheal';
 * export default defineConfig({ ...mindHealConfig({ ai: { ... } }) });
 *
 * // Any test file — no changes needed if you use this import:
 * import { test, expect } from 'mindheal';
 * ```
 *
 * If `mindHealConfig()` has not been called yet (e.g. the config file hasn't
 * loaded), this falls back to the standard `@playwright/test` `test` with no
 * healing — tests still run, they just won't self-heal.
 */
export const autoTest = (() => {
  // Lazy: we can't call createMindHealFixture at module-load time because
  // the config may not exist yet. Instead, extend baseTest with a page
  // fixture that delegates to the global config at runtime.
  return baseTest.extend<MindHealFixtures, MindHealWorkerFixtures>({
    _mindHealSession: [
      async ({}, use) => {
        const config = _globalConfig;
        if (!config) {
          // No config — run without healing.
          const emptySession: HealingSession = {
            id: 'noop',
            startTime: Date.now(),
            events: [],
            config: null as unknown as MindHealConfig,
          };
          await use(emptySession);
          return;
        }

        const sessionId = `session_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
        const session: HealingSession = {
          id: sessionId,
          startTime: Date.now(),
          events: [],
          config,
        };
        _sessions.set(sessionId, session);

        // Initialise cache and healer once per worker.
        const cache = new SelfHealCache(config.healing.cachePath);
        cache.load();

        let aiProvider = null;
        if (config.ai.apiKey && config.healing.strategies.includes('ai')) {
          try {
            aiProvider = createAIProvider(config.ai);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.warn(`Failed to create AI provider: ${msg}. AI strategy will be skipped.`);
          }
        }

        // Initialize RAG context retriever if enabled.
        let contextRetriever: ContextRetriever | null = null;
        if (config.rag?.enabled) {
          try {
            const knowledgeStore = new KnowledgeStore(config.rag.storePath);
            knowledgeStore.load();
            contextRetriever = new ContextRetriever(config.rag, knowledgeStore);
            logger.debug(`RAG context retriever initialized (${knowledgeStore.size} entries)`);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.warn(`Failed to initialize RAG: ${msg}. Continuing without RAG.`);
          }
        }

        // Initialize smart retry, visual verifier, and analytics.
        let smartRetry: SmartRetry | null = null;
        if (config.smartRetry?.enabled) {
          smartRetry = new SmartRetry(config.smartRetry);
          smartRetry.load();
        }

        let visualVerifier: VisualVerifier | null = null;
        if (config.visualVerification?.enabled) {
          visualVerifier = new VisualVerifier(config.visualVerification);
        }

        let analytics: HealingAnalytics | null = null;
        if (config.analytics?.enabled) {
          analytics = new HealingAnalytics(config.analytics);
          analytics.load();
        }

        // Stash healer on the session so the page fixture can use it.
        (session as unknown as Record<string, unknown>)['_healer'] = new Healer(
          config, aiProvider, cache, contextRetriever, smartRetry, visualVerifier, analytics,
        );
        (session as unknown as Record<string, unknown>)['_contextRetriever'] = contextRetriever;
        (session as unknown as Record<string, unknown>)['_analytics'] = analytics;
        (session as unknown as Record<string, unknown>)['_smartRetry'] = smartRetry;

        await use(session);

        // Teardown: ingest events and save all stores with file locking.
        for (const event of session.events) {
          if (contextRetriever) contextRetriever.ingestHealingEvent(event);
          if (analytics) analytics.recordEvent(event);
          if (smartRetry) {
            smartRetry.recordAttempt(
              event.testFile, event.testTitle, event.originalLocator, event.status === 'healed',
            );
          }
        }

        const fileLock = config.parallel?.enabled ? new FileLock(config.parallel) : null;
        if (analytics) {
          if (fileLock) {
            await fileLock.withLock(config.analytics.storePath, () => analytics!.save());
          } else {
            analytics.save();
          }
        }
        if (smartRetry) {
          if (fileLock) {
            await fileLock.withLock(config.smartRetry.flakyStorePath, () => smartRetry!.save());
          } else {
            smartRetry.save();
          }
        }
        if (visualVerifier) visualVerifier.cleanup();

        const healed = session.events.filter((e) => e.status === 'healed').length;
        const failed = session.events.filter((e) => e.status === 'failed').length;
        if (session.events.length > 0) {
          logger.info(
            `Session ${sessionId} complete: ${healed} healed, ${failed} failed out of ${session.events.length} total healing attempts.`,
          );
        }
      },
      { scope: 'worker' },
    ],

    page: async ({ page, _mindHealSession }, use, testInfo: TestInfo) => {
      const config = _globalConfig;
      const healer = (_mindHealSession as unknown as Record<string, unknown>)['_healer'] as Healer | undefined;

      if (!config || !config.healing.enabled || !healer) {
        await use(page);
        return;
      }

      // Check exclude patterns.
      const excludePatterns = config.healing.excludePatterns ?? [];
      const testFilePath = testInfo.file ?? '';
      const excluded = excludePatterns.some((pattern) => {
        try {
          return new RegExp(pattern).test(testFilePath);
        } catch {
          return testFilePath.includes(pattern);
        }
      });

      if (excluded) {
        logger.debug(`Test file excluded from healing: ${testFilePath}`);
        await use(page);
        return;
      }

      // Install dialog auto-handler.
      let removeDialogHandler: (() => void) | null = null;
      const dialogConfig = resolveDialogConfig(config);
      if (dialogConfig) {
        removeDialogHandler = installDialogHandler(page, dialogConfig, _mindHealSession);
      }

      const proxiedPage = createHealingPageProxy(page, healer, _mindHealSession, config);
      await use(proxiedPage);

      if (removeDialogHandler) {
        removeDialogHandler();
      }
    },
  });
})();
