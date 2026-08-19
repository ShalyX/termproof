import { ProviderPlanner } from '../agent/provider-planner.ts';
import type { MilestonePlanner } from '../agent/planner.ts';
import { BaseAdapter } from '../adapters/base.ts';
import { GitHubAdapter } from '../adapters/github.ts';
import { HttpAdapter } from '../adapters/http.ts';
import { NpmAdapter } from '../adapters/npm.ts';
import { VerificationOrchestrator } from './orchestrator.ts';
import { ResumableVerificationService } from './resumable.ts';
import type { PersistenceAdapter } from './persistence.ts';
import { PostgresPersistenceAdapter } from './postgres-persistence.ts';

export function createProductionPlanner(): MilestonePlanner {
  return new ProviderPlanner();
}

export function createOrchestrator(): VerificationOrchestrator {
  const planner = createProductionPlanner();
  return new VerificationOrchestrator({ planner, github: new GitHubAdapter(), http: new HttpAdapter(), base: new BaseAdapter(), npm: new NpmAdapter() });
}

export function createResumableVerificationService(persistence?: PersistenceAdapter): ResumableVerificationService {
  const planner = createProductionPlanner();
  return new ResumableVerificationService({ planner, github: new GitHubAdapter(), http: new HttpAdapter(), base: new BaseAdapter(), npm: new NpmAdapter(), persistence });
}

export function createProductionResumableVerificationService(): ResumableVerificationService {
  return createResumableVerificationService(PostgresPersistenceAdapter.fromEnvironment());
}
