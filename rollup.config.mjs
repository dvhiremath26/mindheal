import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));
const buildType = process.env.BUILD || 'esm';

const external = [
  ...Object.keys(pkg.dependencies || {}),
  ...Object.keys(pkg.peerDependencies || {}),
  'fs',
  'path',
  'child_process',
  'crypto',
  'http',
  'https',
  'url',
  'os',
  'stream',
  'util',
  'events',
  'net',
  'tls',
  'buffer',
  'querystring',
  'assert',
  'readline',
  '@playwright/test',
  '@playwright/test/reporter',
];

const input = {
  index: 'src/index.ts',
  'reporters/heal-reporter': 'src/reporters/heal-reporter.ts',
  'cli/init': 'src/cli/init.ts',
};

function createConfig(format) {
  const isESM = format === 'esm';
  return {
    input,
    output: {
      dir: `dist/${format}`,
      format: isESM ? 'esm' : 'cjs',
      sourcemap: true,
      preserveModules: true,
      preserveModulesRoot: 'src',
      entryFileNames: '[name].js',
      ...(isESM ? {} : { exports: 'named' }),
    },
    external,
    plugins: [
      resolve({ preferBuiltins: true }),
      commonjs(),
      json(),
      typescript({
        tsconfig: './tsconfig.json',
        compilerOptions: {
          // Always emit ESNext — Rollup handles CJS/ESM conversion
          module: 'ESNext',
          moduleResolution: 'bundler',
          declaration: false,
          declarationMap: false,
          sourceMap: true,
          outDir: `dist/${format}`,
        },
      }),
    ],
  };
}

export default createConfig(buildType);
