import { NextRequest, NextResponse } from 'next/server';
import { PlannerOperationalError } from '@/agent/planner';
import { createOrchestrator } from '@/core/factory';
import { getResumableService } from '@/core/resumable-store';
import { createRequestId } from '@/core/request-guard';
import { PersistenceError } from '@/core/persistence';

export const runtime = 'nodejs';

const RATE_LIMIT_MAX = Number(process.env.VERIFY_RATE_LIMIT_MAX ?? 30);
const RATE_LIMIT_WINDOW_MS = Number(process.env.VERIFY_RATE_LIMIT_WINDOW_MS ?? 60_000);

function response(requestId: string, body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: { 'X-Request-Id': requestId } });
}

function clientScope(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const connecting = request.headers.get('cf-connecting-ip')?.trim();
  return `verify:${forwarded || connecting || 'anonymous'}`;
}

export async function POST(request: NextRequest) {
  const requestId = createRequestId(request.headers.get('x-request-id'));
  const started = Date.now();
  try {
    const resumableService = getResumableService();
    const limit = await resumableService.persistence.consumeRateLimit(clientScope(request), RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
    if (!limit.allowed) return response(requestId, { error: 'Too many verification requests', code: 'RATE_LIMITED' }, 429);

    const body = await request.json() as { mode?: unknown; caseId?: unknown; evidence?: unknown; milestone?: unknown; githubRepository?: unknown };
    if (body.mode === 'start') {
      if (typeof body.milestone !== 'string' || typeof body.githubRepository !== 'string') return response(requestId, { error: 'Invalid verification request', code: 'INVALID_REQUEST' }, 400);
      if (body.milestone.length > 12_000) return response(requestId, { error: 'Verification request is too large', code: 'REQUEST_TOO_LARGE' }, 413);
      return response(requestId, await resumableService.start({ milestone: body.milestone, githubRepository: body.githubRepository }, { requestId }), 200);
    }
    if (body.mode === 'resume') {
      if (typeof body.caseId !== 'string' || !body.evidence || typeof body.evidence !== 'object') return response(requestId, { error: 'Invalid evidence request', code: 'INVALID_REQUEST' }, 400);
      const idempotencyKey = request.headers.get('idempotency-key') ?? request.headers.get('x-idempotency-key') ?? requestId;
      return response(requestId, await resumableService.supplyEvidence(body.caseId, body.evidence as never, { requestId, idempotencyKey }), 200);
    }
    if (body.mode === 'get') {
      if (typeof body.caseId !== 'string') return response(requestId, { error: 'Invalid case request', code: 'INVALID_REQUEST' }, 400);
      return response(requestId, await resumableService.get(body.caseId), 200);
    }
    if (typeof body.milestone !== 'string' || typeof body.githubRepository !== 'string') {
      return response(requestId, { error: 'Invalid verification request', code: 'INVALID_REQUEST' }, 400);
    }
    if (body.milestone.length > 12_000) return response(requestId, { error: 'Verification request is too large', code: 'REQUEST_TOO_LARGE' }, 413);
    const run = await createOrchestrator().verify({ milestone: body.milestone, githubRepository: body.githubRepository });
    return response(requestId, run, 200);
  } catch (error) {
    console.info(JSON.stringify({
      event: 'verification_request_failed',
      requestId,
      durationMs: Date.now() - started,
      errorType: error instanceof Error ? error.name : 'unknown',
      errorCode: error instanceof PlannerOperationalError ? error.code : error instanceof PersistenceError ? error.code : null,
      plannerReason: error instanceof PlannerOperationalError ? error.reason : null,
      plannerFailureCategory: error instanceof PlannerOperationalError ? error.failureCategory : null,
    }));
    if (error instanceof PlannerOperationalError) {
      const status = error.code === 'PLANNER_INVALID_OUTPUT' ? 502 : 503;
      return response(requestId, { error: error.code === 'PLANNER_UNAVAILABLE' ? 'Verification could not be planned.' : 'The production planner could not produce a valid plan.', code: error.code }, status);
    }
    if (error instanceof PersistenceError) {
      if (error.code === 'CASE_NOT_FOUND') return response(requestId, { error: 'Verification case not found', code: error.code }, 404);
      if (error.code === 'RESUME_LOCKED' || error.code === 'VERSION_CONFLICT' || error.code === 'IDEMPOTENCY_CONFLICT') return response(requestId, { error: error.message, code: error.code }, 409);
      return response(requestId, { error: 'Durable verification state is unavailable', code: error.code }, 503);
    }
    return response(requestId, { error: 'Verification could not be completed', code: 'VERIFICATION_FAILED' }, 400);
  }
}

export async function GET(request: NextRequest) {
  return response(createRequestId(request.headers.get('x-request-id')), { error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' }, 405);
}
