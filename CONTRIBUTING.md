# Contributing
1. Fork, create a branch, run `npm test && npm run lint && npm run check-secrets` before pushing.
2. **Never commit real bank statements or personal data.** Test files must be synthetic and named `samples/synthetic_*`.
3. Keep `js/core/` pure (no DOM) so it stays unit-testable; add a test for every parser/rule change.
4. New bank: add a detection rule in `parsers.js#detectBank`, header synonyms in `SYN` if needed, a parser subclass if the layout is unusual, a synthetic sample, and tests.
5. New merchant rule: add to `MERCHANT_RULES` in `classifier.js` with a test in `tests/classifier.test.mjs`.
6. Escape all user/file-derived text with `esc()` in views. No inline scripts (CSP).
