import { ApplicationQueryHydrationBoundary } from '@applik8s/react';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { AutomationControl, ModerationCase, ModerationPolicy, Post, Report } from '../application';
import { ChirpShell, PageIntro } from '../components/chirp-shell';
import { QueryState } from '../components/post-list';

const reports = Report.openQueue({ limit: 50 });
const cases = ModerationCase.queue({ limit: 50 });
const automationControl = AutomationControl.current({});
const policy = ModerationPolicy.current({});
export const Route = createFileRoute('/moderation')({ loader: () => Promise.all([reports.snapshot(), cases.snapshot(), automationControl.snapshot(), policy.snapshot()]), component: ModerationPage });

function ModerationPage() {
  const snapshots = Route.useLoaderData();
  return <ApplicationQueryHydrationBoundary snapshots={snapshots}><Moderation /></ApplicationQueryHydrationBoundary>;
}
function Moderation() {
  const reportQueue = reports.useQuery();
  const caseQueue = cases.useQuery();
  const automation = automationControl.useQuery();
  const moderationPolicy = policy.useQuery();
  const createAutomationControl = AutomationControl.create.useMutation();
  const updateAutomationControl = AutomationControl.update.useMutation();
  const open = ModerationCase.create.useMutation();
  const resolve = ModerationCase.update.useMutation();
  const moderate = Post.update.useMutation();
  const [stopReason, setStopReason] = useState('Administrator emergency stop');
  const currentControl = automation.data;
  const setAutomationEnabled = async (enabled: boolean) => {
    const patch = { enabled: enabled ? 'true' : 'false', reason: enabled ? '' : stopReason };
    if (currentControl?.configured) await updateAutomationControl({ identity: 'global', patch });
    else await createAutomationControl({ id: 'global', ...patch });
  };
  return <ChirpShell title="Moderation">
    <PageIntro eyebrow="Administrator evidence" title="Moderation queue">Reports and cases are durable relational records. The Kubernetes moderation policy is low-cardinality operational desired state.</PageIntro>
    <section className="panelForm" aria-labelledby="moderation-policy-heading"><p className="eyebrow">Kubernetes authority</p><h2 id="moderation-policy-heading">Moderation policy</h2><QueryState phase={moderationPolicy.phase} error={moderationPolicy.error} empty={(moderationPolicy.data?.length ?? 0) === 0} />{moderationPolicy.data?.map((current) => <p key={current.name}><b>{current.phase}</b> · maximum risk {current.maxRisk} · {current.blockedTerms.length} blocked terms. {current.message}</p>)}</section>
    <section className="panelForm" aria-labelledby="automation-safety-heading"><p className="eyebrow">Global safety boundary</p><h2 id="automation-safety-heading">Automated publication</h2><QueryState phase={automation.phase} error={automation.error} empty={false} /><p>{currentControl?.enabled === false ? `Stopped: ${currentControl.reason}` : 'Enabled. Every run still passes quotas, moderation, and ordinary Post.create authorization.'}</p><label>Stop reason<input value={stopReason} onChange={(event) => setStopReason(event.target.value)} /></label><div className="buttonRow">{currentControl?.enabled === false ? <button className="primary" disabled={createAutomationControl.pending || updateAutomationControl.pending} onClick={() => setAutomationEnabled(true)}>Resume automation</button> : <button disabled={createAutomationControl.pending || updateAutomationControl.pending || !stopReason.trim()} onClick={() => setAutomationEnabled(false)}>Stop all automation</button>}</div></section>
    <h2 className="sectionTitle">Open reports</h2><QueryState phase={reportQueue.phase} error={reportQueue.error} empty={(reportQueue.data?.length ?? 0) === 0} />
    <section className="cardList">{(reportQueue.data ?? []).map((report) => <article key={report.id}><div><b>{report.reason}</b><p>{report.detail}</p><small>reported by {report.reporterId}</small></div><button disabled={open.pending} onClick={() => open({ id: `case:${report.id}`, reportId: report.id, targetType: report.postId ? 'post' : 'account', targetId: report.postId ?? report.accountId ?? '' })}>Open case</button></article>)}</section>
    <h2 className="sectionTitle">Active cases</h2><QueryState phase={caseQueue.phase} error={caseQueue.error} empty={(caseQueue.data?.length ?? 0) === 0} />
    <section className="cardList">{(caseQueue.data ?? []).map((moderationCase) => <article key={moderationCase.id}><div><b>{moderationCase.targetType} · {moderationCase.targetId}</b><p>Case {moderationCase.id}</p></div><div className="buttonRow">{moderationCase.targetType === 'post' ? <button disabled={moderate.pending} onClick={() => moderate({ identity: moderationCase.targetId, patch: { moderationState: 'removed', moderationReason: `Resolved by ${moderationCase.id}` } })}>Remove post</button> : null}<button disabled={resolve.pending} onClick={() => resolve({ identity: moderationCase.id, patch: { state: 'resolved', resolution: 'Reviewed and actioned in Chirp moderation.' } })}>Resolve</button></div></article>)}</section>
  </ChirpShell>;
}
