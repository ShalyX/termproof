export const mandateRepository = 'https://github.com/ShalyX/mandate-closeout-agent';
export const mandateHealthUrl = 'https://mandate-closeout.vercel.app/api/health';
export const mandateMilestone = 'Mandate has a public implementation repository containing contracts/MandateVault.sol, contracts/MandateFactory.sol, src/agent/planner.mjs, and api/health.mjs. Its production health endpoint at https://mandate-closeout.vercel.app/api/health returns HTTP 200 with valid JSON where ok equals true and service equals mandate.';
export const mandateContradictionMilestone = mandateMilestone.replace('service equals mandate.', 'service equals mandate-agent.');
