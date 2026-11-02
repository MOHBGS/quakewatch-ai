# QuakeWatch AI deployment report

**Checked:** November 3, 2026
**Status:** Not deployed

## Environment and access

- AWS CLI: unavailable in the checked environment.
- AWS credentials/profile: not configured or available for verification.
- AWS account and region: not established.
- CDK bootstrap status: unknown; no bootstrap or AWS account changes were
  attempted.
- Public application URL/API endpoint: none verified.

Because AWS access was unavailable, no CloudFormation changes, bootstrap,
S3 buckets, Lambda functions, API Gateway resources, EventBridge rules,
Amazon Location resources, or CloudFront distribution were created. No
deployment cost was incurred by this work.

## Deployment implementation

The existing CDK stack and [PowerShell deployment script](../scripts/deploy.ps1)
are present. The script runs tests, production build, and CDK synthesis before
it displays the chargeable services and requires the operator to type
`DEPLOY`. It then checks AWS identity and bootstrap status, provisions the
stack, builds with its actual API/map outputs, publishes frontend assets,
invalidates CloudFront, and checks the API health response and HTTPS page.
These are implementation capabilities, not completed deployment evidence.

Potential usage charges include Amazon Location map requests, CloudFront
requests and data transfer, API Gateway, Lambda, S3, EventBridge, CloudWatch
logs, and CDK bootstrap resources. Costs vary by region and traffic; review
current AWS pricing and set a budget before approving. The S3 buckets are
retained on stack removal. See [cost and security guidance](./aws-costs-and-security.md).

## Required before an authorized deployment

1. Configure an approved AWS credential provider and select the target
   account/region.
2. Review the CDK change set, resource list, current service prices, retention,
   and account budget.
3. Confirm explicit authorization to create/update the QuakeWatch stack.
4. Bootstrap only after reviewing and approving the CDK bootstrap resources.
5. Run `.\scripts\deploy.ps1` and type `DEPLOY` only after the cost/resource
   review.
6. Record actual stack outputs; verify API health and real USGS events, the
   Amazon Location map and restricted key, CloudFront HTTPS, mobile layout,
   and a real event interaction.
7. Record the resulting dashboard URL, API endpoint, account region, and
   deployment evidence. Do not fill the submission's live URL until then.

No AWS deployment approval is inferred from this report. No public URL,
endpoint, region, resource, or cost estimate is fabricated.
