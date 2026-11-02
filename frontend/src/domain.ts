export type Region = "india" | "global";

export interface EarthquakeEvent {
  id: string;
  magnitude: number;
  magnitudeType: string | null;
  place: string;
  longitude: number;
  latitude: number;
  depthKm: number | null;
  time: string;
  timeMs: number;
  url: string;
  significance: number | null;
}

export interface Dataset {
  events: EarthquakeEvent[];
  retrievedAt: string;
  source: string;
  stale: boolean;
  truncated: boolean;
  region: Region;
}

export interface Filters {
  region: Region;
  minMagnitude: number;
  maxMagnitude: number;
  minDepth: number;
  maxDepth: number;
  startDate: string;
  endDate: string;
  search: string;
}

export function defaultFilters(
  region: Region = "india",
  now: Date = new Date(),
): Filters {
  const endDate = now.toISOString().slice(0, 10);
  const startDate = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  return {
    region,
    minMagnitude: 0,
    maxMagnitude: 9.5,
    minDepth: 0,
    maxDepth: 700,
    startDate,
    endDate,
    search: "",
  };
}

export const INDIA_BOUNDS = {
  south: 5,
  north: 38,
  west: 65,
  east: 100,
} as const;

export function isValidCoordinate(longitude: unknown, latitude: unknown): boolean {
  return (
    typeof longitude === "number" &&
    Number.isFinite(longitude) &&
    longitude >= -180 &&
    longitude <= 180 &&
    typeof latitude === "number" &&
    Number.isFinite(latitude) &&
    latitude >= -90 &&
    latitude <= 90
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function normalizeFeatureCollection(payload: unknown): EarthquakeEvent[] {
  if (!isRecord(payload) || !Array.isArray(payload.features)) {
    throw new Error("USGS returned an invalid GeoJSON feature collection.");
  }

  const seen = new Set<string>();
  const normalized: EarthquakeEvent[] = [];

  for (const candidate of payload.features) {
    if (!isRecord(candidate)) continue;

    const properties = isRecord(candidate.properties)
      ? candidate.properties
      : {};
    const geometry = isRecord(candidate.geometry) ? candidate.geometry : {};
    const coordinates = Array.isArray(geometry.coordinates)
      ? geometry.coordinates
      : [];
    const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
    const [longitude, latitude, rawDepth] = coordinates;
    const magnitude = properties.mag;
    const timeMs = properties.time;

    if (
      !id ||
      seen.has(id) ||
      geometry.type !== "Point" ||
      !isValidCoordinate(longitude, latitude) ||
      typeof magnitude !== "number" ||
      !Number.isFinite(magnitude) ||
      typeof timeMs !== "number" ||
      !Number.isFinite(timeMs) ||
      !Number.isFinite(new Date(timeMs).getTime())
    ) {
      continue;
    }

    const depthKm =
      typeof rawDepth === "number" && Number.isFinite(rawDepth)
        ? rawDepth
        : null;
    const rawPlace = properties.place;
    const rawMagnitudeType = properties.magType;
    const rawUrl = properties.url;
    let usgsEventUrl: string | null = null;
    if (typeof rawUrl === "string") {
      try {
        const parsedUrl = new URL(rawUrl);
        if (
          parsedUrl.protocol === "https:" &&
          parsedUrl.hostname === "earthquake.usgs.gov" &&
          !parsedUrl.port
        ) {
          usgsEventUrl = parsedUrl.toString();
        }
      } catch {
        usgsEventUrl = null;
      }
    }

    seen.add(id);
    normalized.push({
      id,
      magnitude,
      magnitudeType:
        typeof rawMagnitudeType === "string" ? rawMagnitudeType : null,
      place:
        typeof rawPlace === "string" && rawPlace.trim()
          ? rawPlace.trim()
          : "Unknown location",
      longitude,
      latitude,
      depthKm,
      time: new Date(timeMs).toISOString(),
      timeMs,
      url:
        usgsEventUrl ??
        `https://earthquake.usgs.gov/earthquakes/eventpage/${encodeURIComponent(id)}`,
      significance:
        typeof properties.sig === "number" && Number.isFinite(properties.sig)
          ? properties.sig
          : null,
    });
  }

  return normalized;
}

export function applyFilters(
  events: EarthquakeEvent[],
  filters: Filters,
): EarthquakeEvent[] {
  const search = filters.search.trim().toLocaleLowerCase();
  return events.filter((event) => {
    const utcDate = new Date(event.timeMs).toISOString().slice(0, 10);
    return (
      event.magnitude >= filters.minMagnitude &&
      event.magnitude <= filters.maxMagnitude &&
      (event.depthKm === null ||
        (event.depthKm >= filters.minDepth && event.depthKm <= filters.maxDepth)) &&
      (!filters.startDate || utcDate >= filters.startDate) &&
      (!filters.endDate || utcDate <= filters.endDate) &&
      (!search || event.place.toLocaleLowerCase().includes(search))
    );
  });
}

export function magnitudeBand(magnitude: number): string {
  if (magnitude < 2) return "< 2.0";
  if (magnitude < 3) return "2.0–2.9";
  if (magnitude < 4) return "3.0–3.9";
  if (magnitude < 5) return "4.0–4.9";
  return "5.0+";
}

export interface MagnitudeCount {
  band: string;
  count: number;
}

export function getMagnitudeCounts(events: EarthquakeEvent[]): MagnitudeCount[] {
  const bands = ["< 2.0", "2.0–2.9", "3.0–3.9", "4.0–4.9", "5.0+"];
  const counts = new Map(bands.map((band) => [band, 0]));
  for (const event of events) {
    const band = magnitudeBand(event.magnitude);
    counts.set(band, (counts.get(band) ?? 0) + 1);
  }
  return bands.map((band) => ({ band, count: counts.get(band) ?? 0 }));
}

export interface DailyCount {
  day: string;
  count: number;
}

export function getDailyCounts(events: EarthquakeEvent[]): DailyCount[] {
  const counts = new Map<string, number>();
  for (const event of events) {
    const day = new Date(event.timeMs).toISOString().slice(0, 10);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([day, count]) => ({ day, count }));
}

function csvCell(value: string | number | null): string {
  let text = value === null ? "" : String(value);
  if (typeof value === "string" && /^[\u0000-\u0020]*[=+\-@]/.test(text)) {
    text = `'${text}`;
  }
  return `"${text.replaceAll('"', '""')}"`;
}

export function buildCsv(events: EarthquakeEvent[], exportedAt: string): string {
  const headings = [
    "event_id",
    "time_utc",
    "magnitude",
    "magnitude_type",
    "place",
    "longitude",
    "latitude",
    "depth_km",
    "usgs_event_url",
    "data_source",
    "exported_at_utc",
  ];
  const rows = events.map((event) =>
    [
      event.id,
      event.time,
      event.magnitude,
      event.magnitudeType,
      event.place,
      event.longitude,
      event.latitude,
      event.depthKm,
      event.url,
      "USGS",
      exportedAt,
    ]
      .map(csvCell)
      .join(","),
  );
  return [headings.map(csvCell).join(","), ...rows].join("\r\n");
}
