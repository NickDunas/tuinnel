# VT-1 Bun+Ink Validation Spike Report

## Date: 2026-02-15

## Environment
- Bun: 1.2.20
- Node: 22.20.0
- ink: 6.7.0
- react: 19.2.4
- @inkjs/ui: 2.0.0
- ink-testing-library: 4.0.0

## Results

### ink-testing-library (automated tests)

| Test | Bun | Node | Status |
|------|-----|------|--------|
| Basic render (Text) | PASS | PASS | OK |
| useInput keyboard handling | PASS | PASS | OK (needs async delay for state updates) |
| Box flexDirection layout | PASS | PASS | OK |
| rerender() | PASS | PASS | OK |
| frames() history tracking | PASS | PASS | OK |

**10/10 tests pass on both runtimes.**

### Key Finding: ink-testing-library stdin.write() timing

`stdin.write()` triggers `useInput` handlers but React state updates are async. Tests must `await` a small delay (50ms) after `stdin.write()` before checking `lastFrame()`. This is not an Ink v6 bug — it's standard React async state behavior. The delay approach works reliably.

### Interactive app (app.tsx)

Built a test app with:
- Select component (3 options)
- TextInput component (subdomain input)
- useInput hook (q to quit)
- setRawMode workaround for Bun
- useApp().exit() for clean exit

**Note:** Interactive app must be tested manually. The automated tests cover the core rendering and input functionality.

## Verdict: GO

ink-testing-library@4.0.0 works with Ink v6 + React 19 under both Bun and Node. No fallback wrapper needed. Phase 3b TUI development can proceed.

## Testing Pattern for Phase 3b

```typescript
import { render } from 'ink-testing-library';

// For components with useInput or state updates:
const { lastFrame, stdin, unmount } = render(<MyComponent />);
await delay(50); // Let React settle
stdin.write('x');
await delay(50); // Let state update propagate
expect(lastFrame()).toContain('expected text');
unmount();
```
