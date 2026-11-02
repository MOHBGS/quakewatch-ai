#!/usr/bin/env node
import { App } from "aws-cdk-lib";
import { QuakeWatchStack } from "../lib/quakewatch-stack";

const app = new App();
new QuakeWatchStack(app, "QuakeWatchStack", {
  description:
    "QuakeWatch AI: USGS earthquake data ingestion, read-only API, secure static dashboard, and Amazon Location map.",
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || process.env.AWS_REGION || "us-east-1",
  },
});
