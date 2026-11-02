# Contributing

Thanks for helping improve QuakeWatch AI. Earthquake information must always
come from the USGS service; do not add generated or simulated events that
could be mistaken for real observations.

## Development setup

1. Install Node.js 22.12 or later, npm 10 or later, and Python 3.12 or later.
2. Copy `.env.example` to `.env.local` if you want to configure the optional
   AWS map or API.
3. Run `npm ci`, then `npm run dev`.
4. Run `npm test` and `npm run build` before submitting a change.
5. Run `npm run synth` to validate the infrastructure template.

Backend tests use Python's standard-library `unittest`; no Python packages are
required. AWS deployment requires a separately configured AWS credential
provider and is never part of local tests.

## Change guidelines

- Preserve clear attribution to the USGS earthquake catalog.
- Validate coordinates, timestamps, and magnitudes before mapping events.
- Keep secrets out of source, issues, screenshots, and pull requests.
- Test boundary conditions and network/API failures.
- Do not describe this informational application as an earthquake prediction,
  warning, or life-safety service.
- Include authentic screenshots only; do not use sample events as live data.

## Pull requests

Describe the user-visible change, note any infrastructure/cost impact, and
include the commands and results used to validate the change. Use the existing
GitHub Actions checks as the minimum quality gate.
