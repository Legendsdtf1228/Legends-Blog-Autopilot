import { type ReactNode, useState } from 'react';
import { Link, useLocation } from 'wouter';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CalendarDays,
  Check,
  ChevronDown,
  CircleHelp,
  Clock3,
  FileText,
  History,
  LayoutDashboard,
  LibraryBig,
  Menu,
  Network,
  RefreshCw,
  Settings2,
  ShieldCheck,
  X,
} from 'lucide-react';

export const navItems = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/pipeline', label: 'Pipeline', icon: FileText },
  { href: '/research', label: 'Research', icon: Network },
  { href: '/knowledge', label: 'Knowledge', icon: LibraryBig },
  { href: '/questions', label: 'Questions', icon: CircleHelp },
  { href: '/calendar', label: 'Calendar', icon: CalendarDays },
];

export function ConsoleShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const active = location === '/' ? '/' : `/${location.split('/')[1]}`;
  return (
    <div className="grain min-h-[100dvh] bg-background">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[248px] flex-col bg-[hsl(var(--sidebar))] text-[hsl(var(--sidebar-foreground))] lg:flex">
        <div className="flex h-[82px] items-center border-b border-[hsl(var(--sidebar-border))] px-7">
          <Link href="/" className="flex items-center gap-3" data-testid="link-brand">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-[hsl(var(--sidebar-primary))] text-sm font-bold text-[hsl(var(--sidebar-primary-foreground))]">L</div>
            <div>
              <div className="text-[15px] font-semibold tracking-tight">Legends</div>
              <div className="font-mono-ui text-[10px] uppercase tracking-[.18em] text-white/45">owner console</div>
            </div>
          </Link>
        </div>
        <div className="flex-1 px-3 py-7">
          <div className="mb-3 px-3 font-mono-ui text-[10px] uppercase tracking-[.18em] text-white/35">Workspace</div>
          <nav className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const selected = active === item.href;
              return (
                <Link key={item.href} href={item.href} data-testid={`link-nav-${item.label.toLowerCase()}`} className={`group flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] transition-colors ${selected ? 'bg-white/10 text-white' : 'text-white/58 hover:bg-white/6 hover:text-white'}`}>
                  <Icon size={16} strokeWidth={selected ? 2.2 : 1.7} />
                  <span>{item.label}</span>
                  {item.href === '/questions' && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-[hsl(var(--sidebar-primary))]" />}
                </Link>
              );
            })}
          </nav>
          <div className="mb-3 mt-9 px-3 font-mono-ui text-[10px] uppercase tracking-[.18em] text-white/35">Control</div>
          <Link href="/activity" data-testid="link-nav-activity" className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] transition-colors ${active === '/activity' ? 'bg-white/10 text-white' : 'text-white/58 hover:bg-white/6 hover:text-white'}`}>
            <History size={16} strokeWidth={1.7} /><span>Activity</span>
          </Link>
          <Link href="/settings" data-testid="link-nav-settings" className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] transition-colors ${active === '/settings' ? 'bg-white/10 text-white' : 'text-white/58 hover:bg-white/6 hover:text-white'}`}>
            <Settings2 size={16} strokeWidth={1.7} /><span>Settings</span>
          </Link>
        </div>
        <div className="border-t border-[hsl(var(--sidebar-border))] p-5">
          <div className="flex items-center gap-3">
            <div className="grid h-8 w-8 place-items-center rounded-full bg-[#d7c2a4] text-xs font-bold text-[hsl(var(--sidebar))]">OW</div>
            <div className="min-w-0"><div className="truncate text-xs font-semibold">Owner workspace</div><div className="font-mono-ui text-[10px] text-white/40">draft_only</div></div>
            <ShieldCheck className="ml-auto text-[#94c9a7]" size={15} />
          </div>
        </div>
      </aside>
      <div className="lg:pl-[248px]">
        <header className="sticky top-0 z-20 flex h-[68px] items-center justify-between border-b border-border/80 bg-background/90 px-5 backdrop-blur-md sm:px-8">
          <div className="flex items-center gap-3">
            <button onClick={() => setMobileOpen(true)} className="grid h-9 w-9 place-items-center rounded-lg border border-border lg:hidden" data-testid="button-open-menu" aria-label="Open navigation"><Menu size={17} /></button>
            <div className="hidden text-xs text-muted-foreground sm:block">Legends apparel / <span className="text-foreground">{pageLabel(location)}</span></div>
            <div className="text-xs text-muted-foreground sm:hidden">{pageLabel(location)}</div>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-2 rounded-full border border-[#b5d5c4] bg-[#e4f0e8] px-3 py-1.5 text-[11px] font-semibold text-[#286346] sm:flex"><span className="h-1.5 w-1.5 rounded-full bg-[#4a9b6d]" />Draft mode active</div>
            <Link href="/settings" data-testid="link-header-settings" className="grid h-9 w-9 place-items-center rounded-lg border border-border text-muted-foreground hover:text-foreground"><Settings2 size={16} /></Link>
          </div>
        </header>
        {mobileOpen && <div className="fixed inset-0 z-40 bg-[hsl(225_24%_17%/_.38)] lg:hidden" onClick={() => setMobileOpen(false)}><aside className="h-full w-[284px] bg-[hsl(var(--sidebar))] p-5 text-[hsl(var(--sidebar-foreground))] shadow-[var(--shadow-md)]" onClick={(event) => event.stopPropagation()}><div className="flex items-center justify-between border-b border-[hsl(var(--sidebar-border))] pb-5"><div className="flex items-center gap-3"><div className="grid h-9 w-9 place-items-center rounded-xl bg-[hsl(var(--sidebar-primary))] text-sm font-bold text-[hsl(var(--sidebar-primary-foreground))]">L</div><div><div className="text-[15px] font-semibold">Legends</div><div className="font-mono-ui text-[10px] uppercase tracking-[.18em] text-white/45">owner console</div></div></div><button onClick={() => setMobileOpen(false)} data-testid="button-close-menu" className="grid h-8 w-8 place-items-center rounded-lg bg-white/10 text-white"><X size={16} /></button></div><nav className="mt-6 space-y-1">{navItems.map((item) => { const Icon = item.icon; return <Link key={item.href} href={item.href} onClick={() => setMobileOpen(false)} data-testid={`link-mobile-nav-${item.label.toLowerCase()}`} className={`flex items-center gap-3 rounded-lg px-3 py-3 text-sm ${active === item.href ? 'bg-white/10 text-white' : 'text-white/60'}`}><Icon size={16} /><span>{item.label}</span></Link>; })}<div className="my-5 border-t border-[hsl(var(--sidebar-border))]" /><Link href="/activity" onClick={() => setMobileOpen(false)} data-testid="link-mobile-nav-activity" className="flex items-center gap-3 rounded-lg px-3 py-3 text-sm text-white/60"><History size={16} /><span>Activity</span></Link><Link href="/settings" onClick={() => setMobileOpen(false)} data-testid="link-mobile-nav-settings" className="flex items-center gap-3 rounded-lg px-3 py-3 text-sm text-white/60"><Settings2 size={16} /><span>Settings</span></Link></nav></aside></div>}
        <main className="page-in mx-auto max-w-[1440px] px-5 py-7 sm:px-8 lg:px-10 lg:py-9">{children}</main>
      </div>
    </div>
  );
}

