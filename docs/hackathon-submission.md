# AWS Weekend Challenge: MAP IT — submission package

## Project title

**QuakeWatch AI — Real-Time Earthquake Intelligence Through Geospatial Mapping**

## A. Short description

An interactive dashboard explores real USGS earthquake records with
magnitude, depth, time, and location filters, map clustering, activity
analytics, and a CSV export, backed by an AWS-ready data pipeline.

## B. Full project description

QuakeWatch AI turns the USGS Earthquake Catalog into an explorable
geospatial dashboard focused on India and nearby regions, with an optional
global view. Earthquake information is often difficult to scan in raw catalog
feeds: a location, depth, magnitude, and event time are separated from the
regional patterns people need to understand.

The project retrieves source records directly from the USGS FDSN Event Web
Service. It validates coordinates, magnitudes, timestamps, duplicates, and
GeoJSON geometry before displaying the data. A responsive dashboard presents
clustered magnitude-colored map markers, an activity heatmap, date/magnitude/
depth/location filters, event details linked to the USGS record, activity
charts, a freshness indicator, and an export of the filtered observations.

With AWS configured, scheduled Python 3.12 Lambda functions refresh regional
snapshots every 15 minutes and store the latest verified data in a private,
encrypted S3 bucket. API Gateway serves read-only responses, reports staleness,
and refreshes from USGS if the cache is missing or old. Amazon Location Service
provides the deployed base map; CloudFront serves the static React dashboard
from a private S3 origin. Local development uses a clearly identified
OpenStreetMap fallback and a direct, real USGS connection.

QuakeWatch AI reports observed seismic records only. It does not predict
earthquakes or provide emergency alerts.

## C. Dataset description

- Source: official USGS Earthquake Catalog FDSN Event Web Service.
- India query bounds: 5–38° N, 65–100° E.
- Query window: rolling 30 days, newest events first, capped at 2,000 records.
- Fields: USGS event ID, magnitude and magnitude type, place, longitude,
  latitude, depth, event timestamp, USGS event URL, and significance when
  present.
- Missing/unusable observations are rejected or explicitly shown as unknown;
  no artificial event records are used.
- Dataset notes: [docs/data-source.md](./data-source.md).

## D. AWS services and rationale

| AWS service | Purpose |
|---|---|
| AWS Lambda (Python 3.12) | Validate and ingest USGS data; serve the small read API |
| Amazon S3 | Private encrypted snapshots and frontend assets |
| Amazon API Gateway | Read-only HTTP endpoints, CORS, and request throttling |
| Amazon EventBridge | Refresh India and global snapshots every 15 minutes |
| Amazon Location Service | Managed base map with a map/referrer-restricted, expiring key |
| Amazon CloudFront | HTTPS static hosting with a private S3 origin |
| AWS IAM | Least-privilege S3 access for the Lambda functions |
| Amazon CloudWatch | Lambda logs with bounded retention |

AWS architecture and setup are documented in the root [README](../README.md).

## E. Technical implementation

React, TypeScript, Vite, Tailwind CSS, Recharts, and MapLibre GL JS power the
responsive client. MapLibre renders the Amazon Location map using a restricted
client key that expires one year after deployment.
Python standard-library code implements parsing, retries, normalization,
Lambda handlers, and a no-AWS local API runner. AWS CDK v2 in TypeScript
synthesizes the secure S3/API/EventBridge/Location/CloudFront stack. Automated
tests cover GeoJSON validation, deduplication, coordinate/date/magnitude
filters, analytics, CSV injection defenses, API response handling, IAM scope,
and infrastructure synthesis.

## F. Innovation and originality

The dashboard combines observable source records, geographic clustering,
magnitude-aware visual cues, optional activity-density shading, temporal
analytics, and shareable filters in a region-first workflow. Its scheduled
cache and direct-USGS fallback are designed to preserve provenance and
surface stale/error states rather than synthesize replacement data.

## G. Usefulness and impact

Students, developers, educators, and curious users can explore how recent
recorded seismic activity is distributed and compare the magnitude, depth, and
timing of catalog events. The source attribution and direct event links make
the results reproducible. The architecture is reusable for other validated
GeoJSON-based public-data maps.

## H. Public GitHub repository

**Not yet published or verified.** Add the public repository URL here after an
authenticated GitHub create/push operation is confirmed.

## I. Live application

**Not deployed or verified.** Add a public HTTPS URL only after an AWS account,
permissions, successful deployment, and live health check are confirmed.

## J. Demo video script (approximately 2 minutes 30 seconds)

**0:00–0:20 — Purpose**

“QuakeWatch AI makes official earthquake observations easier to explore. It is
an information and visualization tool, not an earthquake prediction or
warning system.”

**0:20–0:45 — Provenance and architecture**

“The dashboard uses the USGS FDSN Earthquake Catalog. For deployment, a
scheduled Python Lambda validates the real feed, stores snapshots in private
S3, and exposes read-only data through API Gateway. Amazon Location provides
the map.”

**0:45–1:20 — Map and filters**

“The initial view focuses on India and nearby regions. Markers represent
catalog events, color and size show magnitude bands, clusters summarize
nearby records, and the activity layer reveals areas with more events. I can
filter by time, magnitude, depth, and place or switch to the global view.”

**1:20–1:50 — Event detail and analysis**

“Selecting an event shows its catalog magnitude, depth, time, location, and
link to the original USGS event. The charts summarize only the events matching
the active filters.”

**1:50–2:10 — Export and reliability**

“I can export filtered observations to CSV. The dashboard identifies its data
source, displays the last successful fetch, marks stale cached data, and
reports feed failures instead of substituting sample earthquakes.”

**2:10–2:30 — Impact**

“The goal is an accessible, reproducible way to explore real geospatial data.
The code and infrastructure are designed to be reused, tested, and extended
without presenting catalog data as a safety or prediction service.”

## K. Screenshot checklist

- [ ] Dashboard overview with data source and freshness visible.
- [ ] India-focused interactive map with real, source-backed event markers.
- [ ] Marker details with a working USGS event link.
- [ ] Magnitude/depth/date/region filters and responsive layout.
- [ ] Magnitude profile, activity timeline, and CSV export.
- [ ] Mobile-width layout.
- [ ] Capture each screenshot from the running, real-data app; do not use
  placeholders or a mockup as deployment evidence.

## Video URL

No demo video has been published.
