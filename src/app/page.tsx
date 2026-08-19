'use client';

import { FormEvent, useState, type CSSProperties } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import type { AcceptanceTermDisposition, ClaimResult, StepResult, VerificationRun } from '@/core/types';

const adapters = [
  { id: 'github', code: 'GH', label: 'GitHub', source: 'repository' },
  { id: 'http', code: '↔', label: 'HTTP', source: 'endpoint' },
  { id: 'base', code: '0x', label: 'EVM', source: 'chain state' },
  { id: 'npm', code: 'pkg', label: 'npm', source: 'registry' },
] as const;

function ConditionCutMachine() {
  return (
    <figure
      className="conditionMachine"
      data-machine-state="idle"
      aria-label="A condition enters unresolved, branches to GitHub, HTTP, EVM, and npm checks, returns evidence, and resolves through deterministic policy."
    >
      <figcaption>
        <span>CONDITION CUT / VERIFICATION TOPOLOGY</span>
        <span>BOUNDED LIVE SOURCES</span>
      </figcaption>

      <div className="machineCanvas" aria-hidden="true">
        <svg className="machineWiring" viewBox="0 0 760 420" preserveAspectRatio="none">
          <path className="wire wirePromise" pathLength="1" d="M24 210H151" />
          <path className="wire wireBranch" pathLength="1" d="M217 210H270V61H341" />
          <path className="wire wireBranch" pathLength="1" d="M270 210V160H341" />
          <path className="wire wireBranch" pathLength="1" d="M270 210V260H341" />
          <path className="wire wireBranch" pathLength="1" d="M270 210V359H341" />
          <path className="wire wireReturn" pathLength="1" d="M487 61H542V210H603" />
          <path className="wire wireReturn" pathLength="1" d="M487 160H542" />
          <path className="wire wireReturn" pathLength="1" d="M487 260H542" />
          <path className="wire wireReturn" pathLength="1" d="M487 359H542V210" />
          <path className="wire wireVerdict" pathLength="1" d="M649 210H736" />
          <circle className="junction" cx="270" cy="210" r="5" />
          <circle className="junction returnJunction" cx="542" cy="210" r="5" />
        </svg>

        <div className="machinePromiseNode">
          <span>PROMISE</span>
          <strong>UNRESOLVED</strong>
        </div>

        <div className="conditionGate">
          <svg viewBox="0 0 84 84">
            <path d="M23.5 64.5A31 31 0 1 1 23.5 19.5" />
            <path className="gateCut" d="m21 21-8 8 6 6 8-8Z" />
            <circle cx="42" cy="42" r="6" />
          </svg>
          <span>DECOMPOSE</span>
        </div>

        <div className="adapterStack">
          {adapters.map((adapter) => (
            <div className="adapterModule" data-adapter={adapter.id} key={adapter.id}>
              <span className="adapterGlyph">{adapter.code}</span>
              <span className="adapterName">{adapter.label}</span>
              <span className="adapterSource">{adapter.source}</span>
              <i />
            </div>
          ))}
        </div>

        <div className="evidenceReturn">
          <span className="evidenceToken tokenOne">E1</span>
          <span className="evidenceToken tokenTwo">E2</span>
          <span className="evidenceToken tokenThree">E3</span>
          <span className="evidenceToken tokenFour">E4</span>
          <small>ATTRIBUTABLE<br />EVIDENCE</small>
        </div>

        <div className="policyGate">
          <span>POLICY</span>
          <svg viewBox="0 0 74 74">
            <circle cx="37" cy="37" r="27" />
            <circle className="policyCore" cx="37" cy="37" r="8" />
          </svg>
          <strong>VERDICT</strong>
        </div>
      </div>

      <ol className="machineLegend">
        <li><span>01</span><strong>Condition enters unresolved</strong></li>
        <li><span>02</span><strong>Four bounded routes</strong></li>
        <li><span>03</span><strong>Evidence returns</strong></li>
        <li><span>04</span><strong>Policy resolves</strong></li>
      </ol>
    </figure>
  );
}

