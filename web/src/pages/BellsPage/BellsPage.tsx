import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BellRing,
  CalendarOff,
  ChevronDown,
  Clock,
  Pause,
  Pencil,
  Play,
  Plus,
  Search,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import { useStore } from '@/store';
import { Button } from '@/components/Button/Button';
import { Card } from '@/components/Card/Card';
import { Input } from '@/components/Input/Input';
import { ScreenHeader } from '@/components/ScreenHeader/ScreenHeader';
import { Switch } from '@/components/Switch/Switch';
import { Badge } from '@/components/Badge/Badge';
import type { Bell } from '@infinity/shared';
import { BellDialog } from '@/components/BellDialog/BellDialog';
import { BellLedger } from '@/components/BellLedger/BellLedger';
import { BellSkipsDialog } from '@/components/BellSkipsDialog/BellSkipsDialog';
import {
  DAY_LABELS,
  WEEKDAY_ORDER,
  localDateOf,
  minutesOfDay,
} from '@/lib/bellTime';
import '@/pages/BellsPage/BellsPage.scss';

type DayFilter = 'today' | 'all' | number;
type StatusFilter = 'all' | 'enabled' | 'disabled';

const fmtClock = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return [d.getHours(), d.getMinutes()].map((n) => String(n).padStart(2, '0')).join(':');
};

const daySummary = (days: number[]) => {
  const set = new Set(days);
  const schoolWeek = [1, 2, 3, 4, 5].every((d) => set.has(d));
  if (schoolWeek && set.size === 5) return 'Mon–Fri';
  if (set.size === 7) return 'Every day';
  return WEEKDAY_ORDER.filter((d) => set.has(d))
    .map((d) => DAY_LABELS[d])
    .join(' ');
};

/** "in 2h 5m" for a future instant, "now" when due. */
const countdown = (iso: string | null): string => {
  if (!iso) return '—';
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return 'due now';
  const minutes = Math.round(diff / 60_000);
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `in ${hours}h ${minutes % 60}m`;
  return `in ${Math.floor(hours / 24)}d`;
};


