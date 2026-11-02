# AWS Weekend Challenge: MAP IT — submission package

## Project title

**QuakeWatch AI — Real-Time Earthquake Intelligence Through Geospatial Mapping**

## A. Short description

QuakeWatch AI is an interactive dashboard for exploring real USGS earthquake observations using a map, filters, clusters, charts, event details, and CSV export. Its AWS deployment design uses Amazon Location Service, Lambda, S3, API Gateway, EventBridge, and CloudFront.

## B. Project description

Earthquake information in raw catalog feeds can be difficult to explore spatially. QuakeWatch AI turns official USGS earthquake observations into a region-first geospatial dashboard focused on India and nearby areas, with an optional global view.

The application validates and normalizes catalog observations and provides magnitude-coloured map markers, clustering, an optional event-density layer, date/magnitude/depth/place filters, event details linked to the original USGS record, summary charts, data freshness information, and CSV export.

The AWS deployment architecture uses scheduled Python Lambda ingestion, private encrypted S3 snapshots, API Gateway for read-only data access, Amazon Location Service for the hosted map, and CloudFront with a private S3 origin for HTTPS hosting. Local development is explicitly labelled and does not pretend that an OpenStreetMap preview is an AWS-hosted map.

**Safety boundary:** QuakeWatch AI visualizes recorded observations only. It does not predict earthquakes, provide early warnings, or replace official emergency guidance.

## C. Dataset

- **Source:** [USGS FDSN Event Web Service](https://earthquake.usgs.gov/fdsnws/event/1/)
- **GeoJSON feeds:** [USGS Earthquake Feeds](https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php)
- **India area:** latitude 5–38° N, longitude 65–100° E.
- **Fields:** event ID, magnitude, magnitude type, place, longitude, latitude, depth, timestamp, USGS event URL, and significance when present.
- **Handling:** invalid geometry or unusable records are rejected; missing values remain unknown; duplicate event IDs are removed. No synthetic earthquake records are used.
- **Full notes:** [Data source and normalization](./data-source.md).

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

## G. Usefulness and impact

Students, educators, developers, and the public can inspect where recorded events occurred and compare their magnitude, depth, and timing. Each event links back to its USGS source. The ingestion and map pattern can be reused for other public datasets with validated coordinates.

## H. Public source repository

[https://github.com/MOHBGS/quakewatch-ai](https://github.com/MOHBGS/quakewatch-ai)

The repository is public. Its code and README are available for inspection.

## I. Live application URL

**Not yet verified.** Add the CloudFront HTTPS URL only after deploying the AWS stack and checking the live application and API. A source repository is not a substitute for the live map requirement.

## J. Demo video

**Not yet published.** The challenge requires a public video shorter than three minutes showing the live map and what users can explore. Do not enter a placeholder or claim that a video exists.

Suggested narration (approximately 2 minutes 30 seconds):

**0:00–0:20 — Purpose**

“QuakeWatch AI makes official earthquake observations easier to explore. It is an information and visualization tool, not an earthquake prediction or warning system.”

**0:20–0:45 — Data and AWS architecture**

“The dashboard uses the USGS FDSN Earthquake Catalog. In the AWS deployment, scheduled Python Lambda functions validate the feed, store snapshots in private S3, and expose read-only data through API Gateway. Amazon Location Service supplies the deployed map.”

**0:45–1:20 — Map and filters**

“The initial view focuses on India and nearby regions. Markers represent catalog events; colour and size communicate magnitude bands; clusters summarize nearby records. I can filter by time, magnitude, depth, and place or switch to global data.”

**1:20–1:50 — Event details and analysis**

“Selecting an event shows its recorded magnitude, depth, time, and place, with a link to the original USGS record. The charts summarize only the events that match the selected filters.”

**1:50–2:10 — Export and reliability**

“I can export matching observations to CSV. The dashboard shows data provenance and freshness, identifies stale cached results, and reports upstream failures rather than inventing events.”

**2:10–2:30 — Impact**

“The goal is a clear and reusable way to explore real spatial data. The code and infrastructure can be tested and extended without presenting earthquake catalog data as a safety service.”

## K. Evidence checklist

- [ ] Public AWS-hosted application URL verified over HTTPS.
- [ ] Amazon Location Service map visible in the deployed app.
- [ ] Live USGS data and freshness/source information visible.
- [ ] Real event marker selected, with USGS detail link.
- [ ] Filters and charts demonstrated.
- [ ] CSV export demonstrated.
- [ ] Mobile layout demonstrated.
- [ ] Public demo video under three minutes published.
- [ ] Screenshots captured from the running implementation.

## L. Submission status and timing

The event page lists the challenge period as October 30, 2026 at 12:00 AM PDT through November 2, 2026 at 1:00 PM PST. That closing time was November 3, 2026 at 2:30 AM in India (IST). The deadline has passed as of the current date, November 3, 2026. Check the Builder Center page while signed in to see whether late submission is still enabled; do not assume an entry can be accepted after close.

Challenge page: https://builder.aws.com/build/hackathons/e7a301ea-4d84-3b9e-95be-7340a70f7781/weekend-challenge-map-it

The five selected projects are eligible for the stated prize; publishing a repository alone does not guarantee a reward. Eligibility and final award decisions remain with AWS.
