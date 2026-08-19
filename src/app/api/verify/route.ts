import { NextRequest, NextResponse } from 'next/server';
import { PlannerOperationalError } from '@/agent/planner';
import { createOrchestrator } from '@/core/factory';
import { resumableService } from '@/core/resumable-store';
import { createRequestId, RateLimiter } from '@/core/request-guard';

export const runtime = 'nodejs';
const limiter = new RateLimiter({ max: Number(process.env.VERIFY_RATE_LIMIT_MAX ?? 30), windowMs: Number(process.env.VERIFY_RATE_LIMIT_WINDOW_MS ?? 60_000) });

function response(requestId: string, body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: { 'X-Request-Id': requestId } });
}

export async function POST(request: NextRequest) {
  const requestId = createRequestId(request.headers.get('x-request-id'));
  const started = Date.now();
  const clientKey = request.headers.get('cf-connecting-ip') ?? 'anonymous';
  if (!limiter.allow(clientKey)) return response(requestId, { error: 'Too many verification requests', code: 'RATE_LIMITED' }, 429);
  try {
    const body = await request.json() as { mode?: unknown; caseId?: unknown; evidence?: unknown; milestone?: unknown; githubRepository?: unknown };
    if (body.mode === 'start') {
      if (typeof body.milestone !== 'string' || typeof body.githubRepository !== 'string') return response(requestId, { error: 'Invalid verification request', code: 'INVALID_REQUEST' }, 400);
      if (body.milestone.length > 12_000) return response(requestId, { error: 'Verification request is too large', code: 'REQUEST_TOO_LARGE' }, 413);
      return response(requestId, await resumableService.start({ milestone: body.milestone, githubRepository: body.githubRepository }), 200);
    }
    if (body.mode === 'resume') {
      if (typeof body.caseId !== 'string' || !body.evidence || typeof body.evidence !== 'object') return response(requestId, { error: 'Invalid evidence request', code: 'INVALID_REQUEST' }, 400);
      return response(requestId, await resumableService.supplyEvidence(body.caseId, body.evidence as never), 200);
    }
    if (body.mode === 'get') {
      if (typeof body.caseId !== 'string') return response(requestId, { error: 'Invalid case request', code: 'INVALID_REQUEST' }, 400);
      return response(requestId, resumableService.get(body.caseId), 200);
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
      errorCode: error instanceof PlannerOperationalError ? error.code : null,
      plannerReason: error instanceof PlannerOperationalError ? error.reason : null,
      plannerFailureCategory: error instanceof PlannerOperationalError ? error.failureCategory : null,
    }));
    if (error instanceof PlannerOperationalError) {
      const status = error.code === 'PLANNER_INVALID_OUTPUT' ? 502 : 503;
      return response(requestId, { error: error.code === 'PLANNER_UNAVAILABLE' ? 'Verification could not be planned.' : 'The production planner could not produce a valid plan.', code: error.code }, status);
    }
    return response(requestId, { error: 'Verification could not be completed', code: 'VERIFICATION_FAILED' }, 400);
  }
}

export async function GET(request: NextRequest) {
  return response(createRequestId(request.headers.get('x-request-id')), { error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' }, 405);
}
