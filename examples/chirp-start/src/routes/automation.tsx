import { ApplicationQueryHydrationBoundary } from '@applik8s/react';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { Automation, AutomationRun } from '../application';
import { ChirpShell, PageIntro } from '../components/chirp-shell';
import { QueryState } from '../components/post-list';

const mine = Automation.mine({ limit: 25 });
const recentRuns = AutomationRun.recent({ limit: 25 });
export const Route = createFileRoute('/automation')({ loader: () => Promise.all([mine.snapshot(), recentRuns.snapshot()]), component: AutomationPage });

function AutomationPage() {
  const snapshots = Route.useLoaderData();
  return <ApplicationQueryHydrationBoundary snapshots={snapshots}><AutomationSettings /></ApplicationQueryHydrationBoundary>;
}

function AutomationSettings() {
  const automations = mine.useQuery();
  const runs = recentRuns.useQuery();
  const create = Automation.create.useMutation();
  const update = Automation.update.useMutation();
  const existing = automations.data?.[0];
  const [persona, setPersona] = useState(existing?.persona ?? 'A disclosed operations account that posts concise site health updates.');
  const [schedule, setSchedule] = useState(existing?.schedule ?? '0 */6 * * *');
  const pending = create.pending || update.pending;
  const error = create.error ?? update.error;
  return <ChirpShell title="Automation" rail={<div className="inspector"><p className="eyebrow">Safety boundary</p><h2>Same mutations, same policy</h2><p>Automated posts use <code>Post.create()</code>. Schedules and external effects belong to durable workflows, while configuration remains relational product data.</p></div>}>
    <PageIntro eyebrow="Optional product feature" title="Automated accounts">Create bounded, disclosed automation without turning high-cardinality product objects into CRDs.</PageIntro>
    <form className="panelForm" onSubmit={async (event) => {
      event.preventDefault();
      const values = {
        persona,
        instructions: existing?.instructions ?? 'Summarize current site health without links, mentions, or sensitive details.',
        schedule,
        generationProfile: existing?.generationProfile ?? 'deterministic-safe',
        maxPostsPerDay: existing?.maxPostsPerDay ?? '4',
        maxUnitsPerDay: existing?.maxUnitsPerDay ?? '2000',
      };
      if (existing) await update({ identity: existing.id, patch: { ...values, state: 'active' } });
      else await create({ id: crypto.randomUUID(), accountId: 'chirp-ops', ...values });
    }}><label>Persona<textarea value={persona} maxLength={160} onChange={(event) => setPersona(event.target.value)} /></label><label>Five-field schedule<input value={schedule} onChange={(event) => setSchedule(event.target.value)} /></label><div className="formEvidence"><span>Daily posts ≤ 4</span><span>Generation units ≤ 2,000</span><span>Profile: deterministic-safe</span></div><button className="primary" disabled={pending}>{pending ? 'Saving…' : existing ? 'Save automation' : 'Configure automation'}</button>{error ? <p role="alert">{error.message}</p> : null}</form>
    <QueryState phase={automations.phase} error={automations.error} empty={(automations.data?.length ?? 0) === 0} />
    <section className="cardList">{(automations.data ?? []).map((automation) => <article key={automation.id}><div><p className="eyebrow">{automation.state}</p><b>{automation.persona}</b><p>{automation.schedule} · {automation.generationProfile}</p></div>{automation.state === 'active' ? <button disabled={update.pending} onClick={() => update({ identity: automation.id, patch: { state: 'suspended' } })}>Emergency stop</button> : <span>Suspended</span>}</article>)}</section>
    <h2 className="sectionTitle">Recent runs</h2>
    <QueryState phase={runs.phase} error={runs.error} empty={(runs.data?.length ?? 0) === 0} />
    <section className="cardList">{(runs.data ?? []).map((run) => <article key={run.id}><div><p className="eyebrow">{run.state}</p><b>{run.scheduledFor}</b><p>{run.usageUnits} / {run.reservedUnits} units{run.publishedPostId ? ` · post ${run.publishedPostId}` : ''}</p><small>{run.resultReference ?? 'No result reference yet'}</small></div></article>)}</section>
  </ChirpShell>;
}
