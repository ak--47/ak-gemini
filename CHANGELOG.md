# Changelog

## 2.7.0

Follow-on sweep to 2.6.2, from a full read of the package by a downstream
consumer (mixpanel-power-tools: 7 streaming agents + ~22 Transformer macros).
Same theme as the `labels` bug: config and metadata the non-streaming path
handles correctly were being dropped on a parallel path. Paired with
ak-claude 0.3.0.

**Minor** bump — reported token counts and `estimatedCost` change (upward, to
the truth) and `Transformer.send()` retry behavior changes. No signatures
removed.

### Behavior changes (read before upgrading)

- **`estimatedCost` for `gemini-3.6-flash` drops ~2×.** Google's published rate
  is $0.75/$3.75 per M through 2026-12-31, rising to $1.50/$7.50 on 2027-01-01.
  The table had only the post-2027 rate, so every 3.6-flash cost estimate was
  double. Now modelled as a date-windowed `intro` block —
  `resolvePricing(id, { at })` / `computeCost(..., { at })` price a call at a
  given point in time (ported from ak-claude).
- **`gemini-2.5-flash` output was $3.00, actual is $2.50; its cached rate was
  $0.05, actual is $0.03.** Corrected.
- **Multi-round and streaming usage numbers go UP, because they were wrong.**
  See "Fixed" below. Anything asserting exact token counts from a `ToolAgent` /
  `CodeAgent` turn will need updating — the old numbers covered one round.
- **`usage.attempts` on the agent classes** is now the number of API
  round-trips in the turn (was hardcoded `1`).
- **Default model is now `gemini-3.7-flash`** (was `gemini-3.6-flash`). Stable,
  same rate card as 3.6-flash, and Google describes it as the flagship Flash for
  coding and agentic work. Pass `modelName: 'gemini-3.6-flash'` to keep the old
  default. `gemini-flash-latest` now resolves to 3.7-flash for pricing.
  **Not verified live on Vertex** — smoke-test before relying on it.

### Fixed

- **`stream()` never reported usage.** Every `stream()` yielded
  `usage: this.getLastUsage()` without ever reading `usageMetadata` off the
  stream, so the `done` event carried `null` on a fresh instance or stale
  numbers from an unrelated earlier call on a reused one. All agent cost
  telemetry built on streaming was dead. Fixed in `Chat`, `RagAgent`,
  `ToolAgent` and `CodeAgent` via the new protected `_streamUsage()` helper.
- **Multi-round tool turns reported one round.** `ToolAgent.chat()` /
  `CodeAgent.chat()` assigned usage from the FINAL response after the loop. A
  6-round conversation makes 7 calls; the report covered one. Because
  `promptTokens` grows with accumulated history, the final round is the largest
  single call — so the number looked plausible while undercounting several-fold.
  Now accumulated per round via `_accumulateUsage()`.
- **Text emitted alongside a `functionCall` was dropped.** The chunk loop used
  `if (chunk.functionCalls) … else if (text)`, but Gemini routinely emits a
  preamble in the SAME chunk as the call. That text was never yielded and never
  reached `fullText` — the agent appeared to go silent, then jump to a tool call.
- **Chunks with multiple parts were truncated.** The loops read
  `content.parts[0].text` only, silently losing parts 1..n. Now every part is
  read, and `thought` parts are skipped so thought summaries never leak into
  user-visible text.
- **`Transformer.rebuild()` diverged from `rawSend()`.** It called bare
  `JSON.parse` (throwing on the markdown fences a conversational repair prompt
  usually produces) and skipped the `{data: …}` unwrap that seeded Transformers
  need — so attempt 0 returned `payload` and attempt ≥1 returned
  `{data: payload}`. With a validator that was a guaranteed retry-exhaustion
  loop. Both now share `_parseModelResponse()`. `rebuild()` also threads
  per-message labels through, so billing attribution survives a repair.
- **`send()` retried against the original input.** `lastPayload` only advanced
  on success, so when attempt 0 failed to PARSE, attempt 1 called
  `rebuild(ORIGINAL_INPUT, …)` — telling the model its own input was the bad
  output, double-encoded because `_preparePayload` had already stringified it.
  Extraction and validation failures are now distinguished: extraction failures
  re-send the task with a format nudge; validation failures still repair the
  payload the model actually produced.
- **Stateless paths ignored grounding and caching.** `Transformer._statelessSend`
  and `Message.send` built their config from raw `chatConfig`, but
  `enableGrounding` tools and `cachedContent` live in `_getChatCreateOptions()`.
  Both were silent no-ops on those paths. Both now build from the same place.
- **`stop()` mid-round produced a malformed turn.** A `stop()` landing partway
  through `ToolAgent.stream()`'s sequential branch left `toolResults` short, and
  the partial set was still sent — Gemini requires exactly one `functionResponse`
  per `functionCall`, so that was a 400. It now bails out before the send.
- **`useCache()` permanently deleted the system instruction.** It did
  `delete this.chatConfig.systemInstruction`, which is correct for the cached
  call but one-way: a later `deleteCache()` left the instance with no cache AND
  no system prompt. `systemInstruction` is now stripped at request-build time
  while a cache is attached, so detaching restores it.

### Added

- `gemini-3.7-flash` (new default), plus the newly-stable `gemini-3.1-flash-image`,
  `gemini-3.1-flash-lite-image`, `gemini-3-pro-image` and `gemini-embedding-2-preview`
  in `MODEL_PRICING`. `gemini-3-flash-preview` gained its published `cachedInput`
  rate ($0.05), which it was missing.
- Date-windowed promotional pricing: `resolvePricing(id, { at })` and
  `computeCost(..., { at })`. Matches ak-claude's API, plus `cachedInput` in the
  `intro` block (Google discounts the cached rate during a promo).
- Protected `BaseGemini` helpers: `_resetUsage()`, `_accumulateUsage()`,
  `_streamUsage()`, `_chunkTextParts()`.
- 13 offline regression tests in `tests/consumer-fixes.test.js` (60 total).

### Changed

- **`@google/genai` `^2.15.0` → `^2.18.0`.** Changelog-audited across
  2.16.0–2.18.0: no breaking changes to `chats.create`, `sendMessage`,
  `sendMessageStream`, `generateContent` config or `usageMetadata`. 2.17.1 adds
  the `gemini-3.7-flash` id. The flagged items (per-attempt `HttpOptions.timeout`,
  structured `speech_config`, the `TOO_MANY_TOOL_CALLS` finish reason, the
  `REQUIRES_ACTION` live-status deprecation) touch no code in this package.
- `MODEL_PRICING_AS_OF` → `2026-08-24`.

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
