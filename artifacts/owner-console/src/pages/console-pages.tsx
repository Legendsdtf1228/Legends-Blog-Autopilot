import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useParams } from 'wouter';
import {
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronRight,
  CircleAlert,
  Filter,
  Info,
  LockKeyhole,
  MessageSquareText,
  Pause,
  Save,
  Search,
  Target,
  X,
} from 'lucide-react';
import {
  getHealthCheckQueryKey,
  getGetOwnerSettingsQueryKey,
  getGetPipelineItemQueryKey,
  getListMerchantQuestionsQueryKey,
  useAnswerMerchantQuestion,
  useHealthCheck,
  useGetDashboard,
  useGetOwnerSettings,
  useGetPipelineItem,
  useGetPublishingCalendar,
  useListActivity,
  useListKnowledgeEntries,
  useListMerchantQuestions,
  useListPipelineItems,
  useListResearchClusters,
  useUpdateOwnerSettings,
} from '@workspace/api-client-react';
import {
  BackLink,
  Badge,
  Button,
  DataState,
  DevelopmentMark,
  EmptyLine,
  FieldSelect,
  InlineArrow,
  KeyValue,
  PageHeader,
  Panel,
  ProgressBar,
  SafeLockNote,
  SectionLabel,
  StatCard,
  StatusDot,
} from '@/components/console-ui';

function dateLabel(value?: string | null) {
  if (!value) return 'Not scheduled';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function shortDate(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date);
}

function toneFor(value?: string | null): 'neutral' | 'green' | 'orange' | 'red' | 'purple' | 'blue' {
  const normalized = (value ?? '').toLowerCase();
  if (normalized.includes('blocked') || normalized.includes('missing') || normalized.includes('contradict')) return 'red';
  if (normalized.includes('review') || normalized.includes('pending') || normalized.includes('draft')) return 'orange';
  if (normalized.includes('approved') || normalized.includes('ready') || normalized.includes('complete') || normalized.includes('active')) return 'green';
  if (normalized.includes('research') || normalized.includes('evidence')) return 'purple';
  if (normalized.includes('shopify') || normalized.includes('scheduled')) return 'blue';
  return 'neutral';
}

function ErrorStrip({ children }: { children: string }) {
  return <div className="flex items-start gap-3 rounded-lg border border-[#efd1cd] bg-[#fbebe8] px-4 py-3 text-xs text-[#963e38]"><CircleAlert className="mt-0.5 shrink-0" size={15} /> <span>{children}</span></div>;
}

function FixtureLine({ visible }: { visible: boolean }) {
  return <DevelopmentMark visible={visible} />;
}

