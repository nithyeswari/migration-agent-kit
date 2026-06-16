# React codemods — reference

Verified commands. Run from the project root. Commit before each so the diff is
revertible.

## React 19 recipe (mechanical breaking changes)

    npx codemod@latest react/19/migration-recipe

The official React 19 upgrade guide recommends the `codemod` runner over the old
`react-codemod` because it's faster and handles TypeScript better. The recipe
bundles, among others:
- `ReactDOM.render` / `hydrate` -> `createRoot` / `hydrateRoot`
- `forwardRef` -> ref passed as a normal prop
- `<Context.Provider>` -> `<Context>`
- removal of `propTypes` / `defaultProps` on function components
- `no-implicit-ref-callback-return`

Always audit the changed files; codemods miss edge cases.

## TypeScript types (if using @types/react)

    npx types-react-codemod@latest preset-19 ./src

Interactive; the required transforms are pre-selected. Key effects:
- `ReactElement` props default `any` -> `unknown`
- ref-callback cleanup return typing
Optional extra if you have heavy `element.props` access:

    npx types-react-codemod@latest react-element-default-any-props ./src

## Legacy single-purpose transforms (react-codemod)

For specific mechanical rewrites not in the recipe:

    npx react-codemod create-element-to-jsx src/
    npx react-codemod pure-component src/

Note: `react-codemod` does NOT do a full class -> Hooks conversion. That remains
partly manual (see the skill, Phase 3).

## Next.js (only if the app uses Next)

    npx @next/codemod <transform> <path>

Next's upgrade flow can also trigger the React 19 codemods.

## CRA -> Vite
No official codemod. Follow the manual steps in the skill (Phase 4). The work is
mechanical but project-specific: entry HTML, scripts, env var prefixes
(`REACT_APP_*` -> `VITE_*`, `process.env` -> `import.meta.env`), and test runner.
