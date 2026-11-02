# QuakeWatch AI demo script (under three minutes)

**Target duration:** 2 minutes 45 seconds.
**Video status:** No public recording has been captured or published.
**Important:** Record only the real running application. The local map is an
OpenStreetMap preview, not Amazon Location Service. Do not narrate it as an
AWS deployment. For an AWS challenge demo, record the equivalent steps only
after the deployed Amazon Location map, API, and HTTPS URL are verified.

| Time | Show | Narration |
|---|---|---|
| 00:00–00:20 | Dashboard title and India-focused view. | “QuakeWatch AI helps people explore recorded earthquake observations. It visualizes catalog data and does not predict earthquakes or provide warnings.” |
| 00:20–00:45 | Source/freshness indicator and architecture graphic. | “The data comes from the official USGS Earthquake Catalog. The AWS design uses scheduled Lambda ingestion, validated S3 snapshots, API Gateway, CloudFront, and Amazon Location Service. Only describe services as deployed if the live stack has actually been checked.” |
| 00:45–01:20 | Zoom, pan, clusters, map legend, then select an event. | “The map focuses on India and surrounding areas, with a global view. Markers represent actual catalog events, and the event detail links back to USGS.” |
| 01:20–01:50 | Change magnitude, depth, dates, and location filters; reset them. | “I can narrow the records by magnitude, depth, date, and location. The filter state can be shared in the URL, and Reset returns to the selected region's defaults.” |
| 01:50–02:15 | Summary cards, magnitude distribution, timeline, active locations. | “Analytics update from the events currently selected. These are summaries of recorded events, not hazard estimates.” |
| 02:15–02:35 | Export CSV and open an event's USGS link. | “I can export the matching records and verify an event at its official source.” |
| 02:35–02:45 | Show public GitHub repository and verified deployment URL, if available. | “The repository documents the data pipeline, infrastructure, tests, and setup. The live link is shown only after HTTPS and map behavior are confirmed.” |

## Recording checklist

- Start with a clean browser session and hide unrelated tabs/notifications.
- Confirm the event source, timestamp, map provider, and viewport are visible.
- Use a currently returned USGS event; do not stage or synthesize records.
- Demonstrate a filter change, reset, event detail, analytics, and CSV download.
- At a mobile viewport, show the dashboard without horizontal scrolling.
- If AWS is not deployed, visibly label the recording as a local preview and
  state that the Amazon Location deployment is pending.
- Keep the final recording under 3:00 and verify its public playback URL before
  adding it to a submission.
