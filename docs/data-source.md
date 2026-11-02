# Data source and normalization

QuakeWatch AI uses the [USGS Earthquake Catalog FDSN Event Web Service](https://earthquake.usgs.gov/fdsnws/event/1/).
The app does not generate, simulate, or backfill earthquake records.

## Queries

- **India view:** a rolling 30-day query bounded by 5–38° N and 65–100° E.
- **Global view:** a rolling 30-day query with no regional bounds.
- Both queries request the newest events first and cap each response at 2,000
  events. A cap is reported to clients instead of silently presented as a
  complete catalog.
- Source endpoint: `https://earthquake.usgs.gov/fdsnws/event/1/query`
- USGS identifiers, event URLs, event times, magnitude/depth values, and
  GeoJSON longitude/latitude coordinates are retained from source records.

## Normalization

Malformed features, duplicate IDs, non-point geometries, non-finite numeric
values, missing magnitudes/timestamps, and coordinates outside WGS 84 ranges
are discarded. An absent depth remains `null`; an absent location is displayed
as “Unknown location.” A missing event link is constructed from the verified
USGS event ID. The backend checks records again before serving an S3 snapshot.

The EventBridge ingestion function atomically overwrites a region-specific S3
snapshot only after the upstream response has been fetched and normalized.
When the catalog fails, ingestion raises an error and EventBridge retries; the
last good snapshot is not replaced. The read API refreshes an old/missing
snapshot directly from USGS. If refresh fails, it serves a validated snapshot
only while it is less than six hours old and marks it `stale`; without a usable
snapshot it returns HTTP 503 and `Retry-After`.

## Attribution and limitations

USGS catalog records can be revised after publication. This app is a
visualization, not an authoritative alert, safety, hazard, or prediction
service. Do not rely on it for evacuation or life-safety decisions. Refer users
to [USGS Earthquake Hazards](https://earthquake.usgs.gov/) and local emergency
authorities.
