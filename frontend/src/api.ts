import {
  normalizeFeatureCollection,
  type Dataset,
  type Region,
} from "./domain";

const INDIA_QUERY =
  "minlatitude=5&maxlatitude=38&minlongitude=65&maxlongitude=100";
const LIVE_QUERY_URL =
  "https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&limit=2000&orderby=time";
const REQUEST_TIMEOUT_MS = 10_000;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function fetchJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const requestController = new AbortController();
  const abortFromCaller = () => requestController.abort(signal?.reason);
  if (signal?.aborted) abortFromCaller();
  else signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = setTimeout(() => requestController.abort(), REQUEST_TIMEOUT_MS);

  try {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Accept: "application/geo+json, application/json" },
        signal: requestController.signal,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      if (requestController.signal.aborted) {
        throw new Error("The earthquake service request timed out.");
      }
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      throw new Error("The live earthquake service could not be reached.");
    }

    if (!response.ok) {
      throw new Error(`The earthquake service returned HTTP ${response.status}.`);
    }
    try {
      return await response.json();
    } catch (error) {
      if (signal?.aborted) throw error;
      if (requestController.signal.aborted) {
        throw new Error("The earthquake service request timed out.");
      }
      throw new Error("The earthquake service returned invalid JSON.");
    }
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abortFromCaller);
  }
}

export async function fetchEarthquakes(
  region: Region,
  apiBaseUrl: string,
  signal?: AbortSignal,
): Promise<Dataset> {
  const normalizedBase = apiBaseUrl.replace(/\/+$/, "");
  const isAwsApi = Boolean(normalizedBase);
  const endpoint = isAwsApi
    ? `${normalizedBase}/events?region=${region}`
    : `${LIVE_QUERY_URL}${
        region === "india" ? `&${INDIA_QUERY}` : ""
      }&starttime=${encodeURIComponent(
        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      )}`;
  const payload = await fetchJson(endpoint, signal);

  if (!record(payload)) {
    throw new Error("The earthquake service returned an unexpected response.");
  }
  if (payload.error) {
    throw new Error(
      typeof payload.error === "string"
        ? payload.error
        : "The earthquake service could not supply live data.",
    );
  }

  const rawEvents = Array.isArray(payload.events)
    ? {
        type: "FeatureCollection",
        features: payload.events.map(toGeoJsonFeature),
      }
    : isFeatureCollection(payload)
      ? payload
      : null;
  if (!rawEvents) {
    throw new Error("The earthquake service returned no valid event collection.");
  }

  const events = normalizeFeatureCollection(rawEvents);
  const metadata = record(payload.metadata) ? payload.metadata : null;
  const rawRetrievedAt =
    payload.retrieved_at ?? payload.updated_at ?? metadata?.generated;
  const retrievedAtDate =
    typeof rawRetrievedAt === "number"
      ? new Date(rawRetrievedAt)
      : typeof rawRetrievedAt === "string"
        ? new Date(rawRetrievedAt)
        : null;
  const retrievedAt =
    retrievedAtDate && Number.isFinite(retrievedAtDate.getTime())
      ? retrievedAtDate.toISOString()
      : new Date().toISOString();
  const rawSource = payload.data_source ?? payload.source;

  return {
    events,
    retrievedAt,
    source:
      typeof rawSource === "string"
        ? rawSource
        : isAwsApi
          ? "USGS catalog · AWS API"
          : "USGS live query · direct browser connection",
    stale: payload.stale === true,
    truncated:
      payload.truncated === true ||
      (Array.isArray(rawEvents.features) && rawEvents.features.length >= 2_000),
    region: payload.region === "global" ? "global" : region,
  };
}

function toGeoJsonFeature(event: unknown): unknown {
  if (!record(event)) return event;
  return {
    type: "Feature",
    id: event.id,
    geometry: {
      type: "Point",
      coordinates: [event.longitude, event.latitude, event.depth_km],
    },
    properties: {
      mag: event.magnitude,
      magType: event.magnitude_type,
      place: event.place,
      time: event.time_ms,
      url: event.url,
      sig: event.significance,
    },
  };
}

function isFeatureCollection(
  payload: Record<string, unknown>,
): payload is Record<string, unknown> & { features: unknown[] } {
  return payload.type === "FeatureCollection" && Array.isArray(payload.features);
}
