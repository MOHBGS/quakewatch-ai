# AWS Weekend Challenge: MAP IT — submission package

## Project title

**QuakeWatch AI — Real-Time Earthquake Intelligence Through Interactive Geospatial Mapping**

## A. Short description

QuakeWatch AI transforms real USGS earthquake records into an interactive geospatial intelligence dashboard using a map, filters, clusters, charts, event details, and CSV export. Its AWS deployment design uses Amazon Location Service and AWS cloud infrastructure. In the currently verified local preview, the base map is OpenStreetMap; the AWS stack and Amazon Location map have not been deployed or verified.

## B. Project description

Earthquake information in raw catalog feeds can be difficult to explore spatially. QuakeWatch AI turns official USGS earthquake observations into a region-first geospatial dashboard focused on India and nearby areas, with an optional global view. The problem is discoverability and comparison of recorded events: the catalog exposes observations, but users benefit from seeing where and when those events occurred and how the currently selected observations compare.

The application validates and normalizes catalog observations and provides magnitude-coloured map markers, clustering, an optional event-density layer, date/magnitude/depth/place filters, event details linked to the original USGS record, summary charts, data freshness information, and CSV export.

The CDK-defined AWS architecture uses scheduled Python Lambda ingestion, private encrypted S3 snapshots, API Gateway for read-only data access, Amazon Location Service for the hosted map, and CloudFront with a private S3 origin for HTTPS hosting. These components are defined in the repository but are **not deployed**. Local development is explicitly labelled and does not pretend that an OpenStreetMap preview is an AWS-hosted map.

**Safety boundary:** QuakeWatch AI visualizes recorded observations only. It does not predict earthquakes, provide early warnings, or replace official emergency guidance.

## C. Dataset

- **Source:** [USGS FDSN Event Web Service](https://earthquake.usgs.gov/fdsnws/event/1/)
- **GeoJSON feeds:** [USGS Earthquake Feeds](https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php)
- **India area:** latitude 5–38° N, longitude 65–100° E.
- **Fields:** event ID, magnitude, magnitude type, place, longitude, latitude, depth, timestamp, USGS event URL, and significance when present.
- **Handling:** invalid geometry or unusable records are rejected; missing values remain unknown; duplicate event IDs are removed. No synthetic earthquake records are used.
- **Full notes:** [Data source and normalization](./DATA_SOURCE.md).

## D. AWS services and why

| AWS service | Role |
|---|---|
| Amazon Location Service | Hosted base map for the geospatial interface |
| AWS Lambda (Python 3.12) | Validate/ingest USGS data and serve the read API |
| Amazon S3 | Private encrypted dataset snapshots and static frontend assets |
| Amazon API Gateway | Read-only HTTP API, CORS, and throttling |
| Amazon EventBridge | Scheduled data refresh |
| Amazon CloudFront | HTTPS delivery from a private S3 origin |
| AWS IAM | Scoped permissions for application resources |
| Amazon CloudWatch | Runtime logs with bounded retention |

See [architecture and deployment instructions](../README.md) and [AWS security/cost notes](./aws-costs-and-security.md).

## E. Implementation

The frontend uses React, TypeScript, Vite, Tailwind CSS, Recharts, and MapLibre GL JS. The backend uses Python standard-library code for parsing, retries, normalization, Lambda handlers, and local development. AWS CDK v2 defines the cloud resources.

The repository includes automated test suites for frontend behavior, data validation, API handling, and infrastructure synthesis. Run the documented tests before recording the final demo.

## F. Innovation and originality

The project connects source-backed seismic observations with map clustering, magnitude-aware symbols, event-density visualization, temporal analytics, and shareable filters. It preserves provenance and exposes stale-data and error states rather than quietly replacing failed data with fabricated events.

## G. Technical challenges and solutions

The upstream catalog and the dashboard have different failure and freshness
semantics. The backend validates GeoJSON before storing snapshots, preserves
unknown depth instead of inventing a value, uses bounded upstream requests,
and serves a recent validated snapshot as stale when a refresh fails. The
frontend has an explicit request timeout and surfaces failures rather than
substituting sample events. A browser check also exposed that Reset could
re-read stale URL filters; it now restores regional defaults and clears the
shared query state. A local OSM tile/network failure remains visible as a
local-preview limitation and is not misrepresented as an Amazon Location
deployment.

## H. Usefulness and impact

Students, educators, developers, and the public can inspect where recorded events occurred and compare their magnitude, depth, and timing. Each event links back to its USGS source. The ingestion and map pattern can be reused for other public datasets with validated coordinates.

## I. Reuse by other developers

Developers can adapt the pattern for other public geospatial feeds: validate
source records and coordinates, preserve source identifiers and links, store
last-known-good snapshots, expose a throttled read API, and keep the map
provider/configuration separate from local preview mode. The code, tests, CDK
definitions, and deployment instructions are in the public repository.

## J. Public source repository

[https://github.com/MOHBGS/quakewatch-ai](https://github.com/MOHBGS/quakewatch-ai)

The repository is public. Its code and README are available for inspection.

## K. Live application URL

**Not yet verified.** Add the CloudFront HTTPS URL only after deploying the AWS stack and checking the live application and API. A source repository is not a substitute for the live map requirement.

## L. Demo video

**Not yet published.** The challenge requires a public video shorter than three minutes showing the live map and what users can explore. Do not enter a placeholder or claim that a video exists.

See the timed narration and recording checklist in
[DEMO_SCRIPT.md](./DEMO_SCRIPT.md). No public video has been recorded or
published.

## M. Evidence checklist

- [ ] Public AWS-hosted application URL verified over HTTPS.
- [ ] Amazon Location Service map visible in the deployed app.
- [ ] Live USGS data and freshness/source information visible.
- [ ] Real event marker selected, with USGS detail link.
- [ ] Filters and charts demonstrated.
- [ ] CSV export demonstrated.
- [ ] Mobile layout demonstrated.
- [ ] Public demo video under three minutes published.
- [ ] Screenshots captured from the running implementation.

## N. Future improvements

After an approved deployment, verify the live Location map, API health/data,
CloudFront HTTPS, mobile behavior, screenshots, and a short public demo video.
Further work could add official, licensed hazard overlays; server-side
pagination; operational alarms and budget monitoring; and authenticated
personal preferences only with an explicit privacy model.

## O. Submission status and timing

The event page lists the challenge period as October 30, 2026 at 12:00 AM PDT through November 2, 2026 at 1:00 PM PST (November 3, 2026 at 2:30 AM IST). At the 1:00 AM IST check on November 3, the signed-in create-post form was visible and enabled. The deadline had **not yet passed** at that check; about 90 minutes remained. No post was drafted or submitted. Re-check the page and eligibility before acting; an available general post form does not guarantee challenge eligibility or acceptance.

- **Challenge page:** https://builder.aws.com/build/hackathons/e7a301ea-4d84-3b9e-95be-7340a70f7781/weekend-challenge-map-it
- **Create-post page:** https://builder.aws.com/build/hackathons/e7a301ea-4d84-3b9e-95be-7340a70f7781/create/post

The five selected projects are eligible for the stated prize; publishing a repository alone does not guarantee a reward. Eligibility and final award decisions remain with AWS.
