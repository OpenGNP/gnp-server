# QA Testing — gnp-server

## Run

```
bun run test
```

Uses Bun's built-in test runner (`bun test`) — no extra dependency needed.

## Files here

- `helper.test.ts` — tests for `src/utils/helper.ts`: `createId` and
  `anonymousIdentityCode`.

## What each test covers

### `createId`
- Output is prefixed correctly (`form_...`) and shaped like `prefix_<uuid>`.
- Two calls produce different ids (it's actually random, not a fixed
  string).
- An empty prefix doesn't throw — produces `_<uuid>`.
- The prefix is inserted literally, with no sanitizing — documents that
  callers must only ever pass a safe, static prefix, never raw user input.

### `anonymousIdentityCode`
This is the function behind "one response per person": it turns a
`(formId, identity)` pair into a one-way, non-reversible code, so a repeat
submission can be detected without storing who the person actually is.

- **Deterministic**: the same `(formId, identity)` always produces the
  same code — this is what makes duplicate-detection possible.
- **Scoped per form**: the same identity on two different forms produces
  two different codes, so responses can't be correlated across forms.
- **Scoped per identity**: two different identities on the same form
  produce different codes.
- **Doesn't leak the input**: the output never contains the raw identity
  string (e.g. a user id), since it's an HMAC, not a plain concatenation.
- **Fixed shape**: always `resp_` followed by a 64-character lowercase hex
  SHA-256 digest, regardless of input.
- **`formId: 0` works correctly**: 0 is a valid form id, not treated as
  "missing" — its code differs from `formId: 1`.
- **Empty identity doesn't throw** — an edge case worth covering since an
  anonymous device id could theoretically be empty if generation failed.
- **No whitespace normalization**: `"user-42"` and `"user-42 "` produce
  different codes — differently-padded identities are treated as different
  people. If normalization is ever expected upstream, it has to happen
  before this function, not inside it.
- **Unicode identities work** without throwing.
- **No delimiter ambiguity**: the function joins `formId` and `identity`
  with `:` before hashing. Adjacent-digit inputs that could superficially
  collide around that boundary (`formId=1, identity="23:x"` vs.
  `formId=12, identity="3:x"`) still produce distinct codes — confirms the
  actual `(formId, identity)` pair determines the code, not just the raw
  joined string.

## Why this first

`anonymousIdentityCode` is the core of the dedup/one-response-per-person
logic — the highest-risk piece of business logic in the app (see
`QA_PLAN.md` at the repo root, Section 2.2, priority 1). It's also pure
(no DB, no network), so it's cheap to test in isolation.

## Not covered yet

Route/integration tests (auth, forms, feedback submission against a real
test database) and cross-org isolation checks are later phases — see
`QA_PLAN.md` Section 2.3 for the rollout order.
