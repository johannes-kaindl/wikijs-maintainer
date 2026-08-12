import esbuild from 'esbuild';
import process from 'node:process';
import { builtinModules } from 'node:module';

const prod = process.argv[2] === 'production';

// Flat plugin repo: main.js is written at the repo root next to manifest.json /
// styles.css / versions.json. main.js is gitignored (built artifact); the release
// pipeline attaches it to the GitHub release. No build-mirror copy.
const context = await esbuild.context({
  entryPoints: ['src/main.ts'],
  bundle: true,
  external: [
    'obsidian',
    'electron',
    '@codemirror/autocomplete',
    '@codemirror/collab',
    '@codemirror/commands',
    '@codemirror/language',
    '@codemirror/lint',
    '@codemirror/search',
    '@codemirror/state',
    '@codemirror/view',
    '@lezer/common',
    '@lezer/highlight',
    '@lezer/lr',
    ...builtinModules,
  ],
  format: 'cjs',
  target: 'es2018',
  logLevel: 'info',
  sourcemap: prod ? false : 'inline',
  treeShaking: true,
  outfile: 'main.js',
});

if (prod) {
  await context.rebuild();
  await context.dispose();
  console.log('[wikijs-build] production build complete → main.js');
  process.exit(0);
} else {
  await context.watch();
  console.log('[wikijs-build] watching for changes → main.js');
}
