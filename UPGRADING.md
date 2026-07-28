# Upgrading ak-gemini

Per-version upgrade notes. For the full list of changes see [CHANGELOG.md](./CHANGELOG.md). For the v1.x → v2.0 rewrite, see [MIGRATION.md](./MIGRATION.md).

---

## 2.5.0 → 2.6.0

**Minor bump. No API surface is removed and no call signature breaks.** What changes is what `estimatedCost` reports — in most cases it goes *down*, because cached tokens and context tiers are now modelled correctly.

Companion release to **ak-claude 0.2.0**; the two packages keep matching option names.

### At a glance

| If you… | Then… |
|---|---|
| don't use context caching and stay under 200k tokens | numbers are unchanged, except `gemini-2.5-flash` — see #3 |
| use context caching (`cachedContent` / `useCache()`) | your reported cost drops — cached tokens now bill at the discounted rate, see #1 |
| send >200k-token prompts to a Pro model | your reported cost rises to the correct tier rate — see #2 |
| use `gemini-2.5-flash` | output rate corrected $2.50 → $3.00 per M — see #3 |
| use `gemini-flash-latest` or `gemini-flash-lite-latest` | these aliases now resolve to newer models — see #4 |
| read `getLastUsage()` on Chat / ToolAgent / CodeAgent / RagAgent / Transformer | `thoughtsTokens` is now non-zero when thinking ran — see #5 |
| want to control reasoning depth | new `effort` option — see #6 |

---

### 1. Cached tokens are billed at the cached rate

**This is the change most likely to move your numbers.**

Gemini's `promptTokenCount` **includes** `cachedContentTokenCount`. Before 2.6.0, ak-gemini billed the whole prompt count at the full input rate, so cached tokens were charged as if they were fresh — a large overestimate on cache-heavy workloads.

`computeCost()` now subtracts cached tokens from the prompt count and re-bills them at `cachedInput` (roughly a 10× discount):

```js
// promptTokens: 10_000, of which cachedTokens: 8_000, on gemini-3.5-flash
// 2.5.0:  10_000 × $1.50/M                        = $0.0150
// 2.6.0:   2_000 × $1.50/M + 8_000 × $0.15/M      = $0.0042
```

`usage.cachedTokens` is now exposed on both `getLastUsage()` and per-call `result.usage`.

> **`cachedTokens` is a SUBSET of `promptTokens`, not an addition.** Do not sum them. This is the opposite of **ak-claude**, where Anthropic *excludes* cache tokens from `input_tokens` and they are added on top. If you have code that normalizes usage across both packages, this asymmetry is the thing to get right.

Models with no published `cachedInput` rate fall back to the full input rate — an overestimate, never an underestimate.

**Still not modelled:** cache *storage*, which is time-based ($1.00 per 1M tokens per hour on Flash tiers, $4.50 on Pro). `estimatedCost` covers per-token charges only.

### 2. Context-tier pricing above 200k tokens

Pro models switch to a higher rate above 200,000 prompt tokens. Previously ak-gemini always billed the ≤200k tier, understating cost on long-context calls.

```js
resolvePricing('gemini-2.5-pro')
// { input: 1.25, output: 10.00, cachedInput: 0.125,
//   inputAbove200k: 2.50, outputAbove200k: 15.00, cachedInputAbove200k: 0.25,
//   tierThreshold: 200000, asOf: '2026-07-28' }
```

`computeCost()` picks the tier from `promptTokens` automatically. Populated for `gemini-2.5-pro` and `gemini-3.1-pro-preview`.

### 3. `gemini-2.5-flash` output rate corrected

$2.50 → **$3.00** per M output tokens. The old value was wrong against Google's published pricing. If you track cost over time, expect a step change here.

### 4. Alias repointing

| Alias | 2.5.0 resolved to | 2.6.0 resolves to |
|---|---|---|
| `gemini-flash-latest` | `gemini-3.5-flash` | `gemini-3.6-flash` |
| `gemini-flash-lite-latest` | `gemini-3.1-flash-lite` | `gemini-3.5-flash-lite` |

Aliases are a pricing-table convenience and go stale whenever Google rotates what they point at. ak-gemini already prefers the model id the API **echoes** (`response.modelVersion`) over the alias you requested, and now logs each alias resolution at debug level. Pin a concrete model id if you need cost reporting you can audit.

New pricing entries: `gemini-3.6-flash` ($1.50 / $7.50) and `gemini-3.5-flash-lite` ($0.30 / $2.50).

### 5. `thoughtsTokens` now appears in `getLastUsage()`

`Chat`, `ToolAgent`, `CodeAgent`, `RagAgent`, and `Transformer` seeded their cumulative usage without `thoughtsTokens`, so `getLastUsage()` reported `0` and **omitted thinking tokens from `estimatedCost`** even when the response carried them. Per-call `result.usage` was already correct.

If you read cost from `getLastUsage()` on a thinking-enabled model, your reported cost will rise — it was under-reporting before. Thinking tokens bill at the output rate.

### 6. New `effort` option

The cross-package reasoning-depth knob — same option name in ak-claude.

```js
new Chat({ modelName: 'gemini-3.5-flash', effort: 'high' })
// → thinkingConfig: { thinkingLevel: 'high' }
```

Accepts `'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'`. Gemini's wire field only goes up to `high`, so **`xhigh` and `max` clamp to `high`** — they exist so the same config object works against both packages. An unrecognized value **throws at construction**.

`effort` wins over an explicit `thinkingLevel` or `thinkingBudget`; `thinkingLevel` and `thinkingBudget` are mutually exclusive on the wire, so setting `effort` deletes any budget. `thinkingConfig: null` still disables thinking outright and takes precedence over `effort`.

`thinkingConfig: { thinkingBudget: N }` continues to work unchanged.

### New exports

```js
import {
  MODEL_PRICING_AS_OF,   // date the pricing table was last verified
  EFFORT_LEVELS,         // ['minimal','low','medium','high','xhigh','max']
  resolvePricing,        // now returns `tierThreshold` and `asOf`
  computeCost            // now takes (model, prompt, response, thoughts?, cached?)
} from 'ak-gemini';
```

`computeCost()`'s new `cachedTokens` argument is optional and trailing — existing 3- and 4-argument calls behave as before, except for the tier selection in #2.

> **A `null` from `resolvePricing()` or `estimatedCost` means UNKNOWN, not free.** Unpriced models (Gemma, anything not in the table) return `null`. Don't coerce it to `0` in a cost rollup.
