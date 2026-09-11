/**
 * Bundles and runs scripts/ssrSurveyWalk.tsx — see that file for what the
 * walk covers and, importantly, what it does not.
 *
 *   npm run test:survey-render
 *
 * Needs Node and esbuild (already a dependency, via Vite). Nothing is
 * installed and no browser is required. Exits non-zero if any step throws,
 * so this is safe to wire into CI.
 */
import * as esbuild from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT  = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ssr-survey-walk-')), 'walk.cjs');

/**
 * RepeatableGroup keeps its expanded entries in component state, and
 * react-dom/server never runs a state update — so without this every
 * repeatable step would render only its collapsed summary rows and the
 * per-entry form bodies (the code most likely to reference a renamed field)
 * would never execute. Rewriting the initial state at build time expands
 * every entry. This touches only the bundle; the source file is untouched.
 */
const expandAllEntries = {
  name: 'expand-repeatable-group',
  setup(build) {
    build.onLoad({ filter: /RepeatableGroup\.tsx$/ }, (args) => {
      const source = fs.readFileSync(args.path, 'utf8');
      const anchor = 'useState<Set<string>>(new Set())';
      if (!source.includes(anchor)) {
        throw new Error(
          'ssrSurveyWalk: expand-all anchor not found in RepeatableGroup.tsx. ' +
          'Its expanded-state initialiser changed — update this plugin, or the ' +
          'walk will silently stop covering the per-entry forms.',
        );
      }
      return {
        contents: source.replace(anchor, 'useState<Set<string>>(new Set(entries.map((e) => e.uid)))'),
        loader: 'tsx',
      };
    });
  },
};

await esbuild.build({
  entryPoints: [path.join(ROOT, 'scripts', 'ssrSurveyWalk.tsx')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outfile: OUT,
  jsx: 'automatic',
  absWorkingDir: ROOT,
  alias: { '@': path.join(ROOT, 'src') },
  plugins: [expandAllEntries],
  // The app reads these through import.meta.env; nothing here makes a real
  // request, so placeholders are enough to let the modules load.
  define: {
    'import.meta.env.VITE_CLOUDINARY_CLOUD_NAME':    '"test"',
    'import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET': '"test"',
    'import.meta.env.VITE_CLOUDINARY_FOLDER':        '"test"',
    'import.meta.env.DEV':                           'false',
    'import.meta.env.PROD':                          'true',
  },
  loader: { '.png': 'empty', '.svg': 'empty', '.css': 'empty' },
  logLevel: 'error',
});

const { runSurveyWalk } = createRequire(import.meta.url)(OUT);
const failures = runSurveyWalk();

fs.rmSync(path.dirname(OUT), { recursive: true, force: true });
process.exit(failures === 0 ? 0 : 1);
