# AWS cost and security notes

## Cost exposure

The CDK stack can create chargeable, usage-billed resources: Amazon Location
map requests, CloudFront requests and data transfer, API Gateway requests,
Lambda invocations/runtime, S3 storage and requests, EventBridge invocations,
CloudWatch logs, and the optional CDK bootstrap S3 bucket/ECR assets. Actual
charges depend on region, map tiles requested, data transfer, requests, and
account pricing. No fixed total is claimed here. Check current prices in the
[AWS Pricing Calculator](https://calculator.aws/) and the service price pages
before deployment.

The stack is intentionally small: two 256-MB Lambdas, 15-minute snapshots,
bounded USGS requests, API throttling, reserved Lambda concurrency, one-week
log retention, 90-day snapshot lifecycle, and a CloudFront Price Class 100
distribution. Both application buckets are encrypted, block public access,
and are retained when the stack is removed. Retention protects data from
accidental removal but means an operator must manage bucket data and costs
after stack deletion. The Location key is usage-based and must be monitored.

Set an AWS Budget and billing alert independently before public launch; the
stack does not create a billing budget.

## Security controls

- AWS credentials are read from the standard AWS credential provider chain;
  none are accepted in frontend config or committed files.
- The USGS snapshot and static frontend S3 buckets have public access blocked,
  server-side encryption, TLS-only access, and retention policies.
- CloudFront accesses frontend assets through Origin Access Control and HTTPS.
- Lambda roles grant only snapshot object read/write. API Gateway is read-only,
  has request throttles, and the API Lambda has reserved concurrency.
- The API exposes only public USGS observations. CORS is intentionally public
  and is not an authentication mechanism.
- The Amazon Location key is browser-visible by design; it is restricted to
  map-rendering actions, one map ARN, and the deployed CloudFront hostname,
  and expires one year after deployment. Treat it as public client
  configuration, never as a server secret. Rotate it if the deployment domain
  or map changes.
- USGS strings used in map popups are assigned with `textContent`; CSV export
  escapes quoting and formula-leading text.
- No request-body upload, login, private data, or cross-account role is added.
- `npm audit --omit=dev` reports no production dependency advisories. The full
  audit reports two moderate findings in the AWS CDK/minimatch development
  dependency chain, with no npm-reported fix available at the time checked.
  CDK is local deployment/test tooling and is not shipped with the frontend
  or Lambda. Recheck the audit and update CDK when a fixed release is
  available.

Enable AWS account-level monitoring and review Lambda/API Gateway logs for
unexpected volume. Do not add a credential, broaden a Location key, or create
another map key as an ad-hoc workaround for a production failure.

## Deployment constraints

Deployment is not automatically executed by CI. It requires a configured AWS
credential provider, CDK bootstrap in the selected account/region, and
permission to create the listed resources. `scripts/deploy.ps1` checks for
credentials and a bootstrap stack and requires explicit confirmation after
displaying the chargeable services. It verifies API and frontend URLs if
deployment completes.
