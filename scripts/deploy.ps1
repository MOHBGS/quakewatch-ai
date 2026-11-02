$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$previousLocation = Get-Location
$originalMapKey = $env:VITE_AMAZON_LOCATION_API_KEY
$originalApiUrl = $env:VITE_API_BASE_URL
$originalMapName = $env:VITE_AMAZON_LOCATION_MAP_NAME
$originalFrontendRegion = $env:VITE_AWS_REGION
$originalProvider = $env:VITE_MAP_PROVIDER
$outputsPath = Join-Path $env:TEMP "quakewatch-cdk-outputs-$PID.json"
$mapKey = $null

try {
    Set-Location -LiteralPath $root

    if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
        throw "AWS CLI is not installed. Install AWS CLI v2 and configure an authorized AWS credential provider."
    }

    $region = $env:AWS_REGION
    if (-not $region) { $region = $env:AWS_DEFAULT_REGION }
    if (-not $region) { $region = "us-east-1" }
    $env:AWS_REGION = $region
    $env:CDK_DEFAULT_REGION = $region
    $stackName = "QuakeWatchStack"

    $account = & aws sts get-caller-identity --query Account --output text --region $region
    if ($LASTEXITCODE -ne 0 -or -not $account) {
        throw "AWS credentials are missing or invalid. Configure AWS SSO/profile or workload identity, then retry."
    }

    & aws cloudformation describe-stacks --stack-name CDKToolkit --region $region --query "Stacks[0].StackStatus" --output text 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "CDK is not bootstrapped for account $account in $region. Review the permissions and costs first, then run: npx cdk bootstrap aws://$account/$region"
    }

    Write-Host "Validating tests, application build, and CloudFormation synthesis..."
    & npm ci
    if ($LASTEXITCODE -ne 0) { throw "npm ci failed." }
    & npm test
    if ($LASTEXITCODE -ne 0) { throw "The automated test suite failed; deployment has stopped." }
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw "The frontend production build failed; deployment has stopped." }
    & npm run synth
    if ($LASTEXITCODE -ne 0) { throw "CloudFormation synthesis failed; deployment has stopped." }

    Write-Host ""
    Write-Host "Before deploying, review the usage-based cost exposure:"
    Write-Host "- Amazon Location map requests, CloudFront traffic, API Gateway calls, and Lambda execution are usage-billed."
    Write-Host "- S3 storage/requests, EventBridge schedules, and CloudWatch logs may also incur charges."
    Write-Host "- The stack retains its S3 buckets and logs. See docs/aws-costs-and-security.md and the AWS Pricing Calculator."
    Write-Host "Provisioning estimate: actual cost depends on region and observed traffic; check current AWS pricing before you approve."
    $approval = Read-Host "Type DEPLOY to create/update the QuakeWatch AI resources in account $account, region $region"
    if ($approval -cne "DEPLOY") {
        throw "Deployment cancelled. No CloudFormation stack was created or updated."
    }

    $mapKeyExpiration = (Get-Date).ToUniversalTime().AddDays(365).ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'")
    & npm run deploy --workspace infrastructure -- --parameters "MapKeyExpiration=$mapKeyExpiration" --outputs-file $outputsPath
    if ($LASTEXITCODE -ne 0) { throw "CDK deployment did not complete successfully." }
    if (-not (Test-Path -LiteralPath $outputsPath -PathType Leaf)) {
        throw "CDK completed without writing its expected stack outputs file."
    }

    $stackOutputs = (Get-Content -LiteralPath $outputsPath -Raw | ConvertFrom-Json).$stackName
    if (-not $stackOutputs -or
        -not $stackOutputs.ApiBaseUrl -or
        -not $stackOutputs.FrontendBucketName -or
        -not $stackOutputs.DashboardUrl) {
        throw "Required dashboard, API, or S3 deployment outputs are missing from CDK."
    }
    $region = $stackOutputs.AmazonLocationRegion

    $mapKey = & aws location describe-key --key-name $stackOutputs.AmazonLocationApiKeyName --query Key --output text --region $region
    if ($LASTEXITCODE -ne 0 -or -not $mapKey -or $mapKey -eq "None") {
        throw "Could not retrieve the restricted Location Service map API key. Check `aws location describe-key help` and map-key permissions; no key was published."
    }

    $env:VITE_API_BASE_URL = $stackOutputs.ApiBaseUrl.TrimEnd("/")
    $env:VITE_AWS_REGION = $region
    $env:VITE_AMAZON_LOCATION_MAP_NAME = $stackOutputs.AmazonLocationMapName
    $env:VITE_AMAZON_LOCATION_API_KEY = $mapKey
    $env:VITE_MAP_PROVIDER = "amazon-location"
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw "The AWS-configured frontend build failed. Resources exist, but the live app has not been published." }

    $assetDirectory = Join-Path $root "frontend\dist"
    & aws s3 sync $assetDirectory "s3://$($stackOutputs.FrontendBucketName)/" --exclude "index.html" --cache-control "public, max-age=31536000, immutable" --region $region
    if ($LASTEXITCODE -ne 0) { throw "Could not publish static frontend assets." }
    & aws s3 cp (Join-Path $assetDirectory "index.html") "s3://$($stackOutputs.FrontendBucketName)/index.html" --content-type "text/html; charset=utf-8" --cache-control "public, max-age=60" --region $region
    if ($LASTEXITCODE -ne 0) { throw "Could not publish the dashboard entry point." }

    $distributionId = $stackOutputs.CloudFrontDistributionId
    & aws cloudfront create-invalidation --distribution-id $distributionId --paths "/" "/index.html" --region us-east-1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Static assets were uploaded, but CloudFront invalidation failed." }

    Write-Host "Checking the live health endpoint..."
    $health = Invoke-RestMethod -Uri "$($stackOutputs.ApiBaseUrl)health" -Method Get -TimeoutSec 20
    if ($health.status -ne "ok") { throw "The public API health check returned an unexpected response." }

    Write-Host "Checking the published dashboard..."
    $page = Invoke-WebRequest -Uri $stackOutputs.DashboardUrl -Method Get -TimeoutSec 40
    if ($page.StatusCode -ne 200 -or $page.Content -notmatch "QuakeWatch") {
        throw "CloudFront did not return the deployed QuakeWatch AI application."
    }

    Write-Host ""
    Write-Host "Deployment verified:"
    Write-Host "Dashboard: $($stackOutputs.DashboardUrl)"
    Write-Host "API: $($stackOutputs.ApiBaseUrl)"
    Write-Host "Region: $region"
    Write-Host "A restricted Location API key was used for the frontend; its value is not printed."
}
finally {
    $env:VITE_AMAZON_LOCATION_API_KEY = $originalMapKey
    $env:VITE_API_BASE_URL = $originalApiUrl
    $env:VITE_AMAZON_LOCATION_MAP_NAME = $originalMapName
    $env:VITE_AWS_REGION = $originalFrontendRegion
    $env:VITE_MAP_PROVIDER = $originalProvider
    if (Test-Path -LiteralPath $outputsPath -PathType Leaf) {
        Remove-Item -LiteralPath $outputsPath -Force
    }
    Set-Location -LiteralPath $previousLocation
}
