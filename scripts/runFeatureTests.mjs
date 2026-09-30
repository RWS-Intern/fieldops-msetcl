/**
 * Bundles and runs scripts/featureTests.tsx.
 *
 *   npm run test:features
 *
 * Same shape as runSsrSurveyWalk.mjs — Node + esbuild, no browser, no Firebase
 * project touched. Exits non-zero on any failure, so it is safe for CI.
 */
import * as esbuild from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT  = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'feature-tests-')), 'tests.cjs');

await esbuild.build({
  entryPoints: [path.join(ROOT, 'scripts', 'featureTests.tsx')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outfile: OUT,
  jsx: 'automatic',
  absWorkingDir: ROOT,
  alias: { '@': path.join(ROOT, 'src') },
  // Placeholders only. Nothing here makes a request; Firebase is initialised at
  // module scope in src/firebase/config.ts, so anything importing a hook drags
  // it in and initializeApp must simply not throw on undefined config.
  define: {
    'import.meta.env.VITE_CLOUDINARY_CLOUD_NAME':       '"test"',
    'import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET':    '"test"',
    'import.meta.env.VITE_CLOUDINARY_FOLDER':           '"test"',
    'import.meta.env.VITE_FIREBASE_API_KEY':            '"test"',
    'import.meta.env.VITE_FIREBASE_AUTH_DOMAIN':        '"test.firebaseapp.com"',
    'import.meta.env.VITE_FIREBASE_PROJECT_ID':         '"test"',
    'import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID': '"0"',
    'import.meta.env.VITE_FIREBASE_APP_ID':             '"test"',
    'import.meta.env.VITE_MAPBOX_TOKEN':                '"test"',
    'import.meta.env.DEV':                              'false',
    'import.meta.env.PROD':                             'true',
  },
  loader: { '.png': 'empty', '.svg': 'empty', '.css': 'empty' },
  logLevel: 'error',
});

const { runFeatureTests } = createRequire(import.meta.url)(OUT);
const failures = await runFeatureTests();

fs.rmSync(path.dirname(OUT), { recursive: true, force: true });
process.exit(failures === 0 ? 0 : 1);
