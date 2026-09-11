# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## Testing

```bash
npm run test:survey-render   # survey render-regression walk (Node only, no browser)
npm run test:rules           # Firestore security-rules suite (needs the Firestore emulator)
```

### `test:survey-render`

Renders all ten survey-wizard steps with `react-dom/server` against a survey carrying one
feeder, one relay, one capacitor bank, one transformer, a cable run and a site photo, and calls
the two functions `SurveyWizardPage` runs unconditionally in its render body (`validateSurvey`,
`getStepStatuses`). Exits non-zero if anything throws.

**Run it after any change to the survey types, mappers, step components or validation.** It
exists because three crashes shipped past a clean-looking `tsc -b` during the survey rebuild: a
deleted named export that broke the whole module graph, `survey.bays.length` in a render body,
and `survey.bays.reduce` on the Sign-Off step. An error count can't distinguish "wrong type in a
file we're deferring" from "this file is mounted and will throw" — this walk executes the render
bodies, so it can.

Needs only Node and esbuild (already a dependency via Vite). Nothing is installed, no browser is
started, no Firebase project is touched.

**A clean run does not mean the wizard works.** It runs no effects, fires no event handlers,
doesn't support `createPortal` (so `SurveyPreview` is not covered), and stubs browser APIs. It
also isn't type-checked — `tsc -b` covers only `src`, and esbuild strips types without checking
them, so a wrong field name in the fixtures fails at runtime rather than at compile time. It
covers one bug class well; it is not an end-to-end test.

Files: [`scripts/ssrSurveyWalk.tsx`](scripts/ssrSurveyWalk.tsx) (the walk) and
[`scripts/runSsrSurveyWalk.mjs`](scripts/runSsrSurveyWalk.mjs) (bundles it with esbuild and runs
it). The runner rewrites `RepeatableGroup`'s initial expanded state at build time so per-entry
forms actually render — without that, only collapsed summary rows would be covered. That
rewrite applies to the bundle only; the source file is untouched, and the build fails loudly if
the anchor it patches ever changes.

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
