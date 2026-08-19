import { CanonicalPlannerValidationError, parseCanonicalPlannerOutput, CANONICAL_PLAN_SCHEMA, PLANNER_SYSTEM_PROMPT, plannerDataPrompt } from './canonical-planner.ts';
import { PlannerOperationalError, type MilestonePlanner, type PlannerFailureCategory, type PlannerInput, type PlannerMetadata } from './planner.ts';
import { normalizeAcceptanceTerms } from '../core/coverage.ts';
import type { VerificationPlan } from '../core/types.ts';

const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
const DEFAULT_DEEPSEEK_MODEL = 'deepseek-chat';
const PLANNER_VERSION = 'provider-planner-v1';

type ProviderName = 'gemini' | 'deepseek';
type ProviderRole = 'primary' | 'fallback';
type FailureKind = 'operational' | 'invalid';

interface ProviderPlannerOptions {
  geminiApiKey?: string;
  deepseekApiKey?: string;
  geminiModel?: string;
  deepseekModel?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  now?: () => Date;
  plannerVersion?: string;
}

interface ProviderSuccess {
  plan: VerificationPlan;
  model: string;
}

class ProviderAttemptError extends Error {
  readonly kind: FailureKind;
  readonly failoverEligible: boolean;
  readonly reason: string;
  readonly failureCategory: PlannerFailureCategory;

  constructor(kind: FailureKind, reason: string, failoverEligible = true, failureCategory = plannerFailureCategory(reason)) {
    super('Planner provider attempt failed');
    this.name = 'ProviderAttemptError';
    this.kind = kind;
    this.reason = reason;
    this.failoverEligible = failoverEligible;
    this.failureCategory = failureCategory;
  }
}

export class ProviderPlanner implements MilestonePlanner {
  private readonly options: Required<Pick<ProviderPlannerOptions, 'timeoutMs' | 'maxRetries' | 'retryDelayMs'>> & ProviderPlannerOptions;
  private lastMetadata: PlannerMetadata;

  constructor(options: ProviderPlannerOptions = {}) {
    this.options = {
      ...options,
      timeoutMs: Math.max(1, options.timeoutMs ?? 30_000),
      maxRetries: Math.max(0, options.maxRetries ?? 1),
      retryDelayMs: Math.max(0, options.retryDelayMs ?? 150),
    };
    this.lastMetadata = {
      kind: 'provider-neutral',
      provider: null,
      model: null,
      role: null,
      failoverReason: null,
      failureCategory: null,
      timestamp: null,
      version: this.version(),
    };
  }

  metadata(): PlannerMetadata {
    return { ...this.lastMetadata };
  }

  preflight(): void {
    if (!this.geminiApiKey() && !this.deepseekApiKey()) {
      throw unavailableError('no_provider_configured');
    }
  }

  async plan(input: PlannerInput): Promise<VerificationPlan> {
    this.preflight();
    const terms = input.acceptanceTerms ?? normalizeAcceptanceTerms(input.milestone);
    const primaryKey = this.geminiApiKey();
    const secondaryKey = this.deepseekApiKey();
    let failoverReason: string | null = null;

    if (primaryKey) {
      try {
        const success = await this.attempt('gemini', primaryKey, this.geminiModel(), input, terms);
        return this.recordSuccess('gemini', 'primary', success, null);
      } catch (error) {
        const failure = asProviderAttemptError(error);
        if (failure.kind === 'invalid') throw invalidOutputError(failure.reason, failure.failureCategory);
        if (!failure.failoverEligible) throw upstreamError(failure.reason, failure.failureCategory);
        failoverReason = failure.reason;
      }
    } else {
      failoverReason = 'gemini_not_configured';
    }

    if (!secondaryKey) throw unavailableError(failoverReason ?? 'deepseek_not_configured', failoverReason ? plannerFailureCategory(failoverReason) : null);
    try {
      const success = await this.attempt('deepseek', secondaryKey, this.deepseekModel(), input, terms);
      return this.recordSuccess('deepseek', 'fallback', success, failoverReason);
    } catch (error) {
      const failure = asProviderAttemptError(error);
      const contextualReason = failoverReason && failoverReason !== 'gemini_not_configured'
        ? `${failure.reason}_after_${failoverReason}`
        : failure.reason;
      if (failure.kind === 'invalid') throw invalidOutputError(contextualReason, failure.failureCategory);
      throw unavailableError(contextualReason, failure.failureCategory);
    }
  }

