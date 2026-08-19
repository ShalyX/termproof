import type { ResumableVerificationService } from './resumable.ts';
import { createProductionResumableVerificationService } from './factory.ts';

let service: ResumableVerificationService | null = null;

export function getResumableService(): ResumableVerificationService {
  if (!service) service = createProductionResumableVerificationService();
  return service;
}

export async function resetResumableStoreForTests(): Promise<void> {
  await service?.persistence.close?.();
  service = null;
}
