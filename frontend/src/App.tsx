import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Download,
  ExternalLink,
  Globe2,
  MapPin,
  Radio,
  RefreshCw,
  Search,
  ShieldAlert,
  Waves,
  Zap,
} from "lucide-react";
import {
  CartesianGrid,
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useCallback, useEffect, useMemo, useState } from "react";
import EarthquakeMap from "./components/EarthquakeMap";
import { fetchEarthquakes } from "./api";
import {
  applyFilters,
  buildCsv,
  getDailyCounts,
  getMagnitudeCounts,
  type Dataset,
  type EarthquakeEvent,
  type Filters,
  type Region,
} from "./domain";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim() ?? "";
const POLL_INTERVAL_MS = 60_000;

function utcDate(daysAgo = 0): string {
  return new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

function initialFilters(): Filters {
  const query = new URLSearchParams(window.location.search);
  const readNumber = (name: string, fallback: number) => {
    const raw = query.get(name);
    if (raw === null || raw.trim() === "") return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  return {
    region: query.get("region") === "global" ? "global" : "india",
    minMagnitude: readNumber("minMag", 0),
    maxMagnitude: readNumber("maxMag", 9.5),
    minDepth: readNumber("minDepth", 0),
    maxDepth: readNumber("maxDepth", 700),
    startDate: query.get("start") ?? utcDate(29),
    endDate: query.get("end") ?? utcDate(),
    search: query.get("q") ?? "",
  };
}

function timeAgo(value: string): string {
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function updateFilterUrl(filters: Filters): void {
  const query = new URLSearchParams();
  query.set("region", filters.region);
  query.set("minMag", filters.minMagnitude.toString());
  query.set("maxMag", filters.maxMagnitude.toString());
  query.set("minDepth", filters.minDepth.toString());
  query.set("maxDepth", filters.maxDepth.toString());
  if (filters.startDate) query.set("start", filters.startDate);
  if (filters.endDate) query.set("end", filters.endDate);
  if (filters.search.trim()) query.set("q", filters.search.trim());
  window.history.replaceState(null, "", `${window.location.pathname}?${query}`);
}

function downloadCsv(events: EarthquakeEvent[]): void {
  const csv = buildCsv(events, new Date().toISOString());
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `quakewatch-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function formatTime(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(value);
}

function magnitudeColor(magnitude: number): string {
  if (magnitude >= 5) return "text-rose-300";
  if (magnitude >= 4) return "text-orange-300";
  if (magnitude >= 3) return "text-amber-300";
  return "text-emerald-300";
}

interface KpiCardProps {
  label: string;
  value: string;
  detail: string;
  icon: typeof Activity;
  tone: "cyan" | "amber" | "green" | "rose";
}

function KpiCard({ label, value, detail, icon: Icon, tone }: KpiCardProps) {
  const toneClass = {
    cyan: "text-cyan-300 bg-cyan-400/10 border-cyan-300/15",
    amber: "text-amber-300 bg-amber-400/10 border-amber-300/15",
    green: "text-emerald-300 bg-emerald-400/10 border-emerald-300/15",
    rose: "text-rose-300 bg-rose-400/10 border-rose-300/15",
  }[tone];
  return (
    <article className="panel flex min-w-0 items-center justify-between p-4 sm:p-5">
      <div className="min-w-0">
        <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">
          {label}
        </div>
        <div className="text-[27px] font-semibold leading-none tracking-tight text-slate-100">
          {value}
        </div>
        <div className="mt-2 truncate text-[11px] text-slate-500">{detail}</div>
      </div>
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl border ${toneClass}`}>
        <Icon size={17} />
      </span>
    </article>
  );
}

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="grid h-full min-h-40 place-items-center text-center">
      <p className="max-w-56 text-xs leading-5 text-slate-500">{label}</p>
    </div>
  );
}

