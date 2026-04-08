# Changelog

All notable changes to MindHeal will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-04-08

### Added

- **Core Healing Engine** — Proxy-based interception of all 8 Playwright locator methods (`click`, `fill`, `type`, `check`, `uncheck`, `selectOption`, `hover`, `isVisible`)
- **10 Healing Strategies** — cache, attribute, text, role, css, xpath, table, modal, enterprise, AI+RAG
- **11 AI Providers** — Anthropic (Claude), OpenAI, Azure OpenAI, Google Gemini, Ollama (local), AWS Bedrock, DeepSeek, Groq, Qwen, Meta/Llama, Perplexity
- **Enterprise Application Support** — Dynamic ID stripping (30+ patterns) for SAP, Salesforce, Oracle, Workday, ServiceNow, Dynamics 365; custom web component awareness; virtual scrolling support; loading state detection
- **RAG-Enhanced AI Healing** — 6 knowledge sources (healing history, page objects, git changes, DOM snapshots, component docs, test specs) with TF-IDF similarity search
- **Healing Analytics & Metrics** — Strategy effectiveness tracking, per-locator healing frequency, test stability scoring (0-100), trend detection (improving/stable/degrading)
- **Smart Retry Intelligence** — Network idle wait, DOM stability detection (MutationObserver), exponential backoff with jitter, flaky test detection
- **Parallel Execution Safety** — Advisory file locking with PID tracking, stale lock detection, cross-platform support
- **Visual Verification** — Post-heal element validation (visibility, bounding box, viewport position), optional screenshot capture
- **Git Integration** — Auto-create PRs with healed locators on GitHub, GitLab, and Bitbucket; AST-based source code modification via ts-morph
- **Local Review Dashboard** — Express + WebSocket server for reviewing heals before applying
- **HTML & JSON Reports** — Detailed healing reports with strategy breakdown and confidence scores
- **CLI Setup** — `npx mindheal init` interactive setup with AI provider selection
- **Dialog Auto-Handling** — Automatic alert/confirm/prompt dismissal during healing
- **Disk-Backed Cache** — TTL-based cache with usage tracking and pattern-based lookup
- **266 Unit & Integration Tests** — Full test coverage across 17 test files
