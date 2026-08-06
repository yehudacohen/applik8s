import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { Automation, AutomationMine, AutomationRunRecent } from '../application';
import { ChirpShell, PageIntro } from '../components/chirp-shell';
import { QueryState } from '../components/post-list';

const mine = AutomationMine({ limit: 25 });
const recentRuns = AutomationRunRecent({ limit: 25 });
export const Route = createFileRoute('/automation')({ loader: () => Promise.all([mine.snapshot(), recentRuns.snapshot()]), component: AutomationSettings });

function AutomationSettings() {
  const automations = mine.useQuery();
  const runs = recentRuns.useQuery();
  const create = Automation.create.useMutation();
  const update = Automation.update.useMutation();
  const [creatingNew, setCreatingNew] = useState(false);
  const existing = creatingNew ? undefined : automations.data?.[0];
  const [persona, setPersona] = useState(existing?.persona ?? 'A disclosed operations account that posts concise site health updates.');
  const [schedule, setSchedule] = useState(existing?.schedule ?? '0 */6 * * *');
  const [maxPostsPerDay, setMaxPostsPerDay] = useState(existing?.maxPostsPerDay ?? '4');
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
        maxPostsPerDay,
        maxUnitsPerDay: existing?.maxUnitsPerDay ?? '2000',
      };
      if (existing) {
        await update({ identity: existing.id, patch: { ...values, state: 'active' } });
      } else {
        await create({ id: crypto.randomUUID(), accountId: 'chirp-ops', ...values });
        setCreatingNew(false);
      }
    }}><label>Persona<textarea value={persona} maxLength={160} onChange={(event) => setPersona(event.target.value)} /></label><label>Five-field schedule<input value={schedule} onChange={(event) => setSchedule(event.target.value)} /></label><label>Daily post limit<input type="number" min="1" max="24" step="1" value={maxPostsPerDay} onChange={(event) => setMaxPostsPerDay(event.target.value)} /></label><div className="formEvidence"><span>Daily posts ≤ {maxPostsPerDay || '24'}</span><span>Generation units ≤ 2,000</span><span>Profile: deterministic-safe</span></div><button className="primary" disabled={pending}>{pending ? 'Saving…' : existing ? 'Save automation' : 'Configure automation'}</button>{existing ? <button type="button" disabled={pending} onClick={() => {
      setCreatingNew(true);
      setPersona('A disclosed operations account that posts concise site health updates.');
      setSchedule('0 */6 * * *');
      setMaxPostsPerDay('4');
    }}>Create another automation</button> : null}{error ? <p role="alert">{error.message}</p> : null}</form>
    <QueryState phase={automations.phase} error={automations.error} empty={(automations.data?.length ?? 0) === 0} />
    <section className="cardList">{(automations.data ?? []).map((automation) => <article key={automation.id} data-automation-id={automation.id}><div><p className="eyebrow">{automation.state}</p><b>{automation.persona}</b><p>{automation.schedule} · {automation.generationProfile}</p></div>{automation.state === 'active' ? <button disabled={update.pending} onClick={() => update({ identity: automation.id, patch: { state: 'suspended' } })}>Emergency stop</button> : <span>Suspended</span>}</article>)}</section>
    <h2 className="sectionTitle">Recent runs</h2>
    <QueryState phase={runs.phase} error={runs.error} empty={(runs.data?.length ?? 0) === 0} />
    <section className="cardList">{(runs.data ?? []).map((run) => <article key={run.id} data-run-id={run.id}><div><p className="eyebrow">{run.state}</p><b>{run.scheduledFor}</b><p>{run.usageUnits} / {run.reservedUnits} units{run.publishedPostId ? ` · post ${run.publishedPostId}` : ''}</p><small>{run.resultReference ?? 'No result reference yet'}</small></div></article>)}</section>
  </ChirpShell>;
}