export function DashboardPage() {
  const dashboard = useGetDashboard();
  const health = useHealthCheckForDashboard();
  const data = dashboard.data;
  return <div>
    <PageHeader eyebrow="Owner overview" title="Keep the work honest." description="One place to see what can move forward, what still needs your judgment, and what stays safely paused." action={<Link href="/pipeline" data-testid="link-open-pipeline" className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground hover:bg-[#30394d]">Open pipeline <ArrowUpRight size={14} /></Link>} />
    <DataState loading={dashboard.isLoading} error={dashboard.isError} onRetry={() => dashboard.refetch()} label="dashboard">
      {data && <div className="space-y-7">
        {health.data && <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground"><StatusDot tone={health.data.status === 'ok' ? 'green' : 'orange'} /><span data-testid="status-health">System check: {health.data.status}</span><span className="text-border">/</span><span data-testid="status-operating-mode">Operating mode: <strong className="text-foreground">{data.operatingMode}</strong></span><span className="text-border">/</span><span data-testid="status-production">Production: <strong className="text-foreground">{data.productionPaused ? 'paused' : 'active'}</strong></span></div>}
        {data.productionPaused && <SafeLockNote>Production is paused and publishing is disabled. The console only supports research, drafting, review, and safe owner settings.</SafeLockNote>}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 rise-1">
          <StatCard label="In pipeline" value={data.counts.pipeline} note="active content work" accent="orange" />
          <StatCard label="Needs Logan" value={data.counts.needsLogan} note="merchant decisions waiting" accent="teal" />
          <StatCard label="Needs evidence" value={data.counts.needsEvidence} note="claims not ready to use" accent="plum" />
          <StatCard label="Knowledge pending" value={data.counts.knowledgePending} note="scope or freshness review" accent="ink" />
        </div>
        <div className="grid gap-5 xl:grid-cols-[1.25fr_.75fr] rise-2">
          <Panel className="overflow-hidden">
            <div className="border-b border-border/70 px-6 py-5"><SectionLabel detail={<Badge tone={toneFor(data.systemStatus)}>{data.systemStatus}</Badge>}>Next safe action</SectionLabel><div className="flex items-start gap-4"><div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#f8e7da] text-[#a34c20]"><Target size={17} /></div><div><h2 data-testid="text-next-action" className="font-display text-[27px] leading-tight">{data.nextAction}</h2><p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">The owner decision path is visible before any public claim can move. Start here to keep the queue unblocked without changing production state.</p></div></div></div>
            <div className="grid gap-0 sm:grid-cols-3"><div className="border-b border-border/70 p-6 sm:border-b-0 sm:border-r"><div className="font-mono-ui text-[10px] uppercase tracking-wide text-muted-foreground">Reviewed drafts</div><div className="mt-2 text-2xl font-semibold">{data.rollout.requiredDrafts > 0 ? <>{data.rollout.reviewedDrafts}<span className="text-sm font-normal text-muted-foreground"> / {data.rollout.requiredDrafts}</span></> : 'Not configured'}</div><div className="mt-3">{data.rollout.requiredDrafts > 0 ? <ProgressBar value={data.rollout.reviewedDrafts} max={data.rollout.requiredDrafts} /> : <div className="text-xs leading-5 text-muted-foreground">No rollout requirement is configured for this preview.</div>}</div></div><div className="border-b border-border/70 p-6 sm:border-b-0 sm:border-r"><div className="font-mono-ui text-[10px] uppercase tracking-wide text-muted-foreground">Target</div><div className="mt-2 text-2xl font-semibold">{data.rollout.target > 0 ? <>{data.rollout.published}<span className="text-sm font-normal text-muted-foreground"> / {data.rollout.target}</span></> : 'Not configured'}</div><div className="mt-2 text-xs text-muted-foreground">No publication while paused</div></div><div className="p-6"><div className="font-mono-ui text-[10px] uppercase tracking-wide text-muted-foreground">Shopify blog</div><div className="mt-2 flex items-center gap-2 text-sm font-semibold"><StatusDot tone={toneFor(data.shopify.status) === 'green' ? 'green' : 'orange'} />{data.shopify.status}</div><div className="mt-2 text-xs leading-5 text-muted-foreground">{data.shopify.detail}</div></div></div>
          </Panel>
          <Panel className="p-6">
            <SectionLabel>System boundary</SectionLabel>
            <div className="space-y-1">
              <BoundaryRow label="Operating mode" value={data.operatingMode} locked />
              <BoundaryRow label="Production" value={data.productionPaused ? 'Paused' : 'Active'} locked />
              <BoundaryRow label="Publishing" value="Disabled" locked />
              <BoundaryRow label="Auto-publish" value="Unavailable" locked />
            </div>
            <div className="mt-5 rounded-lg bg-[#f3efe6] p-4 text-xs leading-5 text-muted-foreground">This boundary is intentional. Owner controls shape the work; they do not bypass evidence or eligibility checks.</div>
          </Panel>
        </div>
        <div className="grid gap-5 xl:grid-cols-2 rise-3">
          <ActivityPreview title="Recent safe activity" events={data.recentActivity ?? []} empty="No recent safe activity." />
          <ActivityPreview title="Sanitized errors" events={data.errors ?? []} empty="No errors reported by the server." error />
        </div>
      </div>}
    </DataState>
  </div>;
}

function useHealthCheckForDashboard() {
  return useHealthCheck({ query: { queryKey: getHealthCheckQueryKey() } });
}

function BoundaryRow({ label, value, locked }: { label: string; value: string; locked?: boolean }) {
  return <div className="flex items-center justify-between border-b border-border/60 py-3 last:border-0"><span className="text-xs text-muted-foreground">{label}</span><span className="flex items-center gap-2 text-xs font-semibold">{value}{locked && <LockKeyhole size={12} className="text-muted-foreground" />}</span></div>;
}

function ActivityPreview({ title, events, empty, error = false }: { title: string; events: { id: string; time: string; kind: string; summary: string; detail: string; needsAction: boolean }[]; empty: string; error?: boolean }) {
  return <Panel className="p-6"><SectionLabel detail={events.length > 0 && <span className="font-mono-ui text-[10px] text-muted-foreground">{events.length} items</span>}>{title}</SectionLabel>{events.length === 0 ? <EmptyLine text={empty} /> : <div className="space-y-4">{events.slice(0, 4).map((event) => <div key={event.id} data-testid={`row-dashboard-activity-${event.id}`} className="flex gap-3"><div className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${error ? 'bg-[#b84b43]' : event.needsAction ? 'bg-[#d8792c]' : 'bg-[#4a9b6d]'}`} /><div className="min-w-0"><div className="flex flex-wrap items-center gap-2 text-xs font-semibold">{event.summary}{event.needsAction && <Badge tone="orange">Needs action</Badge>}</div><div className="mt-1 text-xs leading-5 text-muted-foreground">{event.detail}</div><div className="mt-1 font-mono-ui text-[10px] text-muted-foreground/75">{dateLabel(event.time)} · {event.kind}</div></div></div>)}</div>}</Panel>;
}

export function PipelinePage() {
  const [filters, setFilters] = useState({ status: '', category: '', audience: '' });
  const [search, setSearch] = useState('');
  const params = useMemo(() => ({ status: filters.status || undefined, category: filters.category || undefined, audience: filters.audience || undefined }), [filters]);
  const query = useListPipelineItems(params);
  const items = (query.data ?? []).filter((item) => item.title.toLowerCase().includes(search.toLowerCase()) || item.category.toLowerCase().includes(search.toLowerCase()));
  const statuses = [...new Set((query.data ?? []).map((item) => item.stage))];
  const categories = [...new Set((query.data ?? []).map((item) => item.category))];
  const audiences = [...new Set((query.data ?? []).map((item) => item.audience))];
  return <div>
    <PageHeader eyebrow="Content operations" title="The pipeline, at a glance." description="Browse research-backed work by stage, audience, and the decision that is keeping it honest." action={<div className="rounded-lg border border-border bg-card px-3 py-2 text-[11px] text-muted-foreground"><span className="font-semibold text-foreground">{items.length}</span> visible items</div>} />
    <div className="mb-5 grid gap-3 rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-sm)] md:grid-cols-[1.3fr_repeat(3,1fr)]">
      <label className="relative block"><Search className="absolute left-3 top-3 text-muted-foreground" size={15} /><input value={search} onChange={(e) => setSearch(e.target.value)} data-testid="input-pipeline-search" placeholder="Search titles or categories" className="w-full rounded-lg border border-input bg-background py-2.5 pl-9 pr-3 text-xs outline-none focus:border-accent" /></label>
      <FieldSelect label="Stage" value={filters.status} onChange={(value) => setFilters((current) => ({ ...current, status: value }))} options={statuses} testId="select-pipeline-stage" />
      <FieldSelect label="Category" value={filters.category} onChange={(value) => setFilters((current) => ({ ...current, category: value }))} options={categories} testId="select-pipeline-category" />
      <FieldSelect label="Audience" value={filters.audience} onChange={(value) => setFilters((current) => ({ ...current, audience: value }))} options={audiences} testId="select-pipeline-audience" />
    </div>
    <DataState loading={query.isLoading} error={query.isError} empty={!query.isLoading && !query.isError && items.length === 0} onRetry={() => query.refetch()} label="pipeline items">
      <Panel className="overflow-hidden">
        <div className="hidden grid-cols-[1.45fr_.8fr_.8fr_.8fr_1fr_24px] gap-4 border-b border-border bg-[#f5f0e7] px-5 py-3 font-mono-ui text-[10px] uppercase tracking-[.12em] text-muted-foreground md:grid"><span>Content work</span><span>Stage</span><span>Audience</span><span>Evidence</span><span>Next action</span><span /></div>
        <div className="divide-y divide-border/70">{items.map((item) => <Link href={`/pipeline/${item.id}`} key={item.id} data-testid={`row-pipeline-${item.id}`} className="group grid gap-3 px-5 py-5 transition-colors hover:bg-[#f8f3ea] md:grid-cols-[1.45fr_.8fr_.8fr_.8fr_1fr_24px] md:items-center md:gap-4"><div><div className="flex flex-wrap items-center text-sm font-semibold leading-5 group-hover:text-[#a34c20]">{item.title}<FixtureLine visible={item.isDevelopmentFixture} /></div><div className="mt-1 text-xs text-muted-foreground">{item.category} · {item.decision}</div></div><div><span className="mr-2 text-[10px] text-muted-foreground md:hidden">Stage</span><Badge tone={toneFor(item.stage)}>{item.stage}</Badge></div><div className="text-xs text-muted-foreground"><span className="mr-2 text-[10px] md:hidden">Audience</span>{item.audience}</div><div><span className="mr-2 text-[10px] text-muted-foreground md:hidden">Evidence</span><Badge tone={toneFor(item.evidenceStatus)}>{item.evidenceStatus}</Badge></div><div className="text-xs leading-5 text-muted-foreground"><span className="mr-2 text-[10px] md:hidden">Next</span>{item.nextAction}{item.blockedReason && <div className="mt-1 text-[10px] text-[#a13d35]">{item.blockedReason}</div>}</div><ChevronRight className="hidden text-muted-foreground transition-transform group-hover:translate-x-1 md:block" size={16} /></Link>)}</div>
      </Panel>
    </DataState>
  </div>;
}

export function PipelineDetailPage() {
  const { id } = useParams<{ id: string }>();
  const query = useGetPipelineItem(id ?? '', { query: { enabled: Boolean(id), queryKey: getGetPipelineItemQueryKey(id ?? '') } });
  const item = query.data;
  return <div>
    <BackLink href="/pipeline">Back to pipeline</BackLink>
    <DataState loading={query.isLoading} error={query.isError} onRetry={() => query.refetch()} label="content detail">
      {item && <div>
        <PageHeader eyebrow={`${item.category} / ${item.stage}`} title={item.title} description={`${item.audience} audience · ${item.decision}`} action={<div className="flex items-center gap-2"><Badge tone={toneFor(item.evidenceStatus)}>{item.evidenceStatus}</Badge><FixtureLine visible={item.isDevelopmentFixture} /></div>} />
        <div className="mb-6 grid gap-3 sm:grid-cols-3"><MiniDecision label="Next action" value={item.nextAction} tone="orange" /><MiniDecision label="Scheduled" value={dateLabel(item.scheduledDate)} tone="blue" /><MiniDecision label="Blocked reason" value={item.blockedReason ?? 'No active blocker'} tone={item.blockedReason ? 'red' : 'green'} /></div>
        <div className="grid gap-5 xl:grid-cols-[1.1fr_.9fr]">
          <div className="space-y-5">
            <Panel className="p-6"><SectionLabel>Framing</SectionLabel><div className="space-y-0"><KeyValue label="Reader question" value={item.readerQuestion} testId="text-reader-question" /><KeyValue label="Question provenance" value={item.questionProvenance} /><KeyValue label="Situation" value={item.situation} /><KeyValue label="Problem" value={item.problem} /><KeyValue label="Desired outcome" value={item.desiredOutcome} /></div></Panel>
            <Panel className="p-6"><SectionLabel>Draft boundary</SectionLabel><div className="grid gap-6 md:grid-cols-2"><div><div className="mb-3 text-xs font-semibold">Outline</div><ol className="space-y-3">{item.outline.map((line, index) => <li key={`${line}-${index}`} className="flex gap-3 text-sm leading-5"><span className="font-mono-ui text-[10px] text-muted-foreground">{String(index + 1).padStart(2, '0')}</span><span>{line}</span></li>)}</ol></div><div><div className="mb-3 text-xs font-semibold">Constraints</div><div className="space-y-2">{item.constraints.map((constraint) => <div key={constraint} className="flex gap-2 text-sm leading-5 text-muted-foreground"><LockKeyhole className="mt-0.5 shrink-0 text-[#a34c20]" size={14} />{constraint}</div>)}</div><div className="mt-5 rounded-lg bg-[#f3efe6] p-4"><div className="font-mono-ui text-[10px] uppercase tracking-wide text-muted-foreground">Evidence budget</div><div className="mt-2 text-sm leading-5">{item.evidenceBudget}</div></div></div></div></Panel>
            <Panel className="p-6"><SectionLabel>Item activity</SectionLabel><ActivityPreview title="" events={item.activity} empty="No activity recorded." /></Panel>
          </div>
          <div className="space-y-5">
            <Panel className="p-6"><SectionLabel detail={<Badge tone="green">Allowed</Badge>}>Approved facts</SectionLabel>{item.approvedFacts.length ? <div className="space-y-3">{item.approvedFacts.map((fact) => <div key={fact} className="flex gap-3 rounded-lg bg-[#edf5ef] px-3 py-3 text-sm leading-5 text-[#38684b]"><Check className="mt-0.5 shrink-0" size={15} />{fact}</div>)}</div> : <EmptyLine text="No approved facts attached." />}</Panel>
            <Panel className="p-6"><SectionLabel detail={<Badge tone="red">Do not use</Badge>}>Blocked claims</SectionLabel>{item.blockedClaims.length ? <div className="space-y-3">{item.blockedClaims.map((claim) => <div key={claim} className="flex gap-3 rounded-lg bg-[#fbebe8] px-3 py-3 text-sm leading-5 text-[#963e38]"><X className="mt-0.5 shrink-0" size={15} />{claim}</div>)}</div> : <EmptyLine text="No blocked claims attached." />}{item.contradictions.length > 0 && <div className="mt-5"><div className="mb-3 text-xs font-semibold text-[#a34c20]">Contradictions to resolve</div><div className="space-y-2">{item.contradictions.map((entry) => <div key={entry} className="rounded-lg border border-[#ead7bd] bg-[#fcf5e9] px-3 py-3 text-xs leading-5 text-[#85592f]">{entry}</div>)}</div></div>}</Panel>
            <SafeLockNote>Review and drafting are available. Publishing, evidence approval, and eligibility overrides are intentionally unavailable.</SafeLockNote>
          </div>
        </div>
      </div>}
    </DataState>
  </div>;
}

function MiniDecision({ label, value, tone }: { label: string; value: string; tone: 'orange' | 'blue' | 'red' | 'green' }) {
  return <div className="rounded-xl border border-card-border bg-card p-4 shadow-[var(--shadow-sm)]"><div className="font-mono-ui text-[10px] uppercase tracking-[.1em] text-muted-foreground">{label}</div><div className={`mt-2 text-sm font-semibold ${tone === 'red' ? 'text-[#a13d35]' : tone === 'orange' ? 'text-[#a34c20]' : tone === 'green' ? 'text-[#286346]' : 'text-[#42687a]'}`}>{value}</div></div>;
}

export function ResearchPage() {
  const query = useListResearchClusters();
  const clusters = query.data ?? [];
  const [filter, setFilter] = useState('all');
  const visible = filter === 'all' ? clusters : clusters.filter((cluster) => cluster.status.toLowerCase().includes(filter));
  return <div><PageHeader eyebrow="ReaderTask" title="Research with a review lane." description="Clusters show the question, the audience decision behind it, and whether the evidence is sturdy enough for the next drafting step." action={<div className="flex gap-1 rounded-lg border border-border bg-card p-1"><Filter size={14} className="m-2 text-muted-foreground" />{['all', 'active', 'review'].map((item) => <button key={item} onClick={() => setFilter(item)} data-testid={`button-research-filter-${item}`} className={`rounded-md px-3 py-1.5 text-[11px] font-semibold ${filter === item ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}>{item}</button>)}</div>} />
    <DataState loading={query.isLoading} error={query.isError} empty={!query.isLoading && !query.isError && visible.length === 0} onRetry={() => query.refetch()} label="research clusters">
      <div className="grid gap-4 lg:grid-cols-2">{visible.map((cluster) => <Panel key={cluster.id} className="p-5" testId={`card-research-${cluster.id}`}><div className="flex items-start justify-between gap-4"><div className="flex flex-wrap items-center gap-2"><Badge tone={toneFor(cluster.status)}>{cluster.status}</Badge><FixtureLine visible={cluster.isDevelopmentFixture} /></div><div className="font-mono-ui text-[10px] text-muted-foreground">{Math.round(cluster.confidence * 100)}% confidence</div></div><h2 className="mt-4 font-display text-[24px] leading-tight">{cluster.canonicalQuestion}</h2><div className="mt-3 flex flex-wrap gap-2 text-[11px] text-muted-foreground"><span>{cluster.audience}</span><span className="text-border">·</span><span>{cluster.decision}</span><span className="text-border">·</span><span>{dateLabel(cluster.lastEvaluated)}</span></div><div className="mt-5"><ProgressBar value={cluster.confidence} max={1} /></div>{cluster.supportingEvidence && cluster.supportingEvidence.length > 0 && <div className="mt-5 border-t border-border/70 pt-4"><div className="mb-2 text-xs font-semibold">Supporting evidence</div><div className="space-y-2">{cluster.supportingEvidence.map((evidence) => <div key={evidence} className="flex gap-2 text-xs leading-5 text-muted-foreground"><BookOpen size={13} className="mt-0.5 shrink-0 text-[#76608e]" />{evidence}</div>)}</div></div>}{cluster.reviewReason && <div className="mt-4 flex gap-2 rounded-lg bg-[#fcf5e9] px-3 py-3 text-xs leading-5 text-[#85592f]"><Info className="mt-0.5 shrink-0" size={14} />{cluster.reviewReason}</div>}</Panel>)}</div>
    </DataState>
  </div>;
}

export function KnowledgePage() {
  const query = useListKnowledgeEntries();
  const entries = query.data ?? [];
  return <div><PageHeader eyebrow="Knowledge ledger" title="Know what can be said." description="Scope, freshness, approval, and contradictions stay visible together so public-use decisions never rely on memory." /><DataState loading={query.isLoading} error={query.isError} empty={!query.isLoading && !query.isError && entries.length === 0} onRetry={() => query.refetch()} label="knowledge entries"><Panel className="overflow-hidden"><div className="hidden grid-cols-[1.3fr_.8fr_.7fr_.8fr_.7fr_24px] gap-4 border-b border-border bg-[#f5f0e7] px-5 py-3 font-mono-ui text-[10px] uppercase tracking-[.12em] text-muted-foreground md:grid"><span>Entry</span><span>Approval</span><span>Scope</span><span>Freshness</span><span>Public use</span><span /></div><div className="divide-y divide-border/70">{entries.map((entry) => <div key={entry.id} data-testid={`row-knowledge-${entry.id}`} className="grid gap-3 px-5 py-5 md:grid-cols-[1.3fr_.8fr_.7fr_.8fr_.7fr_24px] md:items-center md:gap-4"><div><div className="flex flex-wrap items-center text-sm font-semibold">{entry.title}<FixtureLine visible={entry.isDevelopmentFixture} /></div><div className="mt-1 text-xs text-muted-foreground">{entry.category} · rev {entry.revision} · {entry.sourceType}</div></div><div><span className="mr-2 text-[10px] text-muted-foreground md:hidden">Approval</span><Badge tone={toneFor(entry.approvalState)}>{entry.approvalState}</Badge></div><div className="text-xs"><span className="mr-2 text-[10px] text-muted-foreground md:hidden">Scope</span>{entry.scope}</div><div className="text-xs text-muted-foreground"><span className="mr-2 text-[10px] md:hidden">Freshness</span>{entry.freshness}</div><div><Badge tone={toneFor(entry.publicUse)}>{entry.publicUse}</Badge></div><div className="text-muted-foreground"><ChevronRight size={16} /></div>{entry.contradictions && entry.contradictions.length > 0 && <div className="rounded-lg bg-[#fbebe8] px-3 py-2 text-xs text-[#963e38] md:col-span-6"><span className="font-semibold">Contradiction:</span> {entry.contradictions.join(' · ')}</div>}</div>)}</div></Panel></DataState></div>;
}

export function QuestionsPage() {
  const query = useListMerchantQuestions();
  const client = useQueryClient();
  const mutation = useAnswerMerchantQuestion({ mutation: { onSuccess: () => client.invalidateQueries({ queryKey: getListMerchantQuestionsQueryKey() }) } });
  const [selected, setSelected] = useState<string | null>(null);
  const [answer, setAnswer] = useState('');
  const [scope, setScope] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().slice(0, 10));
  const [publicUse, setPublicUse] = useState(false);
  const questions = query.data ?? [];
  const awaitingQuestions = questions.filter((question) => question.status === 'awaiting_answer');
  const active = questions.find((question) => question.id === selected);
  function openAnswer(id: string) { setSelected(id); setAnswer(''); setScope(''); setPublicUse(false); setEffectiveDate(new Date().toISOString().slice(0, 10)); }
  function submitAnswer() { if (!active || !answer.trim() || !scope.trim() || !effectiveDate) return; mutation.mutate({ id: active.id, data: { answer, scope, effectiveDate, publicUsePermission: publicUse } }, { onSuccess: () => setSelected(null) }); }
  return <div><PageHeader eyebrow="Merchant decisions" title="Questions that need your voice." description="Answering saves a pending decision with scope and effective date. It does not approve evidence or publish anything." action={<Badge tone="orange">{awaitingQuestions.length} awaiting answer</Badge>} /><DataState loading={query.isLoading} error={query.isError} empty={!query.isLoading && !query.isError && questions.length === 0} onRetry={() => query.refetch()} label="merchant questions"><div className="grid gap-4">{questions.map((question) => <Panel key={question.id} className="p-5" testId={`card-question-${question.id}`}><div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start"><div className="max-w-3xl"><div className="flex flex-wrap items-center gap-2"><Badge tone={toneFor(question.status)}>{question.status}</Badge><FixtureLine visible={question.isDevelopmentFixture} /></div><h2 className="mt-3 font-display text-[25px] leading-tight">{question.question}</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">{question.why}</p></div>{question.status === 'awaiting_answer' ? <Button variant="orange" onClick={() => openAnswer(question.id)} testId={`button-answer-${question.id}`}><MessageSquareText size={14} /> Answer question</Button> : <Badge tone="orange">Pending review</Badge>}</div><div className="mt-5 grid gap-3 border-t border-border/70 pt-4 sm:grid-cols-3"><KeyValue label="Missing" value={question.missing} /><KeyValue label="Scope required" value={question.scopeRequired} /><KeyValue label="Affects" value={question.affects.join(' · ')} /></div><div className="mt-4"><Badge tone={question.publicUse.toLowerCase().includes('allow') ? 'green' : 'red'}>Public use: {question.publicUse}</Badge></div></Panel>)}</div></DataState>
    {active && <div className="fixed inset-0 z-40 flex items-end justify-center bg-[hsl(225_24%_17%/_.38)] p-0 sm:items-center sm:p-5"><div className="max-h-[94dvh] w-full max-w-xl overflow-y-auto rounded-t-2xl border border-border bg-card p-6 shadow-[var(--shadow-md)] sm:rounded-2xl" role="dialog" aria-modal="true"><div className="flex items-start justify-between gap-4"><div><div className="font-mono-ui text-[10px] uppercase tracking-[.15em] text-[#b85c2c]">Pending answer</div><h2 className="mt-2 font-display text-3xl leading-tight">Add the missing context.</h2></div><button onClick={() => setSelected(null)} data-testid="button-close-answer" className="grid h-8 w-8 place-items-center rounded-lg border border-border text-muted-foreground"><X size={15} /></button></div><div className="mt-5 rounded-lg bg-[#f3efe6] p-4 text-sm leading-6">{active.question}</div><div className="mt-5 space-y-4"><label className="block"><span className="mb-1.5 block text-xs font-semibold">Answer</span><textarea value={answer} onChange={(e) => setAnswer(e.target.value)} data-testid="textarea-merchant-answer" rows={4} className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-accent" placeholder="State the owner-approved answer..." /></label><label className="block"><span className="mb-1.5 block text-xs font-semibold">Scope</span><input value={scope} onChange={(e) => setScope(e.target.value)} data-testid="input-answer-scope" className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-accent" placeholder="Product line, region, or customer situation" /></label><label className="block"><span className="mb-1.5 block text-xs font-semibold">Effective date</span><input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} data-testid="input-answer-effective-date" className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-accent" /></label><label className="flex items-start gap-3 rounded-lg border border-border bg-background p-3"><input type="checkbox" checked={publicUse} onChange={(e) => setPublicUse(e.target.checked)} data-testid="checkbox-public-use" className="mt-0.5 accent-[#2e8078]" /><span><span className="block text-xs font-semibold">Permit public use</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">This records permission for future drafting. It does not publish or approve a claim.</span></span></label></div>{mutation.isError && <div className="mt-4"><ErrorStrip>Answer could not be saved. Nothing was changed.</ErrorStrip></div>}<div className="mt-6 flex justify-end gap-2"><Button variant="quiet" onClick={() => setSelected(null)} testId="button-cancel-answer">Cancel</Button><Button variant="orange" onClick={submitAnswer} disabled={!answer.trim() || !scope.trim() || !effectiveDate || mutation.isPending} testId="button-save-answer"><Save size={14} />{mutation.isPending ? 'Saving…' : 'Save pending answer'}</Button></div></div></div>}
  </div>;
}

export function CalendarPage() {
  const query = useGetPublishingCalendar();
  const entries = query.data ?? [];
  return <div><PageHeader eyebrow="Development calendar" title="A calendar without a publish button." description="Use dates to coordinate research and drafting. Production remains paused across every entry." action={<div className="flex items-center gap-2 rounded-lg border border-[#d6e2d9] bg-[#edf5ef] px-3 py-2 text-[11px] font-semibold text-[#38684b]"><Pause size={13} /> Production paused</div>} /><DataState loading={query.isLoading} error={query.isError} empty={!query.isLoading && !query.isError && entries.length === 0} onRetry={() => query.refetch()} label="calendar entries"><div className="space-y-3">{entries.map((entry) => <Panel key={entry.id} className="grid gap-4 p-5 md:grid-cols-[120px_1fr_auto] md:items-center" testId={`row-calendar-${entry.id}`}><div><div className="font-mono-ui text-[11px] uppercase tracking-wide text-[#a34c20]">{shortDate(entry.date)}</div><div className="mt-1 text-xs text-muted-foreground">{dateLabel(entry.date)}</div></div><div><div className="flex flex-wrap items-center gap-2 text-sm font-semibold">{entry.title}<Badge tone={toneFor(entry.status)}>{entry.status}</Badge></div><div className="mt-2 text-xs leading-5 text-muted-foreground">{entry.detail}</div></div><div className="flex items-center gap-2 text-xs text-muted-foreground"><StatusDot tone={entry.productionPaused ? 'green' : 'orange'} />{entry.productionPaused ? 'Paused' : 'Check state'}</div></Panel>)}</div></DataState></div>;
}

export function SettingsPage() {
  const query = useGetOwnerSettings();
  const mutation = useUpdateOwnerSettings();
  const client = useQueryClient();
  const settings = query.data;
  const [frequency, setFrequency] = useState('');
  const [geography, setGeography] = useState('');
  const [tone, setTone] = useState('');
  const [depth, setDepth] = useState('');
  const [notifications, setNotifications] = useState(false);
  useEffect(() => { if (settings) { setFrequency(settings.frequency); setGeography(settings.geography); setTone(settings.tone); setDepth(settings.depth); setNotifications(settings.notifications); } }, [settings]);
  function saveSettings() { mutation.mutate({ data: { frequency, geography, tone, depth, notifications } }, { onSuccess: (next) => { client.setQueryData(getGetOwnerSettingsQueryKey(), next); } }); }
  return <div><PageHeader eyebrow="Owner controls" title="Tune the brief, not the boundary." description="These settings shape research and draft work. Locked production controls are shown for clarity and cannot be changed here." action={mutation.isSuccess ? <Badge tone="green">Saved safely</Badge> : <Button variant="dark" onClick={saveSettings} disabled={query.isLoading || mutation.isPending} testId="button-save-settings"><Save size={14} />{mutation.isPending ? 'Saving…' : 'Save settings'}</Button>} /><DataState loading={query.isLoading} error={query.isError} onRetry={() => query.refetch()} label="owner settings">{settings && <div className="grid gap-5 xl:grid-cols-[1fr_.75fr]"><div className="space-y-5"><Panel className="p-6"><SectionLabel>Drafting preferences</SectionLabel><div className="grid gap-4 sm:grid-cols-2"><FieldSelect label="Frequency" value={frequency} onChange={setFrequency} options={['weekly', 'twice_weekly', 'monthly']} testId="select-setting-frequency" /><FieldSelect label="Geography" value={geography} onChange={setGeography} options={['US', 'North America', 'Global']} testId="select-setting-geography" /><FieldSelect label="Tone" value={tone} onChange={setTone} options={['practical', 'warm', 'technical']} testId="select-setting-tone" /><FieldSelect label="Depth" value={depth} onChange={setDepth} options={['brief', 'standard', 'deep']} testId="select-setting-depth" /></div><div className="mt-5 space-y-3 border-t border-border/70 pt-5"><ToggleRow label="Owner notifications" detail="Receive safe activity and decision reminders." checked={notifications} onChange={setNotifications} testId="switch-setting-notifications" /><div className="flex items-center justify-between gap-4"><span><span className="block text-sm font-semibold">Emergency pause</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">Production stays paused for this milestone.</span></span><Badge tone="green">Locked on</Badge></div></div></Panel><Panel className="p-6"><SectionLabel>Current brief</SectionLabel><div className="grid gap-x-6 gap-y-0 sm:grid-cols-2"><KeyValue label="Days" value={settings.days.join(' · ') || 'Not configured'} /><KeyValue label="Categories" value={settings.categories.join(' · ') || 'Not configured'} /><KeyValue label="Shopify blog" value={settings.shopifyBlog} /><KeyValue label="Operating mode" value={settings.operatingMode} /></div></Panel></div><div className="space-y-5"><Panel className="p-6"><SectionLabel>Locked controls</SectionLabel><div className="space-y-3">{settings.lockedModes.map((mode) => <div key={mode} className="flex items-center justify-between rounded-lg border border-border bg-[#f3efe6] px-3 py-3 text-xs"><span>{mode.replace(/_/g, ' ')}</span><LockKeyhole size={14} className="text-muted-foreground" /></div>)}</div><div className="mt-5"><SafeLockNote>Production mode, publishing, auto-publish, and evidence overrides are not owner-editable controls.</SafeLockNote></div></Panel>{mutation.isError && <ErrorStrip>Settings could not be saved. Nothing was changed.</ErrorStrip>}</div></div>}</DataState></div>;
}

function ToggleRow({ label, detail, checked, onChange, testId }: { label: string; detail: string; checked: boolean; onChange: (checked: boolean) => void; testId: string }) {
  return <label className="flex items-center justify-between gap-4"><span><span className="block text-sm font-semibold">{label}</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">{detail}</span></span><button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} data-testid={testId} className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? 'bg-secondary' : 'bg-muted'}`}><span className={`absolute top-1 h-4 w-4 rounded-full bg-card shadow-sm transition-transform ${checked ? 'left-6' : 'left-1'}`} /></button></label>;
}

export function ActivityPage() {
  const query = useListActivity();
  const events = query.data ?? [];
  return <div><PageHeader eyebrow="Audit trail" title="A quiet, useful record." description="Recent safe activity and sanitized errors, without request payloads or server internals." /><DataState loading={query.isLoading} error={query.isError} empty={!query.isLoading && !query.isError && events.length === 0} onRetry={() => query.refetch()} label="activity"><Panel className="divide-y divide-border/70 overflow-hidden">{events.map((event) => <div key={event.id} data-testid={`row-activity-${event.id}`} className="grid gap-3 px-5 py-5 md:grid-cols-[130px_1fr_auto] md:items-start"><div className="font-mono-ui text-[10px] uppercase tracking-wide text-muted-foreground">{dateLabel(event.time)}</div><div><div className="flex flex-wrap items-center gap-2 text-sm font-semibold">{event.summary}{event.needsAction && <Badge tone="orange">Needs action</Badge>}</div><div className="mt-1 text-sm leading-6 text-muted-foreground">{event.detail}</div></div><Badge tone={event.kind.toLowerCase().includes('error') ? 'red' : 'green'}>{event.kind}</Badge></div>)}</Panel></DataState></div>;
}

export function NotFoundPage() {
  const [, setLocation] = useLocation();
  return <div className="mx-auto flex min-h-[70dvh] max-w-lg flex-col items-start justify-center"><div className="font-mono-ui text-[10px] uppercase tracking-[.2em] text-[#b85c2c]">404 / not in the console</div><h1 className="mt-3 font-display text-5xl">That view is not available.</h1><p className="mt-4 text-sm leading-6 text-muted-foreground">Use the workspace navigation to return to a safe owner surface.</p><Button variant="dark" onClick={() => setLocation('/')} testId="button-return-overview">Return to overview</Button></div>;
}