  private async attempt(provider: ProviderName, apiKey: string, model: string, input: PlannerInput, terms: ReturnType<typeof normalizeAcceptanceTerms>): Promise<ProviderSuccess> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const body = provider === 'gemini'
      ? JSON.stringify({
        systemInstruction: { parts: [{ text: PLANNER_SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: `${plannerDataPrompt(input, terms)}\n\nReturn exactly one compact JSON object matching the supplied canonical schema. Use one claim and one bounded step for each planned term; do not add prose.` }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseJsonSchema: CANONICAL_PLAN_SCHEMA,
          temperature: 0,
          maxOutputTokens: 8_000,
        },
      })
      : JSON.stringify({
        model,
        messages: [
          { role: 'system', content: `${PLANNER_SYSTEM_PROMPT}\n\nCanonical JSON Schema:\n${JSON.stringify(CANONICAL_PLAN_SCHEMA)}\n\nThe response must be valid JSON. Do not use Markdown fences.` },
          { role: 'user', content: `${plannerDataPrompt(input, terms)}\n\nReturn exactly one compact JSON object with top-level keys acceptanceTerms, claims, and missingEvidence. Every claim must include id, acceptanceTermIds, statement, required, testability, and steps; every step must include id, claimId, adapter, operation, and params. Do not add prose or verdict fields.` },
        ],
        response_format: { type: 'json_object' },
        temperature: 0,
        max_tokens: 8_000,
        stream: false,
      });

    const url = provider === 'gemini'
      ? `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`
      : 'https://api.deepseek.com/chat/completions';
    const headers = provider === 'gemini'
      ? { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey }
      : { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };

    for (let attempt = 0; attempt <= this.options.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);
      let response: Response;
      try {
        response = await fetchImpl(url, { method: 'POST', headers, body, signal: controller.signal });
      } catch {
        clearTimeout(timeout);
        const reason = controller.signal.aborted ? `${provider}_timeout` : `${provider}_network`;
        if (attempt < this.options.maxRetries && shouldRetryProviderFailure(reason)) {
          await retryDelay(this.options.retryDelayMs, attempt);
          continue;
        }
        throw new ProviderAttemptError('operational', reason, true);
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        const reason = await safeProviderResponseReason(provider, response, response.status);
        if (isRetryableStatus(response.status)) {
          if (attempt < this.options.maxRetries) {
            await retryDelay(this.options.retryDelayMs, attempt);
            continue;
          }
          throw new ProviderAttemptError('operational', reason, true);
        }
        throw new ProviderAttemptError('operational', reason, false);
      }

      let raw: unknown;
      try {
        raw = await response.json();
      } catch {
        if (attempt < this.options.maxRetries) {
          await retryDelay(this.options.retryDelayMs, attempt);
          continue;
        }
        throw new ProviderAttemptError('operational', `${provider}_malformed_response`, true);
      }

      let text: string;
      try {
        text = provider === 'gemini' ? extractGeminiText(raw) : extractDeepSeekText(raw);
      } catch (error) {
        const reason = error instanceof EmptyProviderResponseError
          ? `${provider}_empty_response`
          : `${provider}_malformed_response`;
        if (attempt < this.options.maxRetries) {
          await retryDelay(this.options.retryDelayMs, attempt);
          continue;
        }
        throw new ProviderAttemptError('operational', reason, true);
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        if (attempt < this.options.maxRetries) {
          await retryDelay(this.options.retryDelayMs, attempt);
          continue;
        }
        throw new ProviderAttemptError('operational', `${provider}_malformed_response`, true);
      }

      try {
        return { plan: parseCanonicalPlannerOutput(parsed, terms), model: responseModel(provider, raw, model) };
      } catch (error) {
        if (error instanceof CanonicalPlannerValidationError && error.kind === 'semantic') {
          throw new ProviderAttemptError('invalid', semanticFailureReason(provider, error), false);
        }
        if (error instanceof CanonicalPlannerValidationError && error.kind === 'canonical') {
          const reason = canonicalFailureReason(provider, error);
          if (provider === 'gemini') {
            if (attempt < this.options.maxRetries) {
              await retryDelay(this.options.retryDelayMs, attempt);
              continue;
            }
            throw new ProviderAttemptError('operational', reason, true);
          }
          throw new ProviderAttemptError('invalid', reason, false);
        }
        if (provider === 'gemini') {
          if (attempt < this.options.maxRetries) {
            await retryDelay(this.options.retryDelayMs, attempt);
            continue;
          }
          throw new ProviderAttemptError('operational', canonicalFailureReason(provider, error), true);
        }
        throw new ProviderAttemptError('invalid', canonicalFailureReason(provider, error), false);
      }
    }
    throw new ProviderAttemptError('operational', `${provider}_retry_exhausted`, true);
  }

  private recordSuccess(provider: ProviderName, role: ProviderRole, success: ProviderSuccess, failoverReason: string | null): VerificationPlan {
    const timestamp = (this.options.now ?? (() => new Date()))().toISOString();
    this.lastMetadata = {
      kind: provider,
      provider,
      model: success.model,
      role,
      failoverReason,
      failureCategory: failoverReason ? plannerFailureCategory(failoverReason) : null,
      timestamp,
      version: this.version(),
    };
    return success.plan;
  }

  private geminiApiKey(): string | null {
    return configured(this.options.geminiApiKey !== undefined ? this.options.geminiApiKey : process.env.GEMINI_API_KEY);
  }

  private deepseekApiKey(): string | null {
    return configured(this.options.deepseekApiKey !== undefined ? this.options.deepseekApiKey : process.env.DEEPSEEK_API_KEY);
  }

  private geminiModel(): string {
    return configured(this.options.geminiModel !== undefined ? this.options.geminiModel : process.env.GEMINI_MODEL) ?? DEFAULT_GEMINI_MODEL;
  }

  private deepseekModel(): string {
    return configured(this.options.deepseekModel !== undefined ? this.options.deepseekModel : process.env.DEEPSEEK_MODEL) ?? DEFAULT_DEEPSEEK_MODEL;
  }

  private version(): string {
    return this.options.plannerVersion?.trim() || PLANNER_VERSION;
  }
}