export default function App() {
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [sortByMagnitude, setSortByMagnitude] = useState(false);

  const refresh = useCallback(
    async (signal?: AbortSignal, showRefreshing = false) => {
      if (showRefreshing) setIsRefreshing(true);
      setApiError(null);
      try {
        const latest = await fetchEarthquakes(filters.region, apiBaseUrl, signal);
        setDataset(latest);
        setIsLoading(false);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setDataset((previous) =>
          previous ? { ...previous, stale: true } : null,
        );
        setApiError(
          error instanceof Error
            ? error.message
            : "Could not load live earthquake data.",
        );
        setIsLoading(false);
      } finally {
        setIsRefreshing(false);
      }
    },
    [filters.region],
  );

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    void refresh(controller.signal);
    const timer = window.setInterval(
      () => void refresh(undefined, true),
      POLL_INTERVAL_MS,
    );
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [refresh]);

  useEffect(() => {
    updateFilterUrl(filters);
  }, [filters]);

  const filteredEvents = useMemo(
    () => applyFilters(dataset?.events ?? [], filters),
    [dataset?.events, filters],
  );
  const sortedEvents = useMemo(
    () =>
      [...filteredEvents].sort((a, b) =>
        sortByMagnitude
          ? b.magnitude - a.magnitude
          : b.timeMs - a.timeMs,
      ),
    [filteredEvents, sortByMagnitude],
  );
  const magnitudeCounts = useMemo(
    () => getMagnitudeCounts(filteredEvents),
    [filteredEvents],
  );
  const dailyCounts = useMemo(() => getDailyCounts(filteredEvents), [filteredEvents]);
  const averageMagnitude = filteredEvents.length
    ? filteredEvents.reduce((total, event) => total + event.magnitude, 0) /
      filteredEvents.length
    : null;
  const knownDepths = filteredEvents
    .map((event) => event.depthKm)
    .filter((depth): depth is number => depth !== null);
  const averageDepth = knownDepths.length
    ? knownDepths.reduce((total, depth) => total + depth, 0) / knownDepths.length
    : null;
  const highestMagnitude = filteredEvents.reduce<number | null>(
    (highest, event) => Math.max(highest ?? -Infinity, event.magnitude),
    null,
  );
  const lastDayCount = filteredEvents.filter(
    (event) => Date.now() - event.timeMs <= 24 * 60 * 60 * 1000,
  ).length;

  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };
  const resetFilters = () => {
    setFilters({
      ...initialFilters(),
      region: filters.region,
    });
  };

  return (
    <div className="min-h-screen bg-[#07111b] text-slate-100">
      <header className="sticky top-0 z-30 border-b border-white/[0.07] bg-[#0a1521]/95 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1520px] items-center justify-between gap-3 px-4 py-3.5 sm:px-7 lg:px-10">
          <a className="flex items-center gap-3" href="#" aria-label="QuakeWatch AI home">
            <span className="grid h-10 w-10 place-items-center rounded-xl border border-orange-300/20 bg-orange-400/10 text-orange-300 shadow-[0_0_25px_rgba(251,146,60,.08)]">
              <Waves size={21} strokeWidth={2} />
            </span>
            <span>
              <span className="block text-[15px] font-semibold tracking-tight text-slate-100">
                QuakeWatch <span className="text-cyan-300">AI</span>
              </span>
              <span className="block text-[10px] tracking-wide text-slate-500">
                REAL-TIME SEISMIC INTELLIGENCE
              </span>
            </span>
          </a>
          <div className="flex items-center gap-2 sm:gap-4">
            <span className="hidden text-right text-[11px] text-slate-500 sm:block">
              <span className="block text-[9px] uppercase tracking-[0.12em] text-slate-600">
                Last catalog update
              </span>
              <span className="text-slate-300">
                {dataset ? `${timeAgo(dataset.retrievedAt)} · UTC` : "Waiting for live data"}
              </span>
            </span>
            <span
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-semibold ${
                apiError
                  ? "border-rose-400/20 bg-rose-400/10 text-rose-300"
                  : dataset?.stale
                    ? "border-amber-400/20 bg-amber-400/10 text-amber-200"
                    : "border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
              }`}
              role="status"
              aria-live="polite"
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  apiError
                    ? "bg-rose-400"
                    : dataset?.stale
                      ? "bg-amber-300"
                      : "bg-emerald-400 pulse-dot"
                }`}
              />
              {apiError ? "Feed unavailable" : dataset?.stale ? "Cached data" : dataset ? "Live feed" : "Connecting"}
            </span>
            <button
              type="button"
              className="icon-button"
              onClick={() => void refresh(undefined, true)}
              aria-label="Refresh earthquake data"
              title="Refresh earthquake data"
              disabled={isRefreshing}
            >
              <RefreshCw size={15} className={isRefreshing ? "animate-spin" : ""} />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1520px] space-y-5 px-4 py-6 sm:px-7 sm:py-8 lg:px-10">
        <section className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-300/80">
              <span className="h-px w-5 bg-cyan-400/50" />
              Earthquake intelligence platform
            </div>
            <h1 className="text-[26px] font-semibold tracking-tight text-white sm:text-[30px]">
              Seismic activity overview
            </h1>
            <p className="mt-1.5 max-w-xl text-xs leading-5 text-slate-500 sm:text-sm">
              Explore recorded earthquakes from the official USGS catalog. This
              dashboard informs; it does not predict earthquakes.
            </p>
          </div>
          <a
            className="inline-flex w-fit items-center gap-2 text-xs text-slate-400 transition hover:text-cyan-300"
            href="https://earthquake.usgs.gov/fdsnws/event/1/"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Radio size={14} className="text-cyan-300" />
            Official USGS earthquake catalog
            <ExternalLink size={12} />
          </a>
        </section>

        {apiError && (
          <div
            role="alert"
            className="flex flex-col gap-3 rounded-xl border border-rose-300/20 bg-rose-950/30 px-4 py-3.5 text-sm sm:flex-row sm:items-center sm:justify-between"
          >
            <span className="flex items-center gap-2.5 text-rose-100">
              <ShieldAlert className="shrink-0 text-rose-300" size={17} />
              {apiError} No sample or simulated events are being shown.
            </span>
            <button
              type="button"
              className="self-start rounded-lg border border-rose-300/20 px-3 py-2 text-xs text-rose-100 transition hover:bg-rose-300/10 sm:self-auto"
              onClick={() => void refresh(undefined, true)}
            >
              Retry live feed
            </button>
          </div>
        )}
        {dataset?.truncated && (
          <div className="rounded-lg border border-amber-300/15 bg-amber-300/[0.05] px-4 py-2.5 text-xs text-amber-100/80">
            This global catalog response is capped at 2,000 recent events. Narrow
            the date range or switch to the India view for a regional query.
          </div>
        )}

        <section aria-label="Earthquake statistics" className="grid grid-cols-2 gap-3 xl:grid-cols-5">
          <KpiCard
            label="Recorded events"
            value={isLoading && !dataset ? "—" : filteredEvents.length.toLocaleString()}
            detail={filters.region === "india" ? "India & surrounding region" : "Global · USGS catalog"}
            icon={Activity}
            tone="cyan"
          />
          <KpiCard
            label="Strongest event"
            value={highestMagnitude === null ? "—" : `M ${highestMagnitude.toFixed(1)}`}
            detail="Filtered period"
            icon={Zap}
            tone="amber"
          />
          <KpiCard
            label="Mean magnitude"
            value={averageMagnitude === null ? "—" : averageMagnitude.toFixed(2)}
            detail="All recorded events"
            icon={Waves}
            tone="green"
          />
          <KpiCard
            label="Mean depth"
            value={averageDepth === null ? "—" : `${averageDepth.toFixed(0)} km`}
            detail={`${knownDepths.length.toLocaleString()} events with depth`}
            icon={ArrowDownRight}
            tone="cyan"
          />
          <KpiCard
            label="Last 24 hours"
            value={lastDayCount.toLocaleString()}
            detail="Recorded in the selected region"
            icon={Radio}
            tone="rose"
          />
        </section>

        <section className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(288px,0.8fr)]">
          <article className="panel p-4 sm:p-5">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2 text-[14px] font-semibold text-slate-100">
                  <MapPin size={16} className="text-orange-300" />
                  Earthquake activity map
                </h2>
                <p className="mt-1 text-[11px] text-slate-500">
                  {filteredEvents.length.toLocaleString()} filtered events · select
                  markers to view verified event details
                </p>
              </div>
              <label className="inline-flex items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.025] px-3 py-2 text-[11px] text-slate-300">
                <Globe2 size={13} className="text-cyan-300" />
                <span className="sr-only">Map region</span>
                <select
                  className="cursor-pointer bg-transparent text-inherit outline-none"
                  value={filters.region}
                  onChange={(event) => {
                    setDataset(null);
                    setApiError(null);
                    setSelectedEventId(null);
                    setFilter("region", event.target.value as Region);
                  }}
                  aria-label="Map region"
                >
                  <option value="india">India & surroundings</option>
                  <option value="global">Global</option>
                </select>
              </label>
            </div>
            <div className="flex flex-col gap-3">
              <EarthquakeMap
                events={filteredEvents}
                region={filters.region}
                selectedEventId={selectedEventId}
                onSelectEvent={setSelectedEventId}
              />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[10px] text-slate-400">
                  <span className="inline-flex items-center gap-1.5"><i className="legend-dot bg-emerald-400" />M &lt; 2</span>
                  <span className="inline-flex items-center gap-1.5"><i className="legend-dot bg-amber-400" />M 2–3.9</span>
                  <span className="inline-flex items-center gap-1.5"><i className="legend-dot bg-orange-400" />M 4–4.9</span>
                  <span className="inline-flex items-center gap-1.5"><i className="legend-dot bg-rose-400" />M 5+</span>
                  <span className="inline-flex items-center gap-1.5"><i className="legend-dot cluster-dot" />Cluster</span>
                </div>
                <span className="text-[10px] text-slate-600">Coordinates · WGS 84</span>
              </div>
            </div>
          </article>

          <aside className="space-y-4">
            <article className="panel p-4 sm:p-5">
              <div className="mb-5 flex items-center justify-between">
                <div>
                  <h2 className="text-[14px] font-semibold text-slate-100">Activity filters</h2>
                  <p className="mt-1 text-[10px] text-slate-500">Shareable as map URL parameters</p>
                </div>
                <button
                  type="button"
                  onClick={resetFilters}
                  className="rounded-md px-2 py-1 text-[10px] font-medium text-cyan-300 transition hover:bg-cyan-300/10"
                >
                  Reset
                </button>
              </div>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <label className="space-y-1.5 text-[10px] text-slate-500">
                    From (UTC)
                    <input
                      type="date"
                      className="filter-input"
                      value={filters.startDate}
                      max={filters.endDate || undefined}
                      onChange={(event) => setFilter("startDate", event.target.value)}
                    />
                  </label>
                  <label className="space-y-1.5 text-[10px] text-slate-500">
                    To (UTC)
                    <input
                      type="date"
                      className="filter-input"
                      value={filters.endDate}
                      min={filters.startDate || undefined}
                      max={utcDate()}
                      onChange={(event) => setFilter("endDate", event.target.value)}
                    />
                  </label>
                </div>
                <div>
                  <div className="mb-1.5 flex items-center justify-between text-[10px] text-slate-500">
                    <span>Magnitude</span>
                    <span className="text-slate-300">{filters.minMagnitude.toFixed(1)} – {filters.maxMagnitude.toFixed(1)}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="sr-only" htmlFor="min-magnitude">Minimum magnitude</label>
                    <input
                      id="min-magnitude"
                      aria-label="Minimum magnitude"
                      className="filter-input"
                      type="number"
                      min="-2"
                      max={filters.maxMagnitude}
                      step="0.1"
                      value={filters.minMagnitude}
                      onChange={(event) => setFilter("minMagnitude", Number(event.target.value))}
                    />
                    <label className="sr-only" htmlFor="max-magnitude">Maximum magnitude</label>
                    <input
                      id="max-magnitude"
                      aria-label="Maximum magnitude"
                      className="filter-input"
                      type="number"
                      min={filters.minMagnitude}
                      max="10"
                      step="0.1"
                      value={filters.maxMagnitude}
                      onChange={(event) => setFilter("maxMagnitude", Number(event.target.value))}
                    />
                  </div>
                </div>
                <div>
                  <div className="mb-1.5 flex items-center justify-between text-[10px] text-slate-500">
                    <span>Depth</span>
                    <span className="text-slate-300">{filters.minDepth} – {filters.maxDepth} km</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="sr-only" htmlFor="min-depth">Minimum depth</label>
                    <input
                      id="min-depth"
                      aria-label="Minimum depth"
                      className="filter-input"
                      type="number"
                      min="0"
                      max={filters.maxDepth}
                      value={filters.minDepth}
                      onChange={(event) => setFilter("minDepth", Math.max(0, Number(event.target.value)))}
                    />
                    <label className="sr-only" htmlFor="max-depth">Maximum depth</label>
                    <input
                      id="max-depth"
                      aria-label="Maximum depth"
                      className="filter-input"
                      type="number"
                      min={filters.minDepth}
                      max="750"
                      value={filters.maxDepth}
                      onChange={(event) => setFilter("maxDepth", Math.max(0, Number(event.target.value)))}
                    />
                  </div>
                </div>
                <label className="block space-y-1.5 text-[10px] text-slate-500">
                  Search event location
                  <span className="relative block">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={13} />
                    <input
                      className="filter-input pl-9"
                      type="search"
                      placeholder="Try Nepal, Assam, Bay of Bengal..."
                      value={filters.search}
                      onChange={(event) => setFilter("search", event.target.value)}
                    />
                  </span>
                </label>
              </div>
            </article>

            <article className="panel p-4 sm:p-5">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-[14px] font-semibold text-slate-100">Magnitude profile</h2>
                  <p className="mt-1 text-[10px] text-slate-500">Observed events grouped by magnitude</p>
                </div>
                <span className="grid h-8 w-8 place-items-center rounded-lg border border-cyan-300/10 bg-cyan-300/[0.06] text-cyan-300">
                  <Activity size={15} />
                </span>
              </div>
              {filteredEvents.length ? (
                <ResponsiveContainer width="100%" height={185}>
                  <BarChart data={magnitudeCounts} margin={{ top: 4, right: 3, left: -22, bottom: 0 }}>
                    <CartesianGrid stroke="#ffffff10" vertical={false} strokeDasharray="3 4" />
                    <XAxis dataKey="band" tick={{ fill: "#8292a5", fontSize: 9 }} axisLine={false} tickLine={false} />
                    <YAxis allowDecimals={false} tick={{ fill: "#697a8e", fontSize: 9 }} axisLine={false} tickLine={false} />
                    <Tooltip
                      contentStyle={{ background: "#111e2c", border: "1px solid #ffffff1a", borderRadius: 10, fontSize: 11 }}
                      labelStyle={{ color: "#e5edf6" }}
                      itemStyle={{ color: "#63d1cc" }}
                    />
                    <Bar dataKey="count" name="Recorded events" radius={[4, 4, 0, 0]} maxBarSize={38}>
                      {magnitudeCounts.map((entry) => (
                        <Cell
                          key={entry.band}
                          fill={
                            entry.band === "5.0+"
                              ? "#f36a58"
                              : entry.band === "4.0–4.9"
                                ? "#f3954b"
                                : entry.band === "3.0–3.9"
                                  ? "#e4b54e"
                                  : "#32b990"
                          }
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <EmptyChart label={isLoading ? "Loading verified observations…" : "No recorded events match these filters."} />
              )}
            </article>
          </aside>
        </section>

        <section className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(288px,0.75fr)]">
          <article className="panel p-4 sm:p-5">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-[14px] font-semibold text-slate-100">Event timeline</h2>
                <p className="mt-1 text-[10px] text-slate-500">Daily USGS event counts · UTC</p>
              </div>
              <span className="inline-flex items-center gap-1.5 text-[10px] text-slate-500">
                <span className="h-1.5 w-1.5 rounded-full bg-cyan-300" />
                Observed events only
              </span>
            </div>
            {dailyCounts.length ? (
              <ResponsiveContainer width="100%" height={190}>
                <BarChart data={dailyCounts} margin={{ top: 6, right: 6, left: -22, bottom: 0 }}>
                  <CartesianGrid stroke="#ffffff10" vertical={false} strokeDasharray="3 4" />
                  <XAxis
                    dataKey="day"
                    tick={{ fill: "#8292a5", fontSize: 9 }}
                    axisLine={false}
                    tickLine={false}
                    minTickGap={20}
                    tickFormatter={(day: string) => {
                      const [, month, date] = day.split("-");
                      return `${month}/${date}`;
                    }}
                  />
                  <YAxis allowDecimals={false} tick={{ fill: "#697a8e", fontSize: 9 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{ background: "#111e2c", border: "1px solid #ffffff1a", borderRadius: 10, fontSize: 11 }}
                    labelStyle={{ color: "#e5edf6" }}
                    itemStyle={{ color: "#63d1cc" }}
                  />
                  <Bar dataKey="count" name="Recorded events" fill="#35b8b2" radius={[4, 4, 0, 0]} maxBarSize={24} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart label={isLoading ? "Loading verified observations…" : "No daily activity to show for this date range."} />
            )}
          </article>

          <article className="panel p-4 sm:p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-[14px] font-semibold text-slate-100">Live event feed</h2>
                <p className="mt-1 text-[10px] text-slate-500">Most recent matched catalog entries</p>
              </div>
              {dataset && (
                <span className="rounded-md border border-white/[0.08] px-2 py-1 text-[10px] text-slate-400">
                  {sortedEvents.length} shown
                </span>
              )}
            </div>
            <div className="max-h-[235px] space-y-2 overflow-y-auto pr-1">
              {sortedEvents.slice(0, 7).map((event) => (
                <button
                  key={event.id}
                  type="button"
                  onClick={() => setSelectedEventId(event.id)}
                  className="group flex w-full items-start gap-3 rounded-xl border border-white/[0.055] bg-white/[0.018] p-3 text-left transition hover:border-cyan-300/20 hover:bg-cyan-300/[0.035]"
                >
                  <span className={`mt-0.5 min-w-12 rounded-md border border-white/[0.08] bg-white/[0.035] px-2 py-1 text-center text-[11px] font-semibold ${magnitudeColor(event.magnitude)}`}>
                    M {event.magnitude.toFixed(1)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px] font-medium text-slate-200 group-hover:text-white">{event.place}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[9px] text-slate-500">
                      <span>{formatTime(event.timeMs)}</span>
                      <span>·</span>
                      <span>{event.depthKm === null ? "Depth unknown" : `${event.depthKm.toFixed(1)} km`}</span>
                    </span>
                  </span>
                  <ArrowUpRight size={13} className="mt-1 shrink-0 text-slate-600 transition group-hover:text-cyan-300" />
                </button>
              ))}
              {!isLoading && sortedEvents.length === 0 && (
                <EmptyChart label={apiError ? "The live feed is unavailable. Try refreshing." : "No recorded events match the active filters."} />
              )}
              {isLoading && !dataset && (
                <div className="rounded-lg border border-white/[0.05] p-4 text-center text-xs text-slate-500">
                  Connecting to the verified USGS catalog…
                </div>
              )}
            </div>
          </article>
        </section>

        <section className="panel overflow-hidden">
          <div className="flex flex-col justify-between gap-3 border-b border-white/[0.06] px-4 py-4 sm:flex-row sm:items-center sm:px-5">
            <div>
              <h2 className="text-[14px] font-semibold text-slate-100">Earthquake events</h2>
              <p className="mt-1 text-[10px] text-slate-500">Real catalog records · event source links open the official USGS entry</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="icon-button"
                onClick={() => setSortByMagnitude((current) => !current)}
                aria-label={sortByMagnitude ? "Sort by latest time" : "Sort by highest magnitude"}
                title={sortByMagnitude ? "Sort by latest time" : "Sort by highest magnitude"}
              >
                <Activity size={15} />
                <span className="text-[10px]">{sortByMagnitude ? "Highest magnitude" : "Newest first"}</span>
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-lg border border-cyan-300/20 bg-cyan-300/[0.08] px-3 py-2 text-[11px] font-medium text-cyan-100 transition hover:bg-cyan-300/[0.14] disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => downloadCsv(sortedEvents)}
                disabled={sortedEvents.length === 0}
              >
                <Download size={14} />
                Export CSV
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-[700px] w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-white/[0.05] text-[9px] font-medium uppercase tracking-[0.12em] text-slate-500">
                  <th scope="col" className="px-5 py-3">Recorded time</th>
                  <th scope="col" className="px-4 py-3">Magnitude</th>
                  <th scope="col" className="px-4 py-3">Event location</th>
                  <th scope="col" className="px-4 py-3">Depth</th>
                  <th scope="col" className="px-5 py-3 text-right">Source</th>
                </tr>
              </thead>
              <tbody>
                {sortedEvents.slice(0, 12).map((event) => (
                  <tr
                    key={event.id}
                    className={`border-b border-white/[0.04] text-[11px] last:border-0 transition hover:bg-white/[0.025] ${
                      selectedEventId === event.id ? "bg-cyan-300/[0.035]" : ""
                    }`}
                  >
                    <td className="whitespace-nowrap px-5 py-3 text-slate-400">{formatTime(event.timeMs)}</td>
                    <td className={`whitespace-nowrap px-4 py-3 font-semibold ${magnitudeColor(event.magnitude)}`}>M {event.magnitude.toFixed(1)}</td>
                    <td className="max-w-[360px] truncate px-4 py-3 text-slate-200" title={event.place}>{event.place}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-400">{event.depthKm === null ? "—" : `${event.depthKm.toFixed(1)} km`}</td>
                    <td className="whitespace-nowrap px-5 py-3 text-right">
                      <a
                        className="inline-flex items-center gap-1 text-[10px] text-cyan-300 hover:text-cyan-100"
                        href={event.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        USGS <ExternalLink size={10} />
                      </a>
                    </td>
                  </tr>
                ))}
                {sortedEvents.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-5 py-10 text-center text-xs text-slate-500">
                      {isLoading ? "Connecting to USGS…" : apiError ? "Live event data is unavailable. No sample data is displayed." : "No events match these filters."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {sortedEvents.length > 12 && (
            <div className="border-t border-white/[0.05] px-5 py-3 text-[10px] text-slate-500">
              Showing the 12 most relevant of {sortedEvents.length.toLocaleString()} matching events. Export CSV for the complete filtered dataset.
            </div>
          )}
        </section>

        <footer className="flex flex-col justify-between gap-2 border-t border-white/[0.06] pt-4 text-[10px] text-slate-600 sm:flex-row sm:items-center">
          <span>
            Data: <a className="text-slate-400 hover:text-cyan-300" href="https://earthquake.usgs.gov/fdsnws/event/1/" target="_blank" rel="noopener noreferrer">USGS Earthquake Catalog</a>
            {" "}· Updated {dataset ? formatTime(Date.parse(dataset.retrievedAt)) : "when the feed is available"} · All times UTC
          </span>
          <span className="flex items-center gap-1.5">
            <ShieldAlert size={11} />
            Informational only — not an earthquake early-warning service
          </span>
        </footer>
        {dataset && (
          <p className="sr-only" aria-live="polite">
            {dataset.events.length} real events loaded from {dataset.source}.
          </p>
        )}
      </main>
      <span className="sr-only">Live earthquake feed · {dataset?.source ?? "waiting for USGS"}</span>
    </div>
  );
}
