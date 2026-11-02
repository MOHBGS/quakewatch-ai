import test from "node:test";
import assert from "node:assert/strict";
import { App, assertions } from "aws-cdk-lib";
import { QuakeWatchStack } from "../lib/quakewatch-stack";

test("synthesizes secure, retained data and frontend buckets", () => {
  const app = new App();
  const stack = new QuakeWatchStack(app, "TestStack");
  const template = assertions.Template.fromStack(stack);

  template.resourceCountIs("AWS::S3::Bucket", 2);
  template.hasResourceProperties("AWS::S3::Bucket", {
    PublicAccessBlockConfiguration: {
      BlockPublicAcls: true,
      BlockPublicPolicy: true,
      IgnorePublicAcls: true,
      RestrictPublicBuckets: true,
    },
    BucketEncryption: {
      ServerSideEncryptionConfiguration: [
        { ServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" } },
      ],
    },
  });
  const buckets = Object.values(
    template.toJSON().Resources as Record<
      string,
      { DeletionPolicy?: string; Type?: string }
    >,
  ).filter(
    (resource) =>
      resource.Type === "AWS::S3::Bucket" &&
      resource.DeletionPolicy === "Retain",
  );
  assert.equal(buckets.length, 2);
});

test("wires a throttled, read-only API to the Python 3.12 API Lambda", () => {
  const stack = new QuakeWatchStack(new App(), "ApiTestStack");
  const template = assertions.Template.fromStack(stack);

  template.resourceCountIs("AWS::Lambda::Function", 2);
  template.resourceCountIs("AWS::ApiGateway::RestApi", 1);
  template.resourceCountIs("AWS::ApiGateway::Method", 5);
  template.hasResourceProperties("AWS::Lambda::Function", {
    Runtime: "python3.12",
  });
  template.hasResourceProperties("AWS::ApiGateway::Stage", {
    MethodSettings: [
      {
        ThrottlingRateLimit: 10,
        ThrottlingBurstLimit: 20,
      },
    ],
  });
});

test("creates regional ingestion schedules and restricted Location maps", () => {
  const stack = new QuakeWatchStack(new App(), "IngestionTestStack");
  const template = assertions.Template.fromStack(stack);

  template.resourceCountIs("AWS::Events::Rule", 2);
  template.resourceCountIs("AWS::Location::Map", 1);
  template.resourceCountIs("AWS::Location::APIKey", 1);
  const resources = template.toJSON().Resources as Record<
    string,
    { Type?: string; Properties?: Record<string, unknown> }
  >;
  const distributionId = Object.entries(resources).find(
    ([, resource]) => resource.Type === "AWS::CloudFront::Distribution",
  )?.[0];
  assert.ok(distributionId, "CloudFront distribution exists");
  const apiKey = Object.values(resources).find(
    (resource) => resource.Type === "AWS::Location::APIKey",
  )?.Properties;
  assert.ok(apiKey, "Location API key exists");
  const restrictions = apiKey.Restrictions as {
    AllowActions: string[];
    AllowResources: unknown[];
    AllowReferers: unknown[];
  };
  assert.deepEqual(restrictions.AllowActions, ["geo:GetMap*"]);
  assert.deepEqual(restrictions.AllowResources, [
    { "Fn::GetAtt": ["EarthquakeMap", "Arn"] },
  ]);
  assert.deepEqual(restrictions.AllowReferers, [
    {
      "Fn::Join": [
        "",
        [
          "https://",
          { "Fn::GetAtt": [distributionId, "DomainName"] },
          "/*",
        ],
      ],
    },
  ]);
  template.hasResourceProperties("AWS::Location::APIKey", {
    ExpireTime: { Ref: "MapKeyExpiration" },
    ForceUpdate: true,
    Restrictions: {
      AllowActions: ["geo:GetMap*"],
    },
  });
  template.hasOutput("*", {
    Description: "API Gateway base URL; append /events or /health.",
  });
});

test("keeps all Lambda grants scoped to snapshot objects", () => {
  const stack = new QuakeWatchStack(new App(), "IamTestStack");
  const template = assertions.Template.fromStack(stack);
  const roles = Object.values(
    template.toJSON().Resources as Record<
      string,
      {
        Type?: string;
        Properties?: { PolicyDocument?: { Statement?: unknown[] } };
      }
    >,
  ).filter((resource) => resource.Type === "AWS::IAM::Policy");
  const statements = roles.flatMap((resource) =>
    resource.Properties?.PolicyDocument?.Statement ?? [],
  );
  assert.ok(statements.length > 0);
  assert.ok(
    statements.every((statement) => {
      const rawActions = (statement as { Action?: unknown }).Action;
      const actions =
        typeof rawActions === "string"
          ? [rawActions]
          : Array.isArray(rawActions)
            ? rawActions
            : [];
      if (!actions.every((action) => typeof action === "string")) {
        return false;
      }
      const allowed = new Set([
        "logs:CreateLogStream",
        "logs:PutLogEvents",
        "s3:GetObject",
        "s3:PutObject",
      ]);
      const resource = (statement as { Resource?: string | string[] }).Resource;
      const resources = Array.isArray(resource) ? resource : [resource];
      return (
        actions.length > 0 &&
        actions.every((action) => allowed.has(action)) &&
        resources.every((arn) => {
          const serialized = JSON.stringify(arn);
          if (typeof serialized !== "string") {
            return false;
          }
          if (actions.every((action) => action.startsWith("logs:"))) {
            return (
              serialized.includes("Logs") &&
              serialized.includes(":*")
            );
          }
          return (
            actions.length === 1 &&
            ["s3:GetObject", "s3:PutObject"].includes(actions[0]) &&
            serialized.includes("EarthquakeSnapshots") &&
            serialized.includes("/snapshots/*/latest.json")
          );
        })
      );
    }),
    "only explicitly required S3 snapshot and API invocation actions are granted",
  );
});
