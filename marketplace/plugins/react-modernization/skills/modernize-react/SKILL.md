---
name: modernize-react
description: >
  Modernize a React application: upgrade React 18 -> 19, migrate class components
  to function components/Hooks, tighten TypeScript types, and move Create React
  App -> Vite. Use when the user wants to upgrade React, run React codemods,
  convert class components, fix forwardRef/ref-as-prop, migrate off CRA, or
  mentions "React 19", "react-codemod", "class to hooks", "CRA to Vite".
license: Apache-2.0
metadata:
  author: Platform Engineering
---

# React modernization

Gate-driven modernization of a React app. Prefer codemods for mechanical changes;
hand-edit only what codemods can't express. Build and test after every phase.

## Critical rules
- **Never delete code you cannot migrate.** Leave it with a
  `// TODO: modernize — <reason>` comment. This applies to class lifecycle logic
  with no clean Hook equivalent, untyped dynamic access, and CRA-specific config.
- **Don't break the build.** Run the build + tests after each phase
  (`npm run build` / `npm test`). Never start the next phase on a red build.
- **One codemod at a time, commit between.** Codemods rewrite many files; a clean
  commit per codemod keeps the diff reviewable and revertible.
- **Audit each codemod's output.** Codemods are mechanical — review the changed
  files, they can be wrong on edge cases.

## Phases (gates)

### Phase 0 — Inventory
- Read `package.json`: React/ReactDOM version, TypeScript, bundler (CRA = presence
  of `react-scripts`), test runner.
- Search for: `React.Component`/`extends Component` (class comps), `createClass`,
  `forwardRef`, `propTypes`, `defaultProps`, `ReactDOM.render`, string refs.
- Present a findings table (area, count, complexity). Confirm scope with the user
  before changing anything.

### Phase 1 — Upgrade React 18 -> 19 (mechanical codemods)
Run the official React 19 codemod recipe (see
[references/codemods.md](references/codemods.md)):

    npx codemod@latest react/19/migration-recipe

This handles `ReactDOM.render` -> `createRoot`, `forwardRef` -> ref-as-prop,
`<Context.Provider>` -> `<Context>`, removed `propTypes`/`defaultProps` on function
components, and more. Then bump `react`/`react-dom` to `^19` and reinstall.
Build + test. Commit.

### Phase 2 — TypeScript types (if TS)
    npx types-react-codemod@latest preset-19 ./src

Audit: React 19 changes `ReactElement` props default from `any` to `unknown`, and
ref-callback cleanup typing. Fix residual type errors by hand. Build. Commit.

### Phase 3 — Class components -> function + Hooks
There is **no complete official class->hooks codemod** — this phase is partly
manual. Use codemods for the mechanical parts, convert logic by hand:
- `this.state` / `setState` -> `useState` (or `useReducer` for complex state).
- `componentDidMount` / `componentDidUpdate` / `componentWillUnmount` ->
  `useEffect` with the right deps and cleanup.
- instance methods -> functions / `useCallback`.
- `this.props` -> destructured props.
Convert one component at a time; test each. Leave a `// TODO: modernize` on any
lifecycle you can't cleanly map. Commit per component or small batch.

### Phase 4 — Create React App -> Vite (only if on CRA)
CRA (`react-scripts`) is end-of-life. There is no single official codemod; do it
deliberately:
- Add Vite + `@vitejs/plugin-react`; move `public/index.html` to project root and
  add the `<script type="module" src="/src/index.tsx">` entry.
- Replace `react-scripts` scripts with `vite` / `vite build` / `vite preview`.
- Migrate env vars `REACT_APP_*` -> `VITE_*` and `process.env` -> `import.meta.env`.
- Move Jest to Vitest (or keep Jest with a transform) and re-run tests.
Build + test. Commit.

### Phase 5 — Verify
- Full `npm run build` and `npm test` green.
- Smoke-run the app. Summarise: versions changed, codemods run, components
  converted, and every remaining `// TODO: modernize`.

## What needs a human
- Concurrent-mode behavioural changes (Strict Mode double-invoke in dev).
- Libraries that read React internals or aren't React 19 ready — check peer deps.
- Data-fetching patterns moving to `use()` / Suspense — design decision, not a
  mechanical rewrite.
