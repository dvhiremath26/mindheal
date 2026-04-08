#!/usr/bin/env node

/**
 * MindHeal CLI — `npx mindheal init`
 *
 * Interactive setup for MindHeal in an existing Playwright project:
 * 1. Prompts user to select an AI provider (arrow keys + enter)
 * 2. Creates tests/base.ts (re-exports test & expect from mindheal)
 * 3. Updates all .spec.ts / .test.ts imports from '@playwright/test' to './base'
 * 4. Creates .env.example with the selected provider's keys
 * 5. Updates playwright.config.ts with mindHealConfig() + git config
 *
 * Safe to run multiple times — skips files already configured.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

// ─── Colors (no dependency) ─────────────────────────────────────────────────

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const inverse = (s: string) => `\x1b[7m${s}\x1b[0m`;

// ─── AI Provider Definitions ────────────────────────────────────────────────

interface ProviderDef {
  name: string;
  label: string;
  envKey: string;
  envExample: string;
  configSnippet: string;
  envLines: string;
}

const AI_PROVIDERS: ProviderDef[] = [
  {
    name: 'anthropic',
    label: 'Anthropic (Claude)            — recommended',
    envKey: 'ANTHROPIC_API_KEY',
    envExample: 'sk-ant-...',
    configSnippet: [
      `    provider: 'anthropic',`,
      `    apiKey: process.env.ANTHROPIC_API_KEY!,`,
      `    model: 'claude-sonnet-4-20250514',`,
    ].join('\n'),
    envLines: 'ANTHROPIC_API_KEY=sk-ant-...',
  },
  {
    name: 'openai',
    label: 'OpenAI                        — widely used, fast',
    envKey: 'OPENAI_API_KEY',
    envExample: 'sk-...',
    configSnippet: [
      `    provider: 'openai',`,
      `    apiKey: process.env.OPENAI_API_KEY!,`,
      `    model: 'gpt-4o',`,
    ].join('\n'),
    envLines: 'OPENAI_API_KEY=sk-...',
  },
  {
    name: 'azure-openai',
    label: 'Azure OpenAI                  — enterprise Azure',
    envKey: 'AZURE_OPENAI_API_KEY',
    envExample: 'your-api-key',
    configSnippet: [
      `    provider: 'azure-openai',`,
      `    apiKey: process.env.AZURE_OPENAI_API_KEY!,`,
      `    baseUrl: process.env.AZURE_OPENAI_ENDPOINT!,`,
      `    azureDeploymentName: process.env.AZURE_OPENAI_DEPLOYMENT!,`,
      `    azureApiVersion: '2024-02-01',`,
    ].join('\n'),
    envLines: [
      'AZURE_OPENAI_API_KEY=your-api-key',
      'AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com',
      'AZURE_OPENAI_DEPLOYMENT=gpt-4o',
    ].join('\n'),
  },
  {
    name: 'gemini',
    label: 'Google Gemini                 — Google ecosystem',
    envKey: 'GEMINI_API_KEY',
    envExample: 'your-api-key',
    configSnippet: [
      `    provider: 'gemini',`,
      `    apiKey: process.env.GEMINI_API_KEY!,`,
      `    model: 'gemini-2.0-flash',`,
    ].join('\n'),
    envLines: 'GEMINI_API_KEY=your-api-key',
  },
  {
    name: 'ollama',
    label: 'Ollama (Local)                — free, air-gapped, no API key',
    envKey: '',
    envExample: '',
    configSnippet: [
      `    provider: 'ollama',`,
      `    apiKey: '',`,
      `    ollamaHost: process.env.OLLAMA_HOST || 'http://localhost:11434',`,
      `    model: 'llama3',`,
    ].join('\n'),
    envLines: 'OLLAMA_HOST=http://localhost:11434',
  },
  {
    name: 'aws-bedrock',
    label: 'AWS Bedrock                   — enterprise AWS, SigV4 auth',
    envKey: 'AWS_ACCESS_KEY_ID',
    envExample: 'your-access-key',
    configSnippet: [
      `    provider: 'aws-bedrock',`,
      `    apiKey: '',`,
      `    awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID!,`,
      `    awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,`,
      `    awsRegion: process.env.AWS_REGION || 'us-east-1',`,
      `    model: 'anthropic.claude-3-haiku-20240307-v1:0',`,
    ].join('\n'),
    envLines: [
      'AWS_ACCESS_KEY_ID=your-access-key',
      'AWS_SECRET_ACCESS_KEY=your-secret-key',
      'AWS_REGION=us-east-1',
    ].join('\n'),
  },
  {
    name: 'deepseek',
    label: 'DeepSeek                      — cost-effective, strong coding',
    envKey: 'DEEPSEEK_API_KEY',
    envExample: 'your-api-key',
    configSnippet: [
      `    provider: 'deepseek',`,
      `    apiKey: process.env.DEEPSEEK_API_KEY!,`,
      `    model: 'deepseek-chat',`,
    ].join('\n'),
    envLines: 'DEEPSEEK_API_KEY=your-api-key',
  },
  {
    name: 'groq',
    label: 'Groq                          — extremely fast inference',
    envKey: 'GROQ_API_KEY',
    envExample: 'gsk_...',
    configSnippet: [
      `    provider: 'groq',`,
      `    apiKey: process.env.GROQ_API_KEY!,`,
      `    model: 'llama-3.3-70b-versatile',`,
    ].join('\n'),
    envLines: 'GROQ_API_KEY=gsk_...',
  },
  {
    name: 'qwen',
    label: 'Qwen (Alibaba Cloud)          — DashScope',
    envKey: 'QWEN_API_KEY',
    envExample: 'your-dashscope-key',
    configSnippet: [
      `    provider: 'qwen',`,
      `    apiKey: process.env.QWEN_API_KEY!,`,
      `    model: 'qwen-plus',`,
    ].join('\n'),
    envLines: 'QWEN_API_KEY=your-dashscope-key',
  },
  {
    name: 'meta',
    label: 'Meta (Llama via Together.ai)   — open-source models',
    envKey: 'TOGETHER_API_KEY',
    envExample: 'your-together-key',
    configSnippet: [
      `    provider: 'meta',`,
      `    apiKey: process.env.TOGETHER_API_KEY!,`,
      `    model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',`,
    ].join('\n'),
    envLines: 'TOGETHER_API_KEY=your-together-key',
  },
  {
    name: 'perplexity',
    label: 'Perplexity                    — search-augmented AI',
    envKey: 'PERPLEXITY_API_KEY',
    envExample: 'pplx-...',
    configSnippet: [
      `    provider: 'perplexity',`,
      `    apiKey: process.env.PERPLEXITY_API_KEY!,`,
      `    model: 'sonar-pro',`,
    ].join('\n'),
    envLines: 'PERPLEXITY_API_KEY=pplx-...',
  },
];

// ─── Interactive Provider Selector ──────────────────────────────────────────

function selectProvider(): Promise<ProviderDef> {
  return new Promise((resolve) => {
    let selectedIndex = 0;
    const totalItems = AI_PROVIDERS.length;

    function render() {
      // Move cursor up to overwrite previous render
      if (selectedIndex >= 0) {
        process.stdout.write(`\x1b[${totalItems + 2}A`);
      }

      console.log('');
      console.log(`  ${bold('Select your AI Provider:')} ${dim('(use arrow keys, press Enter to select)')}`);

      for (let i = 0; i < totalItems; i++) {
        const provider = AI_PROVIDERS[i];
        if (i === selectedIndex) {
          console.log(`  ${inverse(` > ${provider.label} `)}`);
        } else {
          console.log(`    ${provider.label}`);
        }
      }
    }

    // Initial render — print blank lines first so cursor-up works
    console.log('');
    console.log('');
    for (let i = 0; i < totalItems; i++) {
      console.log('');
    }
    render();

    // Enable raw mode to capture individual keypresses
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    const onKeypress = (key: string) => {
      // Ctrl+C — exit
      if (key === '\u0003') {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        console.log('\n');
        console.log(`  ${yellow('Cancelled.')} Run ${cyan('npx mindheal init')} again to set up.`);
        console.log('');
        process.exit(0);
      }

      // Arrow Up
      if (key === '\u001b[A') {
        selectedIndex = (selectedIndex - 1 + totalItems) % totalItems;
        render();
        return;
      }

      // Arrow Down
      if (key === '\u001b[B') {
        selectedIndex = (selectedIndex + 1) % totalItems;
        render();
        return;
      }

      // Enter
      if (key === '\r' || key === '\n') {
        process.stdin.removeListener('data', onKeypress);
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(false);
        }
        process.stdin.pause();

        const selected = AI_PROVIDERS[selectedIndex];
        console.log('');
        console.log(`  ${green('Selected:')} ${bold(selected.name)}`);
        resolve(selected);
        return;
      }
    };

    process.stdin.on('data', onKeypress);
  });
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function findFiles(dir: string, pattern: RegExp, results: string[] = []): string[] {
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== 'dist') {
      findFiles(fullPath, pattern, results);
    } else if (entry.isFile() && pattern.test(entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

function relativePath(from: string, to: string): string {
  let rel = path.relative(path.dirname(from), to).replace(/\\/g, '/');
  rel = rel.replace(/\.ts$/, '');
  if (!rel.startsWith('.')) rel = './' + rel;
  return rel;
}

// ─── Generate playwright.config.ts content ──────────────────────────────────

function generateConfigSnippet(provider: ProviderDef): string {
  const lines = [
    `import { mindHealConfig } from 'mindheal';`,
    `import 'dotenv/config';`,
    ``,
    `const healConfig = mindHealConfig({`,
    `  ai: {`,
    provider.configSnippet,
    `  },`,
    ``,
    `  // Git — auto-create PR with healed locators in CI/CD`,
    `  git: {`,
    `    enabled: true,`,
    `    provider: 'github',              // 'github' | 'gitlab' | 'bitbucket'`,
    `    token: process.env.GIT_TOKEN || '',`,
    `    baseBranch: 'main',`,
    `    autoCreatePR: true,`,
    `    commitMessagePrefix: 'fix(locators):',`,
    `    prLabels: ['auto-heal', 'mindheal'],`,
    `  },`,
    `});`,
  ];

  return lines.join('\n');
}

// ─── Generate .env.example content ──────────────────────────────────────────

function generateEnvExample(provider: ProviderDef): string {
  const lines = [
    `# MindHeal — Environment Variables`,
    `# Generated by: npx mindheal init`,
    `#`,
    `# Selected AI Provider: ${provider.name}`,
    ``,
    `# ── AI Provider ──────────────────────────────────────────────`,
    provider.envLines,
    ``,
    `# ── Git (for auto-PR creation in CI) ─────────────────────────`,
    `GIT_TOKEN=ghp_...`,
    ``,
    `# ── Other Providers (uncomment to switch) ────────────────────`,
  ];

  for (const p of AI_PROVIDERS) {
    if (p.name === provider.name) continue;
    const commented = p.envLines.split('\n').map((l: string) => `# ${l}`).join('\n');
    lines.push(`# ${p.label.trim()}`);
    lines.push(commented);
    lines.push('');
  }

  return lines.join('\n');
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const cwd = process.cwd();
  console.log('');
  console.log(bold('  MindHeal — Auto-Healing Setup'));
  console.log(dim('  ─────────────────────────────────────'));

  // ── Step 1: Select AI Provider ─────────────────────────────────────────

  const provider = await selectProvider();

  console.log('');
  console.log(dim('  ─────────────────────────────────────'));
  console.log('');

  // ── Step 2: Detect test directory ──────────────────────────────────────

  let testDir = 'tests';
  const possibleDirs = ['tests', 'test', 'e2e', 'specs', 'src/tests', 'src/test'];
  for (const dir of possibleDirs) {
    if (fs.existsSync(path.join(cwd, dir))) {
      testDir = dir;
      break;
    }
  }

  const configPath = path.join(cwd, 'playwright.config.ts');
  if (fs.existsSync(configPath)) {
    const configContent = fs.readFileSync(configPath, 'utf-8');
    const testDirMatch = configContent.match(/testDir:\s*['"]([^'"]+)['"]/);
    if (testDirMatch) {
      testDir = testDirMatch[1];
    }
  }

  const testDirFull = path.join(cwd, testDir);
  console.log(`  Test directory: ${cyan(testDir)}`);

  // ── Step 3: Create base.ts ─────────────────────────────────────────────

  const basePath = path.join(testDirFull, 'base.ts');
  const baseContent = `// Auto-generated by: npx mindheal init
// All test files import from here instead of '@playwright/test'.
// To disable MindHeal, change the import below back to '@playwright/test'.

import { test, expect } from 'mindheal';
export { test, expect };
`;

  if (fs.existsSync(basePath)) {
    const existing = fs.readFileSync(basePath, 'utf-8');
    if (existing.includes('mindheal')) {
      console.log(`  ${dim('skip')} ${testDir}/base.ts ${dim('(already exists)')}`);
    } else {
      fs.writeFileSync(basePath, baseContent, 'utf-8');
      console.log(`  ${green('updated')} ${testDir}/base.ts`);
    }
  } else {
    if (!fs.existsSync(testDirFull)) {
      fs.mkdirSync(testDirFull, { recursive: true });
    }
    fs.writeFileSync(basePath, baseContent, 'utf-8');
    console.log(`  ${green('created')} ${testDir}/base.ts`);
  }

  // ── Step 4: Update all spec/test files ─────────────────────────────────

  const specFiles = findFiles(testDirFull, /\.(spec|test)\.(ts|js|mts|mjs)$/);
  let updated = 0;
  let skipped = 0;

  console.log('');
  console.log(`  Found ${bold(String(specFiles.length))} test file(s)`);
  console.log('');

  for (const specFile of specFiles) {
    const content = fs.readFileSync(specFile, 'utf-8');
    const relDisplay = path.relative(cwd, specFile).replace(/\\/g, '/');

    if (content.includes("from 'mindheal'") || content.includes('from "mindheal"')) {
      console.log(`  ${dim('skip')} ${relDisplay} ${dim('(already uses mindheal)')}`);
      skipped++;
      continue;
    }

    if (path.resolve(specFile) === path.resolve(basePath)) {
      continue;
    }

    const relToBase = relativePath(specFile, basePath);

    if (content.includes(`from '${relToBase}'`) || content.includes(`from "${relToBase}"`)) {
      console.log(`  ${dim('skip')} ${relDisplay} ${dim('(already uses base)')}`);
      skipped++;
      continue;
    }

    const importRegex = /import\s*\{([^}]*(?:test|expect)[^}]*)\}\s*from\s*['"]@playwright\/test['"]/g;

    if (!importRegex.test(content)) {
      console.log(`  ${dim('skip')} ${relDisplay} ${dim('(no @playwright/test import)')}`);
      skipped++;
      continue;
    }

    importRegex.lastIndex = 0;

    const newContent = content.replace(importRegex, (_match, imports: string) => {
      const importedNames = imports.split(',').map((s: string) => s.trim()).filter(Boolean);

      const baseImports: string[] = [];
      const playwrightImports: string[] = [];

      for (const name of importedNames) {
        const cleaned = name.replace(/^type\s+/, '');
        if (cleaned === 'test' || cleaned === 'expect') {
          baseImports.push(name);
        } else {
          playwrightImports.push(name);
        }
      }

      let result = '';
      if (baseImports.length > 0) {
        result += `import { ${baseImports.join(', ')} } from '${relToBase}'`;
      }
      if (playwrightImports.length > 0) {
        if (result) result += ';\n';
        result += `import { ${playwrightImports.join(', ')} } from '@playwright/test'`;
      }

      return result;
    });

    if (newContent !== content) {
      fs.writeFileSync(specFile, newContent, 'utf-8');
      console.log(`  ${green('updated')} ${relDisplay}`);
      updated++;
    } else {
      console.log(`  ${dim('skip')} ${relDisplay} ${dim('(no changes needed)')}`);
      skipped++;
    }
  }

  // ── Step 5: Create .env.example ────────────────────────────────────────

  console.log('');

  const envExamplePath = path.join(cwd, '.env.example');
  const envContent = generateEnvExample(provider);
  fs.writeFileSync(envExamplePath, envContent, 'utf-8');
  console.log(`  ${green('created')} .env.example ${dim(`(${provider.name})`)}`);

  // ── Step 6: Update playwright.config.ts ────────────────────────────────

  if (fs.existsSync(configPath)) {
    const configContent = fs.readFileSync(configPath, 'utf-8');
    if (configContent.includes('mindHealConfig') || configContent.includes('mindheal')) {
      console.log(`  ${dim('skip')} playwright.config.ts ${dim('(already configured)')}`);
    } else {
      let newConfig = configContent;
      const configSnippet = generateConfigSnippet(provider);

      // Add imports and config after existing imports
      const lastImportMatch = configContent.match(/^(import\s.+\n)+/m);
      if (lastImportMatch) {
        const insertAt = lastImportMatch.index! + lastImportMatch[0].length;
        newConfig =
          newConfig.slice(0, insertAt) +
          configSnippet +
          '\n\n' +
          newConfig.slice(insertAt);
      }

      // Add ...healConfig spread into defineConfig
      newConfig = newConfig.replace(
        /defineConfig\(\s*\{/,
        'defineConfig({\n  ...healConfig,',
      );

      fs.writeFileSync(configPath, newConfig, 'utf-8');
      console.log(`  ${green('updated')} playwright.config.ts ${dim(`(${provider.name} + git)`)}`);
    }
  } else {
    console.log(`  ${yellow('warn')} playwright.config.ts not found — create it manually`);
  }

  // ── Summary ────────────────────────────────────────────────────────────

  console.log('');
  console.log(dim('  ─────────────────────────────────────'));
  console.log(`  ${green('Done!')} ${updated} file(s) updated, ${skipped} skipped`);
  console.log('');
  console.log('  Next steps:');
  console.log(`    1. Copy ${cyan('.env.example')} to ${cyan('.env')} and add your ${bold(provider.envKey || 'OLLAMA_HOST')} key`);
  console.log(`    2. Run ${cyan('npx playwright test')}`);

  if (provider.name === 'ollama') {
    console.log('');
    console.log(`  ${dim('Ollama setup:')}`);
    console.log(`    ${cyan('ollama pull llama3')}     ${dim('# download the model first')}`);
    console.log(`    ${cyan('ollama serve')}           ${dim('# start the server')}`);
  }

  console.log('');
}

main().catch((err) => {
  console.error(`\n  ${yellow('Error:')} ${err.message}\n`);
  process.exit(1);
});
