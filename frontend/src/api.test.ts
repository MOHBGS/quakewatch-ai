import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchEarthquakes } from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
});

const samplePayload = {
  type: "FeatureCollection",
  metadata: { generated: 1_798_500_000_000 },
  features: [
    {
      type: "Feature",
      id: "us7000real",
      properties: {
        mag: 4.4,
        magType: "mb",
        time: Date.UTC(2026, 10, 1, 10),
        place: "20 km NE of Delhi, India",
        url: "https://earthquake.usgs.gov/earthquakes/eventpage/us7000real",
      },
      geometry: { type: "Point", coordinates: [77.2, 28.6, 11] },
    },
  ],
};

describe("live earthquake API adapter", () => {
  it("uses the official USGS India FDSN endpoint when no AWS API is configured", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(samplePayload), {
        status: 200,
        headers: { "content-type": "application/geo+json" },
      }),
    );
    vi.stubGlobal("fetch", fetch);
    const data = await fetchEarthquakes("india", "");
    const url = new URL(fetch.mock.calls[0]?.[0] as string);

    expect(url.hostname).toBe("earthquake.usgs.gov");
    expect(url.pathname).toBe("/fdsnws/event/1/query");
    expect(url.searchParams.get("minlatitude")).toBe("5");
    expect(url.searchParams.get("maxlatitude")).toBe("38");
    expect(url.searchParams.get("starttime")).toMatch(/T.*Z$/);
    expect(data.events).toHaveLength(1);
    expect(data.events[0]?.magnitude).toBe(4.4);
    expect(data.source).toContain("USGS live query");
  });

  it("fetches events from API Gateway when a public API base URL is configured", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          events: [
            {
              id: "us7000api",
              magnitude: 3,
              magnitude_type: "mb",
              place: "Assam",
              longitude: 92.4,
              latitude: 26.1,
              depth_km: 8,
              time_ms: Date.UTC(2026, 10, 1, 12),
              url: "https://earthquake.usgs.gov/earthquakes/eventpage/us7000api",
              significance: 30,
            },
          ],
          retrieved_at: "2026-11-02T10:00:00.000Z",
          data_source: "USGS catalog · scheduled S3 snapshot",
          region: "india",
          stale: false,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetch);
    const data = await fetchEarthquakes(
      "india",
      "https://api.example.test/prod/",
    );

    expect(fetch.mock.calls[0]?.[0]).toBe(
      "https://api.example.test/prod/events?region=india",
    );
    expect(data.events[0]).toMatchObject({
      id: "us7000api",
      latitude: 26.1,
      longitude: 92.4,
      magnitude: 3,
    });
    expect(data.retrievedAt).toBe("2026-11-02T10:00:00.000Z");
  });

  it("honors global selection and the caller's AbortSignal", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(samplePayload), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetch);
    const controller = new AbortController();
    await fetchEarthquakes("global", "", controller.signal);
    const url = new URL(fetch.mock.calls[0]?.[0] as string);
    expect(url.searchParams.has("minlatitude")).toBe(false);
    expect(fetch.mock.calls[0]?.[1].signal).toBe(controller.signal);
  });

  it("reports HTTP errors rather than replacing failed data with sample events", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 })),
    );
    await expect(fetchEarthquakes("india", "")).rejects.toThrow("HTTP 503");
  });

  it("reports invalid response JSON clearly", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("{", { status: 200, headers: { "content-type": "application/json" } }),
      ),
    );
    await expect(fetchEarthquakes("india", "")).rejects.toThrow(/invalid JSON/i);
  });
});