class EmptyProviderResponseError extends Error {}

function extractGeminiText(raw: unknown): string {
  const object = asObject(raw);
  const candidates = Array.isArray(object.candidates) ? object.candidates : [];
  for (const candidate of candidates) {
    const content = asObject(candidate).content;
    const parts = asObject(content).parts;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      const text = asObject(part).text;
      if (typeof text === 'string' && text.trim()) return text;
    }
  }
  throw new EmptyProviderResponseError();
}

function extractDeepSeekText(raw: unknown): string {
  const object = asObject(raw);
  const choices = Array.isArray(object.choices) ? object.choices : [];
  for (const choice of choices) {
    const message = asObject(asObject(choice).message);
    const content = message.content;
    if (typeof content === 'string' && content.trim()) return content;
    if (Array.isArray(content)) {
      const text = content.map((part) => asObject(part).text).filter((item): item is string => typeof item === 'string').join('');
      if (text.trim()) return text;
    }
  }
  throw new EmptyProviderResponseError();
}

function responseModel(provider: ProviderName, raw: unknown, requested: string): string {
  const object = asObject(raw);
  const candidate = provider === 'gemini' ? object.modelVersion : object.model;
  if (typeof candidate === 'string' && /^[\w.:-]{1,120}$/.test(candidate)) return candidate;
  return requested;
}

async function safeProviderResponseReason(provider: ProviderName, response: Response, status: number): Promise<string> {
  let raw: unknown;
  try {
    raw = await response.clone().json();
  } catch {
    return `${provider}_${status}`;
  }
  const error = asObject(asObject(raw).error);
  const providerStatus = typeof error.status === 'string' ? error.status.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') : '';
  if (providerStatus) return `${provider}_${status}_${providerStatus}`;
  const message = typeof error.message === 'string' ? error.message.toLowerCase() : '';
  if (/(api[ _-]?key|authentication|unauthori[sz]ed|permission|forbidden)/.test(message)) return `${provider}_${status}_auth`;
  if (/(schema|json|invalid[ _-]?argument|invalid[ _-]?request)/.test(message)) return `${provider}_${status}_invalid_argument`;
  return `${provider}_${status}`;
}

function canonicalFailureReason(provider: ProviderName, error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (/GitHub .* must leave/i.test(message)) return `${provider}_invalid_github_parameter`;
  if (/HTTP .* expectation is invalid/i.test(message)) return `${provider}_invalid_http_parameter`;
  if (/npm .* expected value|npm .* needs an expected/i.test(message)) return `${provider}_invalid_npm_parameter`;
  if (/Forbidden or unexpected fields in claims?\b/i.test(message)) return `${provider}_forbidden_fields`;
  if (/Forbidden or unexpected fields in .*params/i.test(message)) return `${provider}_forbidden_params`;
  if (/Forbidden or unexpected fields in plan/i.test(message)) return `${provider}_forbidden_plan_fields`;
  if (/Invalid plan\b/i.test(message)) return `${provider}_invalid_plan_shape`;
  if (/Invalid claims?\b/i.test(message)) return `${provider}_invalid_claim_shape`;
  if (/Invalid acceptanceTerms/i.test(message)) return `${provider}_invalid_acceptance_terms`;
  if (/Unsupported|Invalid (GitHub|HTTP|Base|npm)|needs an expected|requires HTTPS|package name|contract address/i.test(message)) return `${provider}_unsupported_step`;
  return `${provider}_canonical_validation`;
}

