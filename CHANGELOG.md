# Changelog

## 2.5.0

Fixes from a downstream consumer's adversarial review. This is a **minor** bump —
it includes small but real behavior changes (see "Behavior changes" below).

### Behavior changes (read before upgrading)
- **`Message` structured output:** passing `responseSchema` without
  `responseMimeType` now auto-defaults `responseMimeType: 'application/json'`
  (the SDK requires it and does not add it). Previously such a call returned a
  400 or unparseable prose. Explicit `responseMimeType` is still honored.
- **`init()` no longer validates connectivity by default.** `Message`,
  `Embedding`, and `ImageGenerator` previously called `models.list()`
  unconditionally during `init()`. This is now gated behind `healthCheck: true`
  (default `false`), matching `BaseGemini`. If you relied on `init()` as a
  startup credentials gate, pass `healthCheck: true`. `models.list()` is a
  different IAM surface than `generateContent` and added a per-instance
  round-trip.

### Added
- **`usage.estimatedCost`** — every `send()`/`generate()` result and
  `getLastUsage()` now include an estimated USD cost from `MODEL_PRICING`
  (`null` when the model is unpriced). Thinking ("thoughts") tokens are billed at
  the output rate and are now included in cost and exposed as
  `usage.thoughtsTokens`.
- **Concurrency-safe per-call usage.** `Message.send()` and
  `ImageGenerator.generate()` return `result.usage` computed synchronously from
  that call's own response. `getLastUsage()` still reflects the instance's last
  call and is unsafe to read across concurrent sends on a shared instance — use
  `result.usage`.
- **Pricing helpers exported:** `MODEL_PRICING`, `MODEL_ALIASES`,
  `resolvePricing()`, `computeCost()`. `resolvePricing` follows `-latest`
  aliases and peels version-build suffixes (e.g. `gemini-2.5-flash-001` →
  `gemini-2.5-flash`).
- **`validateSchema()`** JSON-Schema validator exported (for cross-package
  symmetry; Gemini enforces schemas natively).

### Fixed
- `estimateCost()` now uses `resolvePricing()` and returns `null` cost fields for
  unknown models (was `0`), consistent with `usage.estimatedCost`.
- `estimatedCost` no longer returns `null` for a priced model when the API echoes
  a version-suffixed build id in `modelVersion`.

### Dependencies
- `@google/genai` `^2.10.0` → `^2.12.0` (no breaking changes to the used surface).