function humanize(value: string): string {
  return value.replaceAll('_', ' ');
}

function toneFor(result: StepResult | ClaimResult | VerificationRun['verdict']): string {
  if (result === 'PASS' || result === 'VERIFIED') return 'is-pass';
  if (result === 'FAIL' || result === 'FAILED') return 'is-fail';
  if (result === 'INCONCLUSIVE' || result === 'NEEDS_EVIDENCE') return 'is-needs';
  if (result === 'PARTIALLY_VERIFIED') return 'is-partial';
  return 'is-neutral';
}

function toneForCoverage(disposition: AcceptanceTermDisposition): string {
  if (disposition === 'PLANNED') return 'is-pass';
  if (disposition === 'NEEDS_EVIDENCE') return 'is-needs';
  if (disposition === 'UNSUPPORTED') return 'is-fail';
  return 'is-neutral';
}

function verdictPresentation(verdict: VerificationRun['verdict']) {
  switch (verdict) {
    case 'VERIFIED':
      return {
        signal: 'CONDITION RESOLVED',
        action: 'VERIFIED TERMS',
        summary: 'Every required objective claim passed its bounded deterministic check.',
      };
    case 'FAILED':
      return {
        signal: 'CONTRADICTION FOUND',
        action: 'HOLD RELEASE',
        summary: 'At least one required claim contradicts the evidence returned by its source.',
      };
    case 'NEEDS_EVIDENCE':
      return {
        signal: 'EVIDENCE REQUIRED',
        action: 'HOLD — REQUEST EVIDENCE',
        summary: 'A required claim could not be resolved from available infrastructure or supplied evidence.',
      };
    case 'PARTIALLY_VERIFIED':
      return {
        signal: 'PARTIAL VERIFICATION',
        action: 'HOLD — REVIEW UNRESOLVED TERMS',
        summary: 'Some objective terms resolved, while other criteria remain outside deterministic verification.',
      };
  }
}

function adapterDescriptor(adapter: VerificationRun['claims'][number]['steps'][number]['adapter']) {
  return adapters.find((item) => item.id === adapter) ?? { id: adapter, code: '•', label: adapter, source: 'bounded source' };
}

function VerdictGlyph({ verdict }: { verdict: VerificationRun['verdict'] }) {
  return (
    <svg className="verdictGlyph" data-verdict={verdict} viewBox="0 0 180 180" aria-hidden="true">
      <circle className="verdictOrbit" cx="90" cy="90" r="58" />
      <path className="verdictCut" d="M49 49 29 69l16 16 20-20Z" />
      <circle className="verdictCore" cx="90" cy="90" r="17" />
      <path className="contradictionBar" d="M38 90h104" />
      <rect className="missingFragment" x="128" y="38" width="22" height="22" />
      <path className="partialArc" d="M90 32a58 58 0 0 1 58 58" />
    </svg>
  );
}

function formatObservedAt(value: string): string {
  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone: 'UTC',
  }).format(new Date(value));
}