export const BellsPage = () => {
  const bells = useStore((s) => s.bells);
  const bellStatus = useStore((s) => s.bellStatus);
  const bellSkips = useStore((s) => s.bellSkips);
  const zones = useStore((s) => s.zones);
  const endpoints = useStore((s) => s.endpoints);
  const media = useStore((s) => s.media);
  const loadBells = useStore((s) => s.loadBells);
  const setBellEnabled = useStore((s) => s.setBellEnabled);
  const removeBell = useStore((s) => s.removeBell);
  const testBell = useStore((s) => s.testBell);
  const pauseBells = useStore((s) => s.pauseBells);
  const removeBellSkip = useStore((s) => s.removeBellSkip);

  const [query, setQuery] = useState('');
  const [dayFilter, setDayFilter] = useState<DayFilter>('today');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [editing, setEditing] = useState<Bell | 'new' | null>(null);
  const [ledgerFor, setLedgerFor] = useState<Bell | null>(null);
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [skipsOpen, setSkipsOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Bell | null>(null);
  const [showGrid, setShowGrid] = useState(false);
  const [, setTick] = useState(0);

  useEffect(() => {
    void loadBells();
    // Re-count countdowns once a minute without re-fetching.
    const timer = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(timer);
  }, [loadBells]);

  const timezone = bellStatus?.timezone ?? 'Asia/Kathmandu';
  const paused = bellStatus?.paused ?? false;
  const serverToday = localDateOf(new Date(), timezone);
  const todayWeekday = useMemo(() => {
    const js = new Date(`${serverToday}T00:00:00Z`).getUTCDay();
    return ((js + 6) % 7) + 1;
  }, [serverToday]);

  const mediaById = useMemo(
    () => new Map(media.map((m) => [m.id, m])),
    [media],
  );

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return bells
      .filter((b) => {
        if (needle && !b.name.toLowerCase().includes(needle)) return false;
        if (statusFilter === 'enabled' && !b.enabled) return false;
        if (statusFilter === 'disabled' && b.enabled) return false;
        if (dayFilter === 'today' && !b.daysOfWeek.includes(todayWeekday))
          return false;
        if (typeof dayFilter === 'number' && !b.daysOfWeek.includes(dayFilter))
          return false;
        return true;
      })
      .sort((a, b) => minutesOfDay(a.timeOfDay) - minutesOfDay(b.timeOfDay));
  }, [bells, query, statusFilter, dayFilter, todayWeekday]);

  const activeCount = bells.filter((b) => b.enabled).length;
  const nextBell = useMemo(() => {
    const upcoming = bells
      .filter((b) => b.enabled && b.nextAt)
      .sort(
        (a, b) =>
          new Date(a.nextAt as string).getTime() -
          new Date(b.nextAt as string).getTime(),
      );
    return upcoming[0] ?? null;
  }, [bells]);

  const dueSoon = useCallback((bell: Bell) => {
    if (!bell.nextAt) return false;
    const diff = new Date(bell.nextAt).getTime() - Date.now();
    return diff > 0 && diff <= 60 * 60 * 1000;
  }, []);

  return (
    <div className="page-scroll bells-page">
      <ScreenHeader
        title="Bells"
        subtitle={
          <span className="bells-sub">
            <span>
              <b>{activeCount}</b> active
              {nextBell
                ? ` · next ${nextBell.timeOfDay} ${nextBell.name}`
                : bells.length === 0
                  ? ' · no bells scheduled'
                  : ' · nothing upcoming'}
            </span>
            <span className="bells-sub-tz">
              <Clock size={11} /> {timezone}
              {bellStatus ? ` · server ${fmtClock(bellStatus.serverTime)}` : ''}
            </span>
          </span>
        }
        actions={
          <>
            <label className={`bells-pause${paused ? ' on' : ''}`}>
              <span>{paused ? 'Paused' : 'Pause all'}</span>
              <Switch
                checked={paused}
                onCheckedChange={(checked) => void pauseBells(checked)}
                aria-label="Pause all bells"
              />
            </label>
            <Button variant="outline" size="sm" onClick={() => setSkipsOpen(true)}>
              <CalendarOff size={13} /> Skips
              {bellSkips.length > 0 ? (
                <span className="bells-count">{bellSkips.length}</span>
              ) : null}
            </Button>
            <Button size="sm" onClick={() => setEditing('new')}>
              <Plus size={13} /> Add bell
            </Button>
          </>
        }
      />

      {paused ? (
        <div className="bells-banner" role="status">
          <ShieldAlert size={16} />
          <div>
            <strong>All bells are paused — no chimes will ring.</strong>
            <span>
              Bells due while paused are recorded as skipped
              {bellStatus?.pausedBy ? ` (paused by ${bellStatus.pausedBy})` : ''}.
            </span>
          </div>
          <Button size="sm" onClick={() => void pauseBells(false)}>
            Resume
          </Button>
        </div>
      ) : null}

      <div className="target-filter bells-toolbar">
        <div className="search-field">
          <Search size={14} />
          <Input
            placeholder="Search bells"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <select
          className="input"
          value={String(dayFilter)}
          onChange={(e) =>
            setDayFilter(
              e.target.value === 'today'
                ? 'today'
                : e.target.value === 'all'
                  ? 'all'
                  : Number(e.target.value),
            )
          }
          aria-label="Filter by weekday"
        >
          <option value="today">Today</option>
          <option value="all">Every day</option>
          {WEEKDAY_ORDER.map((d) => (
            <option key={d} value={d}>
              {DAY_LABELS[d]}
            </option>
          ))}
        </select>
        <select
          className="input"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          aria-label="Filter by status"
        >
          <option value="all">All bells</option>
          <option value="enabled">Enabled</option>
          <option value="disabled">Disabled</option>
        </select>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setLedgerOpen(true)}
          title="Occurrence ledger"
        >
          Ledger
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowGrid((v) => !v)}
          aria-expanded={showGrid}
        >
          Week grid <ChevronDown size={13} className={showGrid ? 'flip' : ''} />
        </Button>
      </div>

      {showGrid ? (
        <Card className="bells-grid-card">
          <div className="bells-grid">
            <div className="bells-grid-corner" />
            {WEEKDAY_ORDER.map((d) => (
              <div
                key={d}
                className={`bells-grid-head${d === todayWeekday ? ' today' : ''}`}
              >
                {DAY_LABELS[d]}
              </div>
            ))}
            {visible.length === 0 ? (
              <div className="bells-grid-empty">No bells match the filter.</div>
            ) : (
              visible.map((bell) => (
                <div key={bell.id} className="bells-grid-row">
                  <div className="bells-grid-time mono">{bell.timeOfDay}</div>
                  {WEEKDAY_ORDER.map((d) => (
                    <div key={d} className="bells-grid-cell">
                      {bell.daysOfWeek.includes(d) ? (
                        <span
                          className={`bells-grid-chip${bell.enabled ? '' : ' off'}`}
                          title={`${bell.name} · ${bell.timeOfDay}`}
                        >
                          {bell.name}
                        </span>
                      ) : null}
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
        </Card>
      ) : null}

      {bells.length === 0 ? (
        <div className="state state-empty state-fill">
          <div>
            <strong>No bells scheduled yet</strong>
            <p>
              Add a bell to ring a chime at a fixed wall-clock time on selected
              weekdays. Bells fire through the normal paging path, so they appear
              in History and the Monitor like any broadcast.
            </p>
            <Button size="sm" onClick={() => setEditing('new')} style={{ marginTop: 12 }}>
              <Plus size={13} /> Add the first bell
            </Button>
          </div>
        </div>
      ) : visible.length === 0 ? (
        <div className="state state-empty">
          <div>
            <strong>No bells match this filter</strong>
            <p>Clear the search or choose “Every day”.</p>
          </div>
        </div>
      ) : (
        <div className="bells-list">
          {visible.map((bell) => {
            const audio = bell.announcementId
              ? mediaById.get(bell.announcementId)
              : undefined;
            return (
              <Card
                key={bell.id}
                className={`bells-row${bell.enabled ? '' : ' off'}${
                  dueSoon(bell) ? ' due' : ''
                }`}
              >
                <div className="bells-row-time mono">
                  {bell.timeOfDay}
                  {dueSoon(bell) ? <span className="bells-due-dot" /> : null}
                </div>

                <div className="bells-row-main">
                  <div className="bells-row-title">
                    <b>{bell.name || 'Untitled bell'}</b>
                    {bell.todayStatus ? (
                      <Badge variant={bell.todayStatus === 'fired' ? 'default' : 'outline'}>
                        today: {bell.todayStatus}
                      </Badge>
                    ) : null}
                  </div>
                  <div className="bells-row-meta">
                    <span className="pill-label">{daySummary(bell.daysOfWeek)}</span>
                    {bell.dateFrom || bell.dateTo ? (
                      <span className="pill-label mono">
                        {bell.dateFrom || '…'} → {bell.dateTo || '…'}
                      </span>
                    ) : null}
                    {bell.zoneNames.length > 0 ? (
                      <span className="pill-label" title={bell.zoneNames.join(', ')}>
                        {bell.zoneNames.length === 1
                          ? bell.zoneNames[0]
                          : `${bell.zoneNames.length} zones`}
                      </span>
                    ) : null}
                    {bell.endpointIds.length > 0 ? (
                      <span className="pill-label">
                        +{bell.endpointIds.length} endpoint
                        {bell.endpointIds.length === 1 ? '' : 's'}
                      </span>
                    ) : null}
                    <span className="bells-audio" title={audio?.name ?? 'No audio'}>
                      {audio ? audio.name : bell.announcementName ?? 'No audio'}
                      {bell.beep ? ' · beep' : ''}
                    </span>
                  </div>
                </div>

                <div className="bells-row-when">
                  <span className="mono">{countdown(bell.nextAt)}</span>
                  <small>{bell.nextAt ? fmtClock(bell.nextAt) : 'not scheduled'}</small>
                </div>

                <div className="bells-row-actions">
                  <Switch
                    checked={bell.enabled}
                    onCheckedChange={(checked) => void setBellEnabled(bell.id, checked)}
                    aria-label={`Enable ${bell.name}`}
                  />
                  <button
                    type="button"
                    className="icon-link"
                    title="Ring now (test)"
                    onClick={() => void testBell(bell.id)}
                    disabled={!bell.announcementId}
                  >
                    <Play size={14} />
                  </button>
                  <button
                    type="button"
                    className="icon-link"
                    title="Edit"
                    onClick={() => setEditing(bell)}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    type="button"
                    className="icon-link"
                    title="Ledger"
                    onClick={() => {
                      setLedgerFor(bell);
                      setLedgerOpen(true);
                    }}
                  >
                    <BellRing size={14} />
                  </button>
                  <button
                    type="button"
                    className="icon-link danger"
                    title="Delete"
                    onClick={() => setConfirmDelete(bell)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {bellSkips.length > 0 ? (
        <div className="bells-skips-strip">
          <CalendarOff size={13} />
          <span>Upcoming skips:</span>
          {bellSkips.slice(0, 6).map((skip) => (
            <span key={skip.id} className="pill-label mono">
              {skip.date}
              {skip.bellName ? ` · ${skip.bellName}` : ' · all bells'}
              {skip.reason ? ` · ${skip.reason}` : ''}
              <button
                type="button"
                className="bells-skip-x"
                title="Remove skip"
                onClick={() => void removeBellSkip(skip.id)}
              >
                ×
              </button>
            </span>
          ))}
          {bellSkips.length > 6 ? (
            <button
              type="button"
              className="btn link"
              onClick={() => setSkipsOpen(true)}
            >
              +{bellSkips.length - 6} more
            </button>
          ) : null}
        </div>
      ) : null}

      {editing ? (
        <BellDialog
          bell={editing === 'new' ? null : editing}
          timezone={timezone}
          zones={zones}
          endpoints={endpoints}
          media={media}
          onClose={() => setEditing(null)}
        />
      ) : null}

      <BellLedger
        open={ledgerOpen}
        bell={ledgerFor}
        bells={bells}
        onClose={() => {
          setLedgerOpen(false);
          setLedgerFor(null);
        }}
      />

      <BellSkipsDialog
        open={skipsOpen}
        bells={bells}
        skips={bellSkips}
        onClose={() => setSkipsOpen(false)}
      />

      {confirmDelete ? (
        <div className="dialog-overlay" onClick={() => setConfirmDelete(null)}>
          <div
            className="dialog-content bells-confirm"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <h2 className="dialog-title">Delete “{confirmDelete.name}” ?</h2>
            <p className="dialog-description">
              The schedule and its upcoming occurrences are removed. Broadcast
              history is kept — History is the record of what actually rang.
            </p>
            <div className="dialog-footer">
              <Button variant="ghost" onClick={() => setConfirmDelete(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  void removeBell(confirmDelete.id);
                  setConfirmDelete(null);
                }}
              >
                Delete bell
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {paused ? (
        <div className="bells-paused-float">
          <Pause size={12} /> Bells paused
        </div>
      ) : null}
</div>
  );
};
