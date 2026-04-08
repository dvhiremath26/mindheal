import type { MindHealConfig } from 'mindheal';

/**
 * MindHeal Configuration
 *
 * Place this file in your project root as `mindheal.config.ts`
 * or pass the config directly to `mindHealConfig()` in playwright.config.ts
 *
 * Create a .env file in your project root with the API key for your chosen provider.
 * See .env.example for all supported environment variables.
 */
const config: Partial<MindHealConfig> = {
  ai: {
    // ─── Choose ONE provider ──────────────────────────────────────────────
    // Supported: 'anthropic' | 'openai' | 'azure-openai' | 'gemini' | 'ollama'
    //          | 'aws-bedrock' | 'deepseek' | 'groq' | 'qwen' | 'meta' | 'perplexity'
    provider: 'anthropic',
    apiKey: process.env.MINDHEAL_API_KEY || '',

    // model defaults per provider (override as needed):
    //   anthropic   → claude-sonnet-4-20250514
    //   openai      → gpt-4o
    //   azure-openai→ (uses azureDeploymentName)
    //   gemini      → gemini-2.0-flash
    //   ollama      → llama3
    //   aws-bedrock → anthropic.claude-3-haiku-20240307-v1:0
    //   deepseek    → deepseek-chat
    //   groq        → llama-3.3-70b-versatile
    //   qwen        → qwen-plus
    //   meta        → meta-llama/Llama-3.3-70B-Instruct-Turbo
    //   perplexity  → sonar-pro
    // model: 'claude-sonnet-4-20250514',

    maxTokens: 1024,
    temperature: 0.1,

    // ─── Provider-specific options ────────────────────────────────────────

    // Azure OpenAI:
    // baseUrl: process.env.AZURE_OPENAI_ENDPOINT,
    // azureDeploymentName: process.env.AZURE_OPENAI_DEPLOYMENT,
    // azureApiVersion: '2024-02-01',

    // Ollama (local):
    // ollamaHost: 'http://localhost:11434',

    // AWS Bedrock:
    // awsRegion: process.env.AWS_REGION || 'us-east-1',
    // awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID,
    // awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    // awsSessionToken: process.env.AWS_SESSION_TOKEN,

    // Any provider with custom endpoint:
    // baseUrl: 'https://your-custom-endpoint.com/v1',
  },

  healing: {
    enabled: true,
    maxRetries: 3,
    strategies: ['cache', 'attribute', 'text', 'role', 'css', 'xpath', 'table', 'modal', 'ai'],
    confidenceThreshold: 0.7,
    cacheHeals: true,
    cachePath: '.mindheal/cache.json',
    excludePatterns: [],
    domSnapshotDepth: 3,
    // Auto-handle browser alert/confirm/prompt dialogs so they don't block tests
    handleDialogs: true,
    // Or fine-tune per dialog type:
    // handleDialogs: {
    //   dismissAlerts: true,
    //   acceptConfirms: true,
    //   promptResponse: '',
    //   logDialogs: true,
    // },
  },

  git: {
    enabled: true,
    provider: 'github',
    token: process.env.GIT_TOKEN || '',
    baseBranch: 'main',
    branchPrefix: 'mindheal/auto-fix',
    autoCreatePR: true,
    commitMessagePrefix: 'fix(locators):',
    prLabels: ['auto-heal', 'mindheal'],
    prReviewers: [],
  },

  reviewServer: {
    enabled: 'auto' as unknown as boolean,
    port: 3000,
    openBrowser: true,
    autoCloseAfterReview: true,
  },

  reporting: {
    outputDir: '.mindheal/reports',
    generateHTML: true,
    generateJSON: true,
  },

  logging: {
    level: 'info',
  },
};

export default config;