export default function Home() {
  const [milestone, setMilestone] = useState('Mandate has a public implementation repository containing contracts/MandateVault.sol, contracts/MandateFactory.sol, src/agent/planner.mjs, and api/health.mjs. Its production health endpoint at https://mandate-closeout.vercel.app/api/health returns HTTP 200 with valid JSON where ok equals true and service equals mandate.');
  const [githubRepository, setGithubRepository] = useState('https://github.com/ShalyX/mandate-closeout-agent');
  const [run, setRun] = useState<VerificationRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const verdictCopy = run ? verdictPresentation(run.verdict) : null;
  const contradictions = run?.claims.filter((claim) => claim.result === 'FAIL') ?? [];
  const coverage = run?.coverage ?? run?.provenance.coverage ?? [];
  const coveredTerms = coverage.filter((term) => term.required && term.disposition === 'PLANNED').length;
  const evidenceGaps = coverage.filter((term) => term.required && term.disposition === 'NEEDS_EVIDENCE').length;
  const unsupportedTerms = coverage.filter((term) => term.required && term.disposition === 'UNSUPPORTED').length;
  const humanReviewTerms = coverage.filter((term) => term.required && term.disposition === 'NOT_OBJECTIVELY_TESTABLE').length;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setRun(null);

    try {
      const response = await fetch('/api/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ milestone, githubRepository }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Verification failed');
      setRun(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Verification failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="shell">
      <header className="siteHeader">
        <Link className="brand" href="/" aria-label="Termproof home">
          <Image src="/brand/termproof-lockup.svg" alt="Termproof — Terms, tested." width={556} height={96} priority />
        </Link>
        <div className="headerStatus">
          <span><i /> POLICY BOUND</span>
          <p>Proof before release.</p>
        </div>
      </header>

      <section className="hero" aria-labelledby="hero-title">
        <div className="heroCopy">
          <p className="eyebrow">PROOF BEFORE RELEASE.</p>
          <h1 id="hero-title">A promise is not proof.</h1>
          <p className="lede">
            Termproof turns objective milestone terms into bounded tests, attributable evidence, and a policy-computed verdict.
          </p>
          <div className="heroActionRow">
            <a className="primaryAction" href="#verify">Test the terms <span aria-hidden="true">↓</span></a>
            <p><strong>Terms, tested.</strong><span>The model plans. Policy decides.</span></p>
          </div>
          <dl className="trustBoundary" aria-label="Verification trust boundary">
            <div><dt>MODEL</dt><dd>proposes checks</dd></div>
            <div><dt>ADAPTERS</dt><dd>observe sources</dd></div>
            <div><dt>POLICY</dt><dd>sets verdicts</dd></div>
          </dl>
        </div>
        <ConditionCutMachine />
      </section>

      <section className="workbench" id="verify" aria-labelledby="promise-title">
        <header className="workbenchHeader">
          <p className="sectionKicker"><span>01</span> PROMISE</p>
          <h2 id="promise-title">Feed the condition.</h2>
          <p>State objective acceptance criteria. Termproof will decompose the promise and route only supported checks.</p>
          <div className="sourceRack" aria-label="Supported bounded verification routes">
            {adapters.map((adapter) => (
              <span data-adapter={adapter.id} key={adapter.id}><i>{adapter.code}</i>{adapter.label}</span>
            ))}
          </div>
        </header>

        <div className="promiseComposer">
          <aside className="composerRail" aria-hidden="true">
            <span>INPUT 01</span>
            <i />
            <strong>PROMISE</strong>
            <small>UNRESOLVED</small>
          </aside>

          <form className="verificationForm" onSubmit={submit}>
            <header className="composerHeader">
              <div>
                <span>INPUT CHANNEL</span>
                <strong>INPUT READY</strong>
              </div>
              <p>Enter objective criteria and public evidence anchors. Termproof will route only supported checks.</p>
            </header>

            <div className="composerFields">
              <div className="fieldGroup conditionField intakeModule is-primary">
                <label htmlFor="milestone">
                  <span><b>01</b> Milestone / acceptance criteria</span>
                  <small id="milestone-help">State the promised result and public evidence sources precisely.</small>
                </label>
                <textarea
                  id="milestone"
                  aria-describedby="milestone-help"
                  value={milestone}
                  onChange={(event) => setMilestone(event.target.value)}
                  rows={7}
                  required
                />
              </div>

              <div className="fieldGroup anchorField intakeModule is-secondary">
                <label htmlFor="repository">
                  <span><b>02</b> Public GitHub anchor</span>
                  <small id="repository-help">Canonical github.com URL. Lookalike hosts are rejected.</small>
                </label>
                <input
                  id="repository"
                  type="url"
                  inputMode="url"
                  autoComplete="url"
                  aria-describedby="repository-help"
                  value={githubRepository}
                  onChange={(event) => setGithubRepository(event.target.value)}
                  required
                />
              </div>
            </div>

            <div className="formFooter">
              <button type="submit" disabled={loading} aria-busy={loading}>
                {loading ? 'Testing terms…' : 'Run verification'}
                <span aria-hidden="true">→</span>
              </button>
              <p>
                <strong>TRUST BOUNDARY</strong>
                The planner proposes supported checks. Only adapters and deterministic policy can produce results.
              </p>
            </div>
          </form>
        </div>
      </section>

      {loading && (
        <section className="loadingMachine" role="status" aria-live="polite" aria-label="Verification in progress">
          <header>
            <div><i /><span>RUN ACTIVE</span></div>
            <strong>Testing terms against bounded sources</strong>
            <p><span className="loadingCoverageLabel">ACCEPTANCE COVERAGE</span> Every substantive term is normalized before planning. No verdict exists until deterministic policy evaluates the returned evidence.</p>
          </header>
          <div className="loadingRail" aria-hidden="true">
            <div className="loadingStage is-active"><span>01</span><strong>PROMISE</strong><small>accepted</small></div>
            <i />
            <div className="loadingStage is-routing"><span>02</span><strong>TEST</strong><small>routing</small></div>
            <i />
            <div className="loadingStage is-gathering"><span>03</span><strong>EVIDENCE</strong><small>gathering</small></div>
            <i />
            <div className="loadingStage is-waiting"><span>04</span><strong>VERDICT</strong><small>withheld</small></div>
          </div>
        </section>
      )}

      {error && (
        <section className="errorState" role="alert">
          <div className="errorGlyph" aria-hidden="true"><span /><i /></div>
          <div>
            <p className="sectionKicker"><span>!</span> NO VERDICT ISSUED</p>
            <h2>The verification machine stopped safely.</h2>
            <p>{error}</p>
            <small>No result was fabricated. Retry when the required infrastructure is available.</small>
          </div>
        </section>
      )}

      {run && verdictCopy && (
        <section className={`results ${toneFor(run.verdict)}`} data-verdict={run.verdict} aria-live="polite" aria-label="Verification result">
          <header className="resultConsoleHeader">
            <div>
              <p className="eyebrow"><i /> RUN COMPLETE</p>
              <h2>From promise to proof.</h2>
              <p>The model selected bounded operations. Adapters observed sources. Policy resolved the recorded results.</p>
            </div>
            <details className="runIdentity">
              <summary>Run identity <code>{run.runId.slice(0, 12)}</code></summary>
              <dl>
                <div><dt>Run ID</dt><dd><code>{run.runId}</code></dd></div>
                <div><dt>Observed</dt><dd>{formatObservedAt(run.finishedAt)} UTC</dd></div>
                <div><dt>Run version</dt><dd><code>{run.provenance.runVersion}</code></dd></div>
              </dl>
            </details>
          </header>

          <ol className="runRail" aria-label="Completed verification stages">
            <li><span>01</span><strong>PROMISE</strong><small>submitted</small></li>
            <li><span>02</span><strong>TEST</strong><small>{run.claims.length} claims</small></li>
            <li><span>03</span><strong>EVIDENCE</strong><small>{run.evidence.length} receipts</small></li>
            <li className={toneFor(run.verdict)}><span>04</span><strong>VERDICT</strong><small>{humanize(run.verdict)}</small></li>
          </ol>

          <section className="runPromise" aria-labelledby="trace-promise-title">
            <div className="stageStamp"><span>01</span><strong>PROMISE</strong></div>
            <div>
              <p>SUBMITTED CONDITION</p>
              <blockquote id="trace-promise-title">{run.milestone}</blockquote>
            </div>
            <dl>
              <div><dt>Anchor</dt><dd><code>github.com/{run.repository.owner}/{run.repository.repo}</code></dd></div>
              <div><dt>Decomposition</dt><dd><strong>{run.claims.length}</strong> bounded claims</dd></div>
            </dl>
          </section>

          <section className="coverageSummary" aria-labelledby="coverage-title">
            <header className="machineSectionHeader">
              <div className="stageStamp"><span>01A</span><strong>COVERAGE</strong></div>
              <div>
                <p>ACCEPTANCE-TERM ACCOUNTING</p>
                <h3 id="coverage-title">{coverage.length} identified · {coveredTerms} covered</h3>
              </div>
              <span className={`coverageHeadline ${evidenceGaps > 0 || unsupportedTerms > 0 || humanReviewTerms > 0 ? 'is-needs' : 'is-pass'}`}>
                {evidenceGaps > 0 ? `${evidenceGaps} needs evidence` : unsupportedTerms > 0 ? `${unsupportedTerms} unsupported objective` : humanReviewTerms > 0 ? `${humanReviewTerms} human review` : 'COMPLETE'}
              </span>
            </header>
            <div className="coverageStats" aria-label="Acceptance coverage summary">
              <div><strong>{coverage.length}</strong><span>identified</span></div>
              <div className="is-pass"><strong>{coveredTerms}</strong><span>executable / covered</span></div>
              <div className={evidenceGaps > 0 ? 'is-needs' : ''}><strong>{evidenceGaps}</strong><span>needs evidence</span></div>
              <div className={unsupportedTerms > 0 ? 'is-fail' : ''}><strong>{unsupportedTerms}</strong><span>unsupported objective</span></div>
              <div className={humanReviewTerms > 0 ? 'is-neutral' : ''}><strong>{humanReviewTerms}</strong><span>human review</span></div>
            </div>
            <details className="coverageDetails">
              <summary>Term coverage map <code>{coverage.length} terms</code></summary>
              <ol>
                {coverage.map((term) => (
                  <li key={term.id}>
                    <span className={`status compact ${toneForCoverage(term.disposition)}`}>{term.disposition.replaceAll('_', ' ')}</span>
                    <div>
                      <strong>{term.text}</strong>
                      <small>{term.claimIds.length > 0 ? `${term.claimIds.length} claim${term.claimIds.length === 1 ? '' : 's'} · ${term.stepIds.length} verifier step${term.stepIds.length === 1 ? '' : 's'} · ${term.stepIds.join(', ')}` : term.reason ?? 'No executable route recorded.'}</small>
                      <small className="coverageProofLine">{term.proofObligation.kind} · {term.selectedCapability ?? 'capability not selected'} · {term.evidenceEstablished.length} evidence receipt{term.evidenceEstablished.length === 1 ? '' : 's'}</small>
                      <code>{term.id}</code>
                    </div>
                  </li>
                ))}
              </ol>
            </details>
          </section>

          <section className="claimMachineSection" aria-labelledby="trace-test-title">
            <header className="machineSectionHeader">
              <div className="stageStamp"><span>02</span><strong>TEST</strong></div>
              <div>
                <p>BOUNDED VERIFICATION PLAN</p>
                <h3 id="trace-test-title">The promise decomposes into testable claims.</h3>
              </div>
              <code title={run.provenance.planner.planHash}>PLAN {run.provenance.planner.planHash.slice(0, 12)}</code>
            </header>

            <div className="claimMachineHead" aria-hidden="true">
              <span>CLAIM / CONDITION</span>
              <span>BOUNDED TEST ROUTE</span>
              <span>PROOF RECEIPTS</span>
              <span>RESULT</span>
            </div>

            <ol className="claimMachine">
              {run.claims.map((claim, claimIndex) => (
                <li
                  className={`claimMachineRow ${toneFor(claim.result)}`}
                  data-result={claim.result}
                  key={claim.id}
                  style={{ '--claim-index': claimIndex } as CSSProperties}
                >
                  <div className="claimStatement">
                    <div>
                      <span>CLAIM {String(claimIndex + 1).padStart(2, '0')}</span>
                      <span>{claim.required ? 'REQUIRED' : 'OPTIONAL'}</span>
                    </div>
                    <h4>{claim.statement}</h4>
                    <code>{claim.id} / {claim.testability}</code>
                    {claim.result === 'FAIL' && <strong className="contradictionFlag">CONTRADICTION</strong>}
                    {claim.result === 'INCONCLUSIVE' && <strong className="unresolvedFlag">EVIDENCE GAP</strong>}
                  </div>

                  <div className="claimRoutes">
                    {claim.steps.length === 0 && (
                      <div className="routeModule is-neutral">
                        <span className="adapterGlyph">—</span>
                        <div><strong>Human criterion</strong><small>No bounded operation selected</small></div>
                        <span className="status compact is-neutral">NOT TESTABLE</span>
                      </div>
                    )}
                    {claim.steps.map((step) => {
                      const adapter = adapterDescriptor(step.adapter);
                      return (
                        <article className={`routeModule ${toneFor(step.result)}`} data-adapter={step.adapter} key={step.id}>
                          <span className="adapterGlyph">{adapter.code}</span>
                          <div>
                            <strong>{adapter.label} <code>{step.operation}</code></strong>
                            <small>{step.message}</small>
                          </div>
                          <span className={`status compact ${toneFor(step.result)}`}>{step.result}</span>
                        </article>
                      );
                    })}
                  </div>

                  <div className="claimEvidenceTokens">
                    {claim.steps.flatMap((step) => step.evidenceIds).map((evidenceId) => (
                      <a href={`#evidence-${evidenceId}`} key={evidenceId} title={evidenceId}>
                        <span>E</span><code>{evidenceId.slice(-8)}</code>
                      </a>
                    ))}
                    {claim.steps.flatMap((step) => step.evidenceIds).length === 0 && <span className="missingToken">NO RECEIPT</span>}
                  </div>

                  <div className="claimResolution">
                    <i aria-hidden="true" />
                    <strong>{humanize(claim.result)}</strong>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section className="evidenceLedger" aria-labelledby="trace-evidence-title">
            <header className="machineSectionHeader">
              <div className="stageStamp"><span>03</span><strong>EVIDENCE</strong></div>
              <div>
                <p>IMMUTABLE PROOF RECEIPTS</p>
                <h3 id="trace-evidence-title">Inspect the proof at the depth you need.</h3>
              </div>
              <span className="ledgerCount">{run.evidence.length} RECORD{run.evidence.length === 1 ? '' : 'S'}</span>
            </header>

            <details className="provenanceDrawer">
              <summary>
                <div>
                  <span>RUN PROVENANCE</span>
                  <strong>Verifier, policy, planner, model, plan and run versions</strong>
                </div>
                <code>{run.provenance.planner.planHash.slice(0, 16)}</code>
              </summary>
              <dl className="provenanceSummary">
                <div><dt>Verifier</dt><dd><code>{run.provenance.verifier.name}@{run.provenance.verifier.version}</code></dd></div>
                <div><dt>Policy</dt><dd><code>{run.provenance.policy.name}@{run.provenance.policy.version}</code></dd></div>
                <div><dt>Planner / model</dt><dd data-planner-kind={run.provenance.planner.kind}>{run.provenance.planner.provider ?? run.provenance.planner.kind}<code>{run.provenance.planner.model ?? 'not reported'}</code></dd></div>
                <div><dt>Planner role</dt><dd>{run.provenance.planner.role ?? 'not reported'}{run.provenance.planner.failoverReason ? <code>{run.provenance.planner.failoverReason}</code> : null}</dd></div>
                <div><dt>Planner time / version</dt><dd><code>{run.provenance.planner.timestamp ?? 'not reported'}</code><code>{run.provenance.planner.version ?? 'not reported'}</code></dd></div>
                <div><dt>Run / plan</dt><dd><code>{run.provenance.runVersion}</code><code>{run.provenance.planner.planHash}</code></dd></div>
              </dl>
            </details>

            {run.missingEvidence.length > 0 && (
              <aside className="evidenceRequest">
                <span>EVIDENCE REQUEST</span>
                <strong>Required proof is still missing.</strong>
                <ul>{run.missingEvidence.map((request) => <li key={request}>{request}</li>)}</ul>
              </aside>
            )}

            <div className="evidenceReceiptList">
              {run.evidence.map((record, evidenceIndex) => {
                const adapter = adapterDescriptor(record.adapter);
                return (
                  <details className="evidenceRecord" id={`evidence-${record.id}`} key={record.id}>
                    <summary>
                      <span className="receiptIndex">{String(evidenceIndex + 1).padStart(2, '0')}</span>
                      <span className="adapterGlyph">{adapter.code}</span>
                      <div>
                        <span>Evidence receipt / {adapter.label}</span>
                        <strong>{record.source}</strong>
                        <code>HASH {record.rawHash.slice(0, 16)}</code>
                      </div>
                      <span className={`status compact ${toneFor(record.result)}`}>{record.result}</span>
                    </summary>

                    <div className="evidenceRecordBody">
                      <section className="facts">
                        <h4>Extracted facts</h4>
                        <p>Deterministic fields used by policy.</p>
                        <pre>{JSON.stringify(record.extractedFacts, null, 2)}</pre>
                      </section>

                      <section className="receiptMetadata">
                        <h4>Evidence receipt</h4>
                        <dl className="evidenceFields">
                          <div><dt>Evidence ID</dt><dd><code>{record.id}</code></dd></div>
                          <div><dt>Claim / step</dt><dd><code>{record.claimId} / {record.stepId}</code></dd></div>
                          <div><dt>Source</dt><dd><code>{record.source}</code></dd></div>
                          <div><dt>Revision</dt><dd><code>{record.revision ?? 'point-in-time'}</code></dd></div>
                          <div><dt>Observed</dt><dd>{formatObservedAt(record.observedAt)} UTC</dd></div>
                          {record.observationId && <div><dt>Observation lineage</dt><dd><code>{record.observationId}</code><code>{record.requestFingerprint ?? 'request fingerprint unavailable'}</code><code>{record.observationRawHash ?? 'response hash unavailable'}</code></dd></div>}
                          <div><dt>Evidence hash</dt><dd><code>{record.rawHash}</code></dd></div>
                        </dl>
                      </section>

                      <details className="rawObservation">
                        <summary>Full provenance and bounded source observation</summary>
                        <div>
                          <section><h4>Full provenance</h4><pre>{JSON.stringify(record.provenance ?? run.provenance, null, 2)}</pre></section>
                          <section><h4>Raw observation</h4><pre>{JSON.stringify(record.raw, null, 2)}</pre></section>
                        </div>
                      </details>
                    </div>
                  </details>
                );
              })}
            </div>
          </section>

          <section className={`verdictMoment ${toneFor(run.verdict)}`} aria-labelledby="verdict-title">
            <div className="verdictGraphic">
              <VerdictGlyph verdict={run.verdict} />
              <span>04 / VERDICT</span>
            </div>
            <div className="verdictCopy">
              <p>{verdictCopy.signal}</p>
              <h3 id="verdict-title">{humanize(run.verdict)}</h3>
              <strong>{verdictCopy.action}</strong>
              <p>{verdictCopy.summary}</p>

              {contradictions.length > 0 && (
                <div className="contradictionSummary">
                  <span>CONTRADICTION</span>
                  <ul>{contradictions.map((claim) => <li key={claim.id}>{claim.statement}</li>)}</ul>
                </div>
              )}

              {run.verdict === 'NEEDS_EVIDENCE' && run.missingEvidence.length > 0 && (
                <div className="contradictionSummary">
                  <span>REQUESTED PROOF</span>
                  <ul>{run.missingEvidence.map((request) => <li key={request}>{request}</li>)}</ul>
                </div>
              )}
            </div>
            <aside className="policyStamp">
              <span>DETERMINISTIC POLICY</span>
              <code>{run.provenance.policy.name}@{run.provenance.policy.version}</code>
              <p>Computed from recorded claim results. The model cannot assign this verdict.</p>
            </aside>
          </section>
        </section>
      )}

      <footer className="siteFooter">
        <Image src="/brand/condition-cut-inverse.svg" alt="" width={202} height={64} />
        <div>
          <strong>Termproof</strong>
          <p>Terms, tested.</p>
        </div>
        <p>Recommends milestone disposition. Does not release funds or execute third-party code.</p>
      </footer>
    </main>
  );
}
