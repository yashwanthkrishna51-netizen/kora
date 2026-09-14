/**
 * Component-test setup.
 *
 * `@testing-library/react`, `jest-dom` and `jsdom` were all installed when the
 * project was scaffolded and never wired up: no setup file, no `.test.tsx`, no
 * `// @vitest-environment jsdom` docblock anywhere. Step 15 is the first code
 * with behaviour worth rendering.
 *
 * LOADED CONDITIONALLY. `setupFiles` runs for EVERY test file, and Vitest 4
 * removed `environmentMatchGlobs`, so there is no way to scope it by path. A
 * plain top-level import pulled React, testing-library and the jest-dom
 * matchers into all twenty node-environment suites — none of which render
 * anything — and added ~7s to a run that takes 20. The `document` check skips
 * all of it outside jsdom.
 */
if (typeof document !== "undefined") {
  const { cleanup } = await import("@testing-library/react");
  await import("@testing-library/jest-dom/vitest");
  const { afterEach } = await import("vitest");

  // RTL does not auto-clean without this. A leaked tree makes the NEXT test's
  // queries ambiguous rather than failing here, which is miserable to debug.
  afterEach(cleanup);
}

// Top-level `await` above needs this file to be a module, and it has no
// static imports by design — that is the point of the conditional load.
export {};
