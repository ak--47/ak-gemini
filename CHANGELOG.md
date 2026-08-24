# Changelog

## 2.6.2

**Patch** bump — bug fix only. No API-surface changes, no behavior change for
callers who don't use `labels`.

### Fixed
- **Billing `labels` no longer discard the entire generation config.**
  `@google/genai` resolves a chat send as `config: params.config ?? this.config`
  — a per-message config **replaces** the create-time session config instead of
  merging with it. `Chat.send()` and `Transformer.rawSend()` were setting
  `config: { labels }` whenever labels were present, which silently dropped
  `systemInstruction`, `responseSchema`, `responseMimeType`, `maxOutputTokens`,
  `thinkingConfig`, `tools` and `cachedContent` for that request.

  Symptom: any caller using `vertexai: true` + `labels` got a model that ignored
  the system prompt and JSON mode and returned prose. In `Transformer.send()`
  this was masked — attempt 0 (`rawSend`) failed with `Could not extract valid
  JSON from model response`, then attempt 1 (`rebuild`, which sends no
  per-message config) succeeded — so it burned a full generation on every call
  and failed outright when the retry budget ran out.

  A per-message `config` is now only sent when there is an actual per-message
  override, and when sent it carries the full create-time config forward via the
  new protected `_getSendConfig()` helper on `BaseGemini`. `Message.send()` was
  already correct (it spreads `...this.chatConfig`) and is unchanged.

  If you applied the workaround of moving `labels` into `chatConfig`, it still
  works — you can move them back to the top-level `labels` option at your
  convenience.

### Added
- `Chat.stream(message, { labels })` now honours per-message labels. It
  previously accepted and ignored `opts`.
- Offline regression coverage in `tests/consumer-fixes.test.js` asserting that
  `systemInstruction` / `responseSchema` / `responseMimeType` survive alongside
  both instance-level and per-message labels.

## 2.6.1

**Patch** bump — the default model changes when you don't pass `modelName`
(see below). No API-surface changes. Paired with ak-claude 0.2.1.

### Behavior changes (read before upgrading)
- **Default model is now `gemini-3.6-flash`** (was `gemini-3-flash-preview`) on
  every generative class. It's the stable flagship with cheaper output than
  3.5-flash ($1.50/$7.50 per M, cached $0.15 — priced in `MODEL_PRICING` since
  2.6.0; `gemini-flash-latest` already resolves to it). Pass
  `modelName: 'gemini-3-flash-preview'` to keep the old default. `Embedding`
  (`gemini-embedding-001`) and `ImageGenerator`
  (`gemini-3.1-flash-image-preview`) defaults are unchanged. Verified live on
  Vertex AI.

### Changed
- **`@google/genai` `^2.12.0` → `^2.15.0`.** Changelog-audited: additive only;
  the 2.14 Imagen deprecations don't affect `ImageGenerator`, which uses Gemini
  image models.

## 2.6.0

> **Upgrading from 2.5.0?** [UPGRADING.md](./UPGRADING.md) walks through only what you
> need to change, with before/after examples.

Feature request from a downstream consumer (`smarterchild/agent`, Vertex AI),
paired with ak-claude 0.2.0. **Minor** bump — cached-token billing changes
reported cost (see "Behavior changes" below).

### Behavior changes (read before upgrading)
- **Cached tokens are now billed at the discounted cached rate.**
  `usageMetadata.cachedContentTokenCount` is surfaced as `usage.cachedTokens` and
  factored into `estimatedCost`. **Gemini INCLUDES cached tokens in
  `promptTokenCount`**, so they are *subtracted* from the prompt count and
  re-billed at `cachedInput` — they are a subset, not an addition. (ak-claude is
  the opposite: Anthropic excludes cache tokens from `input_tokens` and they are
  added on top. The asymmetry is intentional; do not "unify" it.) Reported cost
  for cache-heavy calls drops by up to ~10×. Models with no published cached rate
  bill cached tokens at the full input rate — an overestimate, never an
  underestimate.
- **Pro models switch to their >200k-context tier above 200,000 prompt tokens.**
  `gemini-2.5-pro` and `gemini-3.1-pro-preview` previously billed every call at
  the ≤200k rate. Long-context calls now report roughly 2× the input cost they
  did before, which is what Google actually charges.
- **`gemini-2.5-flash` output pricing corrected from $2.50 to $3.00 per M.**
  Reported cost for that model rises accordingly.
- **`gemini-flash-latest` now resolves to `gemini-3.6-flash`** (was
  `gemini-3.5-flash`) and **`gemini-flash-lite-latest` to `gemini-3.5-flash-lite`**
  for pricing. Alias resolution is logged at debug — prefer the model id the API
  echoes in `modelVersion`, which `_estimatedCost` already does.
- **`getLastUsage()` now reports non-zero `thoughtsTokens` on `Chat`,
  `ToolAgent`, `CodeAgent`, `RagAgent`, and `Transformer`.** These classes seeded
  `_cumulativeUsage` without the thinking-token count, so `getLastUsage()`
  reported `0` (and undercounted cost) even when the response carried thoughts.
  `result.usage` was already correct.

### Added
- **`effort: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'`** on every
  class — the cross-package option name (identical to ak-claude). Maps to
  `thinkingConfig.thinkingLevel` and wins over an explicit `thinkingLevel` /
  `thinkingBudget` (the two are mutually exclusive on the wire). `xhigh` and
  `max` are ak-claude-only levels and clamp to `high`. An unrecognized level
  throws at construction.
- **`usage.cachedTokens`** on every `send()`/`chat()`/`generate()` result and on
  `getLastUsage()`.
- **Pricing for new models:** `gemini-3.6-flash` ($1.50/$7.50, cached $0.15) and
  `gemini-3.5-flash-lite` ($0.30/$2.50, cached $0.03).
- **`cachedInput` rates** on every model where Google publishes one, plus
  `inputAbove200k` / `outputAbove200k` / `cachedInputAbove200k` on the tiered Pro
  models.
- **New exports:** `MODEL_PRICING_AS_OF` (the date the table was last verified
  against Google's pricing page) and `EFFORT_LEVELS`. `resolvePricing()` now
  returns `asOf` and `tierThreshold`.
- `computeCost()` takes two new optional trailing args:
  `computeCost(modelId, prompt, response, thoughtsTokens?, cachedTokens?)`.

### Notes
- `null` from `resolvePricing()` / `usage.estimatedCost` means the model's
  pricing is **unknown** — it does not mean the call was free.
- Cache **storage** ($1.00/1M tokens/hour on Flash tiers, $4.50 on Pro) is
  time-based and is **not** modelled by `estimatedCost` — only per-token charges
  are.
- Image-output tokens on Nano Banana models ($60/M or $120/M) are still not
  modelled.

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
