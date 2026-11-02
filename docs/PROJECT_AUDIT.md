# QuakeWatch AI repository audit

**Reviewed:** November 3, 2026
**Repository:** `MOHBGS/quakewatch-ai`
**Branch:** `feature/aws-map-it-submission`, based on the fetched `origin/main`

## Scope inspected

The audit covered the root README and npm manifests/lockfile, frontend source
and tests, Python backend and tests, AWS CDK stack and tests, deployment
script, existing documentation, screenshots policy, `.env.example`,
`.gitignore`, and `.github/workflows/ci.yml`.

## Existing implementation

- **Frontend:** React, TypeScript, Vite, Tailwind CSS, Recharts, and MapLibre
  GL JS. It queries the official USGS feed directly in local mode or uses the
  configured read API; it provides India/global scope, event markers and
  clustering, an optional heatmap, date/magnitude/depth/place filters,
  shareable filter parameters, event details, charts, CSV export, and
  loading/error/freshness states.
- **Backend:** Python standard-library parsing, validation, normalization,
  bounded upstream requests, Lambda ingestion and read handlers, and a local
  development server. EventBridge ingestion writes region snapshots to S3;
  the read handler can refresh from USGS and use a sufficiently recent,
  validated snapshot when the upstream feed fails.
- **Infrastructure:** CDK v2 defines private encrypted S3 buckets, scoped
  Lambda roles, scheduled EventBridge rules, throttled API Gateway routes, an
  Amazon Location map and restricted key, and CloudFront with a private S3
  origin. Infrastructure definitions and a deployment script are present;
  they are not evidence of deployed resources.
- **Quality:** Vitest, Python `unittest`, CDK synthesis/assertions, and GitHub
  Actions cover frontend, backend, and infrastructure checks. No automated
  browser end-to-end suite was present.
- **Security/configuration:** `.env.example` contains configuration names,
  `.gitignore` excludes local environment files, and the app avoids treating
  the browser-visible map key as an AWS credential. The public catalog API is
  read-only; public CORS is not authentication.

## Findings and changes on this branch

| Priority | Finding | Action / verification |
|---|---|---|
| Fixed | Reset reused initial filters derived from the current URL, so a search or shared URL could survive Reset. | Reset now restores the selected region's default filter values. A browser check at 390 px changed a Nepal-filtered result count from 1 back to 79 and removed `q` from the URL. |
| Fixed | Direct-USGS mode reported the browser retrieval time instead of the feed generation time. | The client now uses the USGS GeoJSON `metadata.generated` timestamp when a response has no backend retrieval timestamp; unit coverage was added. |
| Fixed | A stalled USGS/API request could keep the dashboard loading indefinitely. | The client now applies a 10-second timeout, covers response parsing, and preserves caller cancellation; unit coverage was added. |
| Updated | Contributor setup documentation did not match the Node.js version required by the root manifest. | Requirements now state Node.js 22.12+ and npm 10+. |
| Known limitation | The local map is an explicitly labelled OpenStreetMap preview. In the verified browser session, map tiles could not be reached, while real USGS records loaded. | No claim is made that this local preview is Amazon Location Service. Recheck tile/network access and verify the actual AWS map after an authorized deployment. |
| Known limitation | No AWS account, region, CLI, or credentials were configured in this environment. | No bootstrap, resource creation, deployment, or live endpoint verification was attempted. |
| Known limitation | The production build reports large JavaScript chunks (about 613 kB application JS and about 1.1 MB MapLibre before gzip). | Captured as a performance follow-up; this audit did not change bundling behavior. |
| Known limitation | No genuine screenshots or public demo video were available. | Neither screenshots nor a video are represented as completed deliverables. |

The map interaction smoke check also confirmed that the 390 px viewport had no
horizontal overflow (`scrollWidth` 375 px), the live feed displayed 79 USGS
events before filtering, and the heatmap control was initially off.

## Deployment and publication status

- The source repository is public and this feature branch is published. Verify
  the pull request and GitHub Actions status in the repository; this report
  does not imply a merge or successful remote workflow.
- The CDK stack has local synthesis coverage, but no AWS stack, API endpoint,
  Amazon Location map, CloudFront distribution, or public application URL has
  been verified in this environment.
- No AWS resources were created. Review [the deployment report](./DEPLOYMENT_REPORT.md)
  before requesting deployment.
- The signed-in Builder Center create-post form was available when checked
  shortly before the listed challenge close; no post was drafted or
  submitted. See [the prepared submission](./HACKATHON_SUBMISSION.md).

## Validation record

| Command/check | Result |
|---|---|
| `npm ci` | Passed; dependencies were already installed for this work. |
| `npm test` | Passed: 37 total (16 frontend, 17 backend, 4 infrastructure). |
| `npm run build` | Passed TypeScript and production Vite build; Vite reports large-chunk warnings. |
| `npm run synth` | Passed CDK synthesis. |
| `python -m compileall -q backend` | Passed. |
| `npm audit --omit=dev` | Passed; zero production vulnerabilities reported. |
| CRLF-aware `git diff --check` | Passed; no trailing whitespace in code changes. |
| Browser smoke at 390 px | Passed reset/search restoration and no horizontal overflow; live USGS data loaded. |

These are local results. They do not substitute for GitHub Actions on this
feature branch, live AWS verification, or a public browser test.

This project visualizes recorded observations only. It does not predict
earthquakes or provide alerts or life-safety guidance.
