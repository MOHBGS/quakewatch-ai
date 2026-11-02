import { describe, expect, it } from "vitest";
import {
  applyFilters,
  buildCsv,
  defaultFilters,
  getDailyCounts,
  getMagnitudeCounts,
  isValidCoordinate,
  normalizeFeatureCollection,
  type EarthquakeEvent,
  type Filters,
} from "./domain";

const firstTimestamp = Date.UTC(2026, 10, 1, 10);
const feature = (
  id: string,
  longitude: number,
  latitude: number,
  magnitude: number,
  time: number,
  depth: number | null,
  place: string,
) => ({
  type: "Feature",
  id,
  geometry: { type: "Point", coordinates: [longitude, latitude, depth] },
  properties: {
    mag: magnitude,
    magType: "mb",
    place,
    time,
    url: `https://earthquake.usgs.gov/earthquakes/eventpage/${id}`,
    sig: 42,
  },
});

function event(
  id: string,
  magnitude: number,
  timeMs: number,
  depthKm: number | null,
  place: string,
): EarthquakeEvent {
  return {
    id,
    magnitude,
    magnitudeType: "mb",
    place,
    longitude: 77.2,
    latitude: 28.6,
    depthKm,
    time: new Date(timeMs).toISOString(),
    timeMs,
    url: `https://earthquake.usgs.gov/earthquakes/eventpage/${id}`,
    significance: 42,
  };
}

const allFilters: Filters = {
  region: "india",
  minMagnitude: 0,
  maxMagnitude: 10,
  minDepth: 0,
  maxDepth: 700,
  startDate: "2026-10-01",
  endDate: "2026-11-30",
  search: "",
};

describe("default filters", () => {
  it("restores the default ranges and dates while retaining the selected region", () => {
    expect(
      defaultFilters("global", new Date("2026-11-03T00:15:00.000Z")),
    ).toEqual({
      region: "global",
      minMagnitude: 0,
      maxMagnitude: 9.5,
      minDepth: 0,
      maxDepth: 700,
      startDate: "2026-10-05",
      endDate: "2026-11-03",
      search: "",
    });
  });
});

describe("USGS GeoJSON validation and normalization", () => {
  it("normalizes real GeoJSON points and deduplicates event identifiers", () => {
    const features = [
      feature("event-1", 77.2, 28.6, 4.2, firstTimestamp, 12.5, "Delhi, India"),
      feature("event-1", 77.2, 28.6, 4.2, firstTimestamp, 12.5, "Duplicate"),
    ];
    const events = normalizeFeatureCollection({
      type: "FeatureCollection",
      features,
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      id: "event-1",
      magnitude: 4.2,
      place: "Delhi, India",
      longitude: 77.2,
      latitude: 28.6,
      depthKm: 12.5,
      timeMs: firstTimestamp,
    });
  });

  it("drops invalid coordinates, missing magnitudes, and malformed events", () => {
    const invalid = [
      feature("bad-lon", 181, 28.6, 3, firstTimestamp, 1, "Invalid"),
      feature("bad-lat", 77, -91, 3, firstTimestamp, 1, "Invalid"),
      feature("bad-mag", 77, 28, Number.NaN, firstTimestamp, 1, "Invalid"),
      feature("bad-date", 77, 28, 3, Number.NaN, 1, "Invalid"),
      null,
    ];
    expect(
      normalizeFeatureCollection({ type: "FeatureCollection", features: invalid }),
    ).toEqual([]);
    expect(() => normalizeFeatureCollection({ type: "FeatureCollection" })).toThrow(
      /invalid GeoJSON/i,
    );
  });

  it("accepts valid coordinates at map boundaries and rejects out-of-range values", () => {
    expect(isValidCoordinate(-180, -90)).toBe(true);
    expect(isValidCoordinate(180, 90)).toBe(true);
    expect(isValidCoordinate(180.1, 0)).toBe(false);
    expect(isValidCoordinate(0, -90.1)).toBe(false);
    expect(isValidCoordinate(Number.NaN, 0)).toBe(false);
  });

  it("keeps unavailable depth and location explicitly unclassified", () => {
    const missing = feature("missing", 77, 28, 2, firstTimestamp, null, "");
    missing.properties.place = null as unknown as string;
    const events = normalizeFeatureCollection({
      type: "FeatureCollection",
      features: [missing],
    });
    expect(events[0]?.depthKm).toBeNull();
    expect(events[0]?.place).toBe("Unknown location");
  });
});

describe("earthquake filtering and analytics", () => {
  const events = [
    event("low", 1.2, firstTimestamp, 7, "Delhi, India"),
    event("strong", 4.5, firstTimestamp + 24 * 60 * 60 * 1000, 40, "Nepal"),
    event("deep", 3.2, firstTimestamp + 2 * 24 * 60 * 60 * 1000, 700, "Bay of Bengal"),
    event("unknown-depth", 2, firstTimestamp, null, "Assam"),
  ];

  it("filters by magnitude, depth, UTC dates, and case-insensitive place", () => {
    const filtered = applyFilters(events, {
      ...allFilters,
      minMagnitude: 3,
      maxMagnitude: 5,
      minDepth: 0,
      maxDepth: 100,
      search: "nep",
    });
    expect(filtered.map((item) => item.id)).toEqual(["strong"]);
  });

  it("excludes events outside the selected date range", () => {
    const filtered = applyFilters(events, {
      ...allFilters,
      startDate: "2026-11-02",
      endDate: "2026-11-02",
    });
    expect(filtered.map((item) => item.id)).toEqual(["strong"]);
  });

  it("produces daily and magnitude distributions from actual filtered records", () => {
    expect(getDailyCounts(events)).toEqual([
      { day: "2026-11-01", count: 2 },
      { day: "2026-11-02", count: 1 },
      { day: "2026-11-03", count: 1 },
    ]);
    expect(getMagnitudeCounts(events)).toEqual([
      { band: "< 2.0", count: 1 },
      { band: "2.0–2.9", count: 1 },
      { band: "3.0–3.9", count: 1 },
      { band: "4.0–4.9", count: 1 },
      { band: "5.0+", count: 0 },
    ]);
  });
});

describe("CSV export", () => {
  it("includes source and export time and escapes formula-like USGS text", () => {
    const malicious = event("event-1", 3, firstTimestamp, 9, "=IMPORTDATA(\"x\")");
    const csv = buildCsv([malicious], "2026-11-02T10:00:00.000Z");
    const rows = csv.split("\r\n");
    expect(rows[0]).toContain('"usgs_event_url"');
    expect(rows[1]).toContain(`"'=IMPORTDATA(""x"")"`);
    expect(rows[1]).toContain('"USGS"');
    expect(rows[1]).toContain('"2026-11-02T10:00:00.000Z"');
  });

  it("properly quotes commas and embedded quotation marks", () => {
    const csv = buildCsv(
      [event("comma", 2, firstTimestamp, 8, 'Foo, "bar" region')],
      "2026-11-02T10:00:00.000Z",
    );
    expect(csv).toContain('"Foo, ""bar"" region"');
  });
});
