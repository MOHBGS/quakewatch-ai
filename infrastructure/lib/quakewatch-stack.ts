import { Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import { S3BucketOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as location from "aws-cdk-lib/aws-location";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import { CfnOutput, CfnParameter } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as path from "node:path";

export class QuakeWatchStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const region = Stack.of(this).region;
    const dataBucket = new s3.Bucket(this, "EarthquakeSnapshots", {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: false,
      removalPolicy: RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          expiration: Duration.days(90),
          prefix: "snapshots/",
        },
      ],
    });

    const frontendBucket = new s3.Bucket(this, "DashboardAssets", {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: false,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const sourcePath = path.resolve(__dirname, "../../backend");
    const lambdaAsset = lambda.Code.fromAsset(sourcePath, {
      exclude: [
        "tests/**",
        "**/__pycache__/**",
        "**/*.pyc",
        "local_server.py",
        "requirements.txt",
      ],
    });
    const pythonRuntime = lambda.Runtime.PYTHON_3_12;
    const ingestionLogGroup = new logs.LogGroup(this, "IngestionLogs", {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    const apiLogGroup = new logs.LogGroup(this, "ApiLogs", {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    const createExecutionRole = (
      id: string,
      description: string,
      logGroup: logs.ILogGroup,
    ): iam.Role => {
      const role = new iam.Role(this, id, {
        assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
        description,
      });
      role.addToPolicy(
        new iam.PolicyStatement({
          actions: ["logs:CreateLogStream", "logs:PutLogEvents"],
          resources: [`${logGroup.logGroupArn}:*`],
        }),
      );
      return role;
    };
    const ingestionRole = createExecutionRole(
      "IngestionExecutionRole",
      "Write USGS snapshot and its own CloudWatch logs.",
      ingestionLogGroup,
    );
    const apiRole = createExecutionRole(
      "ApiExecutionRole",
      "Read USGS snapshot and write its own CloudWatch logs.",
      apiLogGroup,
    );

    const ingestionFunction = new lambda.Function(this, "UsgsIngestion", {
      runtime: pythonRuntime,
      code: lambdaAsset,
      handler: "ingest_lambda.lambda_handler",
      description: "Fetch and store validated India/global USGS event snapshots.",
      timeout: Duration.seconds(25),
      memorySize: 256,
      reservedConcurrentExecutions: 1,
      logGroup: ingestionLogGroup,
      role: ingestionRole,
      environment: {
        DATA_BUCKET: dataBucket.bucketName,
      },
    });
    ingestionFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["s3:PutObject"],
        resources: [dataBucket.arnForObjects("snapshots/*/latest.json")],
      }),
    );

    const apiFunction = new lambda.Function(this, "EarthquakeApi", {
      runtime: pythonRuntime,
      code: lambdaAsset,
      handler: "handler.lambda_handler",
      description: "Serve real USGS earthquake events from validated snapshots.",
      timeout: Duration.seconds(20),
      memorySize: 256,
      reservedConcurrentExecutions: 5,
      logGroup: apiLogGroup,
      role: apiRole,
      environment: {
        DATA_BUCKET: dataBucket.bucketName,
        ALLOWED_ORIGIN: "*",
        FRESH_SNAPSHOT_SECONDS: String(20 * 60),
        MAX_STALE_SECONDS: String(6 * 60 * 60),
      },
    });
    apiFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["s3:GetObject"],
        resources: [dataBucket.arnForObjects("snapshots/*/latest.json")],
      }),
    );

    const restApi = new apigateway.RestApi(this, "EarthquakeReadApi", {
      restApiName: "QuakeWatch Earthquake Read API",
      description: "Read-only earthquake records from the USGS catalog.",
      deployOptions: {
        throttlingRateLimit: 10,
        throttlingBurstLimit: 20,
        metricsEnabled: true,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: ["GET", "OPTIONS"],
        allowHeaders: ["Content-Type"],
        maxAge: Duration.hours(1),
      },
      cloudWatchRole: false,
    });
    const integration = new apigateway.LambdaIntegration(apiFunction, {
      proxy: true,
      allowTestInvoke: false,
    });
    restApi.root.addResource("events").addMethod("GET", integration);
    restApi.root.addResource("health").addMethod("GET", integration);

    for (const regionName of ["india", "global"]) {
      new events.Rule(this, `Refresh${regionName}Snapshot`, {
        description: `Refresh the ${regionName} USGS earthquake snapshot.`,
        schedule: events.Schedule.rate(Duration.minutes(15)),
        targets: [
          new targets.LambdaFunction(ingestionFunction, {
            retryAttempts: 2,
            maxEventAge: Duration.hours(1),
            event: events.RuleTargetInput.fromObject({ region: regionName }),
          }),
        ],
      });
    }

    const distribution = new cloudfront.Distribution(
      this,
      "DashboardDistribution",
      {
        comment: "QuakeWatch AI static dashboard",
        defaultRootObject: "index.html",
        priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
        defaultBehavior: {
          origin: S3BucketOrigin.withOriginAccessControl(frontendBucket),
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          responseHeadersPolicy:
            cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
          compress: true,
        },
        errorResponses: [
          {
            httpStatus: 403,
            responseHttpStatus: 200,
            responsePagePath: "/index.html",
            ttl: Duration.seconds(0),
          },
          {
            httpStatus: 404,
            responseHttpStatus: 200,
            responsePagePath: "/index.html",
            ttl: Duration.seconds(0),
          },
        ],
      },
    );

    const map = new location.CfnMap(this, "EarthquakeMap", {
      mapName: "QuakeWatchAI",
      description: "Dark vector base map used by the QuakeWatch AI dashboard.",
      configuration: { style: "VectorEsriNavigation" },
    });

    const mapKeyExpiration = new CfnParameter(this, "MapKeyExpiration", {
      type: "String",
      description:
        "UTC ISO-8601 expiry for the browser map key, supplied by scripts/deploy.ps1.",
    });
    const mapKey = new location.CfnAPIKey(this, "EarthquakeMapApiKey", {
      keyName: "QuakeWatchAIMapKey",
      expireTime: mapKeyExpiration.valueAsString,
      forceUpdate: true,
      description: "Browser map-rendering key; restricted to this map and site origins.",
      restrictions: {
        allowActions: ["geo:GetMap*"],
        allowResources: [map.attrArn],
        allowReferers: [`https://${distribution.distributionDomainName}/*`],
      },
    });
    mapKey.node.addDependency(map);
    mapKey.node.addDependency(distribution);

    new CfnOutput(this, "DashboardUrl", {
      value: `https://${distribution.distributionDomainName}`,
      description: "HTTPS dashboard URL. Upload a built frontend to enable the app.",
    });
    new CfnOutput(this, "ApiBaseUrl", {
      value: restApi.url,
      description: "API Gateway base URL; append /events or /health.",
    });
    new CfnOutput(this, "DataBucketName", {
      value: dataBucket.bucketName,
      description: "Private, encrypted bucket holding only latest USGS snapshots.",
    });
    new CfnOutput(this, "FrontendBucketName", {
      value: frontendBucket.bucketName,
      description: "Private S3 bucket behind the CloudFront origin access control.",
    });
    new CfnOutput(this, "AmazonLocationMapName", {
      value: map.ref,
      description: "Amazon Location Service map resource name.",
    });
    new CfnOutput(this, "AmazonLocationRegion", {
      value: region,
      description: "Region containing the Amazon Location Service map.",
    });
    new CfnOutput(this, "AmazonLocationApiKeyName", {
      value: mapKey.keyName,
      description:
        "Browser-visible API key name; retrieve its value with aws location describe-key.",
    });
    new CfnOutput(this, "CloudFrontDistributionId", {
      value: distribution.distributionId,
      description: "CloudFront distribution ID for frontend cache invalidation.",
    });
  }
}