function pageLabel(location: string) {
  if (location === '/') return 'overview';
  if (location.startsWith('/pipeline/')) return 'pipeline / inspect';
  return location.replace('/', '') || 'overview';
}

export function PageHeader({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  return <div className="mb-8 flex flex-col justify-between gap-5 md:flex-row md:items-end">
    <div>
      {eyebrow && <div className="mb-2 font-mono-ui text-[10px] uppercase tracking-[.2em] text-[#b85c2c]">{eyebrow}</div>}
      <h1 className="font-display text-[36px] leading-[.98] tracking-[-.025em] text-foreground sm:text-[43px]">{title}</h1>
      {description && <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>}
    </div>
    {action && <div className="shrink-0">{action}</div>}
  </div>;
}

export function Button({ children, variant = 'dark', onClick, disabled, testId, type = 'button' }: { children: ReactNode; variant?: 'dark' | 'quiet' | 'orange' | 'outline'; onClick?: () => void; disabled?: boolean; testId?: string; type?: 'button' | 'submit' }) {
  const styles = { dark: 'bg-primary text-primary-foreground hover:bg-[#30394d]', quiet: 'bg-muted text-foreground hover:bg-[#e3ddcf]', orange: 'bg-accent text-accent-foreground hover:bg-[#bd5e23]', outline: 'border border-border bg-card text-foreground hover:border-[#b85c2c]' };
  return <button type={type} onClick={onClick} disabled={disabled} data-testid={testId} className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-[12px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${styles[variant]}`}>{children}</button>;
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'green' | 'orange' | 'red' | 'purple' | 'blue' }) {
  const tones = { neutral: 'bg-muted text-muted-foreground', green: 'bg-[#e4f0e8] text-[#286346]', orange: 'bg-[#f8e7da] text-[#a34c20]', red: 'bg-[#f6dfdc] text-[#a13d35]', purple: 'bg-[#e9e3f0] text-[#5e4b77]', blue: 'bg-[#e2ebef] text-[#42687a]' };
  return <span className={`inline-flex w-fit items-center rounded-full px-2.5 py-1 text-[10px] font-semibold tracking-wide ${tones[tone]}`}>{children}</span>;
}

export function Panel({ children, className = '', testId }: { children: ReactNode; className?: string; testId?: string }) {
  return <section data-testid={testId} className={`rounded-xl border border-card-border bg-card shadow-[var(--shadow-sm)] ${className}`}>{children}</section>;
}

export function SectionLabel({ children, detail }: { children: ReactNode; detail?: ReactNode }) {
  return <div className="mb-3 flex items-center justify-between"><h2 className="font-mono-ui text-[10px] uppercase tracking-[.17em] text-muted-foreground">{children}</h2>{detail}</div>;
}

export function StatCard({ label, value, note, accent = 'orange' }: { label: string; value: ReactNode; note?: string; accent?: 'orange' | 'teal' | 'plum' | 'ink' }) {
  const colors = { orange: 'bg-[#d8792c]', teal: 'bg-[#2e8078]', plum: 'bg-[#76608e]', ink: 'bg-[#3c465c]' };
  return <div className="relative overflow-hidden rounded-xl border border-card-border bg-card p-5 shadow-[var(--shadow-sm)]"><div className={`absolute left-0 top-0 h-full w-1 ${colors[accent]}`} /><div className="pl-2"><div className="font-mono-ui text-[10px] uppercase tracking-[.13em] text-muted-foreground">{label}</div><div className="mt-2 text-[29px] font-semibold tracking-[-.04em]">{value}</div>{note && <div className="mt-1 text-[11px] text-muted-foreground">{note}</div>}</div></div>;
}

export function DataState({ loading, error, empty, children, onRetry, label = 'records' }: { loading?: boolean; error?: boolean; empty?: boolean; children: ReactNode; onRetry?: () => void; label?: string }) {
  if (loading) return <Panel><div className="space-y-4 p-6"><div className="h-3 w-28 animate-pulse rounded bg-muted" /><div className="h-14 animate-pulse rounded-lg bg-muted" /><div className="h-14 animate-pulse rounded-lg bg-muted" /><div className="h-14 animate-pulse rounded-lg bg-muted" /></div></Panel>;
  if (error) return <Panel><div className="flex flex-col items-start gap-3 p-8"><div className="grid h-10 w-10 place-items-center rounded-full bg-[#f6dfdc] text-[#a13d35]"><AlertTriangle size={18} /></div><div><div className="font-semibold">Could not load {label}</div><p className="mt-1 text-sm text-muted-foreground">The console is keeping this view safe. Try again in a moment.</p></div>{onRetry && <Button variant="outline" onClick={onRetry} testId={`button-retry-${label}`}><RefreshCw size={14} /> Retry</Button>}</div></Panel>;
  if (empty) return <Panel><div className="flex flex-col items-center justify-center px-6 py-16 text-center"><div className="grid h-11 w-11 place-items-center rounded-full bg-muted text-muted-foreground"><Clock3 size={18} /></div><h3 className="mt-4 font-display text-2xl">Nothing here yet</h3><p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">When the server has work for this view, it will appear here. No action is needed.</p></div></Panel>;
  return <>{children}</>;
}

export function DevelopmentMark({ visible }: { visible: boolean }) {
  return visible ? <span className="ml-2 inline-flex items-center rounded bg-[#f8e7da] px-1.5 py-0.5 font-mono-ui text-[9px] uppercase tracking-wide text-[#a34c20]">development only</span> : null;
}

export function StatusDot({ tone = 'green' }: { tone?: 'green' | 'orange' | 'red' | 'gray' }) {
  const styles = { green: 'bg-[#4a9b6d]', orange: 'bg-[#d8792c]', red: 'bg-[#b84b43]', gray: 'bg-[#8c8e8a]' };
  return <span className={`inline-block h-2 w-2 rounded-full ${styles[tone]}`} />;
}

export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href} data-testid="link-back" className="mb-5 inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-foreground"><ArrowLeft size={14} /> {children}</Link>;
}

export function EmptyLine({ text }: { text: string }) {
  return <div className="rounded-lg border border-dashed border-border px-4 py-5 text-sm text-muted-foreground">{text}</div>;
}

export function FieldSelect({ label, value, onChange, options, testId }: { label: string; value: string; onChange: (value: string) => void; options: string[]; testId: string }) {
  return <label className="block"><span className="mb-1.5 block text-[11px] font-semibold text-muted-foreground">{label}</span><div className="relative"><select value={value} onChange={(e) => onChange(e.target.value)} data-testid={testId} className="w-full appearance-none rounded-lg border border-input bg-background px-3 py-2.5 pr-8 text-xs text-foreground outline-none focus:border-accent"><option value="">All</option>{options.map((option) => <option key={option} value={option}>{option.replace(/_/g, ' ')}</option>)}</select><ChevronDown className="pointer-events-none absolute right-3 top-3 text-muted-foreground" size={14} /></div></label>;
}

export function SafeLockNote({ children = 'Publishing remains disabled while production is paused.' }: { children?: ReactNode }) {
  return <div className="flex items-start gap-3 rounded-lg border border-[#d6e2d9] bg-[#edf5ef] px-4 py-3 text-xs text-[#38684b]"><ShieldCheck className="mt-0.5 shrink-0" size={15} /><span>{children}</span></div>;
}

export function ProgressBar({ value, max }: { value: number; max: number }) {
  const percent = max ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-secondary transition-[width]" style={{ width: `${percent}%` }} /></div>;
}

export function KeyValue({ label, value, testId }: { label: string; value: ReactNode; testId?: string }) {
  return <div data-testid={testId} className="border-t border-border/70 py-3 first:border-0"><div className="font-mono-ui text-[10px] uppercase tracking-[.1em] text-muted-foreground">{label}</div><div className="mt-1 text-sm leading-6">{value}</div></div>;
}

export function InlineArrow() {
  return <ArrowRight size={14} />;
}

export function CheckMark() {
  return <Check size={14} />;
}

export function CloseMark() {
  return <X size={14} />;
}