import { NextRequest, NextResponse } from 'next/server';
import { getResumableService } from '../../../src/core/resumable-store';
import { PersistenceError } from '../../../src/core/persistence';

export const runtime = 'nodejs';

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

export async function GET(request: NextRequest) {
  if (process.env.VERCEL_ENV !== 'preview') {
    return json({ error: 'Not found' }, 404);
  }

  const op = request.nextUrl.searchParams.get('op') ?? 'health';

  try {
    const service = getResumableService();

    if (op === 'health') {
      return json({
        environment: process.env.VERCEL_ENV,
        persistence: service.persistence.kind,
        databaseConfigured: Boolean(process.env.TERMPROOF_DATABASE_URL?.trim()),
        geminiConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()),
        deepseekConfigured: Boolean(process.env.DEEPSEEK_API_KEY?.trim()),
      });
    }

    if (op === 'get') {
      const caseId = request.nextUrl.searchParams.get('caseId');
      if (!caseId) return json({ error: 'caseId required' }, 400);
      const snapshot = await service.get(caseId);
      return json({ caseId: snapshot.caseId, verdict: snapshot.verdict, snapshot });
    }

    if (op === 'start') {
      const milestone = request.nextUrl.searchParams.get('milestone');
      const githubRepository = request.nextUrl.searchParams.get('githubRepository');
      const requestId = request.nextUrl.searchParams.get('requestId') ?? `preview-parity-${Date.now()}`;
      if (!milestone || !githubRepository) return json({ error: 'milestone and githubRepository required' }, 400);
      const snapshot = await service.start({ milestone, githubRepository }, { requestId });
      return json({ requestId, caseId: snapshot.caseId, verdict: snapshot.verdict, snapshot });
    }

    if (op === 'resume') {
      const caseId = request.nextUrl.searchParams.get('caseId');
      const claimId = request.nextUrl.searchParams.get('claimId');
      const stepId = request.nextUrl.searchParams.get('stepId');
      const url = request.nextUrl.searchParams.get('url');
      const key = request.nextUrl.searchParams.get('key') ?? `preview-parity-resume-${Date.now()}`;
      if (!caseId || !claimId || !stepId || !url) return json({ error: 'caseId, claimId, stepId and url required' }, 400);
      const snapshot = await service.supplyEvidence(
        caseId,
        { kind: 'http_source', claimId, stepId, url },
        { requestId: key, idempotencyKey: key },
      );
      return json({ key, caseId: snapshot.caseId, verdict: snapshot.verdict, snapshot });
    }

    if (op === 'rate') {
      const scope = request.nextUrl.searchParams.get('scope') ?? `preview-parity-rate-${Date.now()}`;
      const max = Number(request.nextUrl.searchParams.get('max') ?? 2);
      const windowMs = Number(request.nextUrl.searchParams.get('windowMs') ?? 60000);
      const decision = await service.persistence.consumeRateLimit(scope, max, windowMs);
      return json({ scope, ...decision });
    }

    return json({ error: 'unsupported op' }, 400);
  } catch (error) {
    if (error instanceof PersistenceError) {
      return json({ error: error.message, code: error.code }, error.code === 'CASE_NOT_FOUND' ? 404 : 503);
    }
    return json({ error: error instanceof Error ? error.message : 'Unknown error' }, 500);
  }
}