function semanticFailureReason(provider: ProviderName, error: CanonicalPlannerValidationError): string {
  const message = error.message;
  if (/did not account for every acceptance term/i.test(message)) return `${provider}_coverage_gap`;
  if (/unknown acceptance term/i.test(message)) return `${provider}_unknown_term`;
  if (/duplicate acceptance term|duplicate or conflicting verification step/i.test(message)) return `${provider}_duplicate_route`;
  if (/planned acceptance term is not executable/i.test(message)) return `${provider}_planned_not_executable`;
  if (/must link to/i.test(message)) return `${provider}_claim_link_error`;
  if (/HTTP JSON field expectation/i.test(message)) return `${provider}_invalid_json_field_expectation`;
  if (/HTTP status expectation/i.test(message)) return `${provider}_invalid_http_status_expectation`;
  if (/npm .* expected value/i.test(message)) return `${provider}_invalid_npm_version_parameter`;
  if (/GitHub .* must leave/i.test(message)) return `${provider}_invalid_github_parameter`;
  return `${provider}_semantic_validation`;
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function configured(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function shouldRetryProviderFailure(reason: string): boolean {
  return !reason.endsWith('_timeout');
}

function asProviderAttemptError(error: unknown): ProviderAttemptError {
  if (error instanceof ProviderAttemptError) return error;
  return new ProviderAttemptError('operational', 'provider_unknown_failure', true);
}

function unavailableError(reason?: string, failureCategory?: PlannerFailureCategory | null): PlannerOperationalError {
  return new PlannerOperationalError('PLANNER_UNAVAILABLE', 'Verification could not be planned because no production planner returned a valid plan.', { reason, failureCategory: failureCategory ?? (reason ? plannerFailureCategory(reason) : null) });
}

function upstreamError(reason?: string, failureCategory?: PlannerFailureCategory | null): PlannerOperationalError {
  return new PlannerOperationalError('PLANNER_UPSTREAM_ERROR', 'The primary production planner returned a non-retryable provider error.', { reason, failureCategory: failureCategory ?? (reason ? plannerFailureCategory(reason) : null) });
}

function invalidOutputError(reason?: string, failureCategory?: PlannerFailureCategory | null): PlannerOperationalError {
  return new PlannerOperationalError('PLANNER_INVALID_OUTPUT', 'The production planner returned an invalid verification plan.', { reason, failureCategory: failureCategory ?? (reason ? plannerFailureCategory(reason) : null) });
}

function plannerFailureCategory(reason: string): PlannerFailureCategory {
  const value = reason.toLowerCase();
  if (value.includes('timeout')) return 'provider_timeout';
  if (/(429|quota|rate_limit)/.test(value)) return 'provider_rate_limit';
  if (/(5\d\d|network|outage|transport|upstream)/.test(value)) return 'provider_outage';
  if (value.includes('empty_response')) return 'empty_response';
  if (/(malformed_response|invalid_structured)/.test(value)) return 'invalid_structured_output';
  if (/(coverage_gap|semantic_validation|planned_not_executable|unknown_term|claim_link_error)/.test(value)) return 'semantic_coverage_rejection';
  if (/(duplicate_route|duplicate)/.test(value)) return 'duplicate_route_rejection';
  if (/(unsupported|allowlisted)/.test(value)) return 'unsupported_capability';
  if (/(proof_strength|not_established|capability)/.test(value)) return 'proof_strength_mismatch';
  if (/(schema|canonical|forbidden|invalid_plan|invalid_claim|invalid_acceptance|invalid_.*parameter)/.test(value)) return 'schema_rejection';
  return 'unknown';
}

async function retryDelay(baseMs: number, attempt: number): Promise<void> {
  const delay = Math.min(1_000, Math.max(0, baseMs) * (attempt + 1));
  if (delay > 0) await new Promise<void>((resolve) => setTimeout(resolve, delay));
}
