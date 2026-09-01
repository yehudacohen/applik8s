import { createFileRoute } from '@tanstack/react-router';
import { HistoricalEngagement } from '../application';
import { ChirpShell, PageIntro } from '../components/chirp-shell';
import { QueryState } from '../components/post-list';

const history = HistoricalEngagement({});

export const Route = createFileRoute('/analytics')({
  loader: () => history.snapshot(),
  component: Analytics,
});

function Analytics() {
  const result = history.useQuery();
  const rows = result.data?.rows ?? [];
  return <ChirpShell title="Analytics" rail={<section className="inspector"><p className="eyebrow">Historical query receipt</p><h2>Bounded and inspectable</h2><ul><li><b>{result.data?.schemaRevision ?? '—'}</b><span>schema revision</span></li><li><b>{result.data?.scannedBytes ?? 0}</b><span>bytes scanned</span></li><li><b>{result.data?.snapshot?.slice(0, 12) ?? '—'}</b><span>pinned snapshot</span></li></ul></section>}>
    <PageIntro eyebrow="Immutable product history" title="Engagement over time">This page calls one typed query. Local development reads DuckDB, AWS reads a pinned S3/Glue snapshot through Athena, and the online product remains backed by its independently rebuildable ClickHouse projections.</PageIntro>
    <QueryState phase={result.phase} error={result.error} empty={rows.length === 0} />
    {rows.length > 0 ? <section className="panel"><div className="panelHeader"><div><p className="eyebrow">Latest published snapshot</p><h2>Reaction facts</h2></div><span>{rows.length} rows</span></div><div className="tableWrap"><table><thead><tr><th>Changed</th><th>Post</th><th>Kind</th><th>State</th></tr></thead><tbody>{rows.map((row) => <tr key={`${row.reactionId}-${row.changedAt}`}><td>{new Date(row.changedAt).toLocaleString()}</td><td>{row.postId}</td><td>{row.kind}</td><td>{row.state}</td></tr>)}</tbody></table></div></section> : null}
  </ChirpShell>;
}
