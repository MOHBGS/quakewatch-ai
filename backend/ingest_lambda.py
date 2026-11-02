"""Scheduled EventBridge ingestion and private S3 snapshot storage."""

from __future__ import annotations

import json
import logging
import os
from typing import Any

if __package__:
    from .ingest import fetch_usgs
else:
    from ingest import fetch_usgs

LOGGER = logging.getLogger(__name__)


def build_snapshot(events: list[dict[str, Any]], retrieved_at: str) -> bytes:
    return json.dumps(
        {
            "events": events,
            "retrieved_at": retrieved_at,
            "data_source": "USGS Earthquake Catalog",
        },
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")


def lambda_handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    region = event.get("region", "india")
    if region not in {"india", "global"}:
        raise ValueError("Scheduled ingestion requires an 'india' or 'global' region.")
    bucket = os.environ.get("DATA_BUCKET")
    if not bucket:
        raise RuntimeError("The DATA_BUCKET environment variable is not configured.")

    events, retrieved_at = fetch_usgs(region)
    body = build_snapshot(events, retrieved_at)
    import boto3

    object_key = f"snapshots/{region}/latest.json"
    try:
        boto3.client("s3").put_object(
            Bucket=bucket,
            Key=object_key,
            Body=body,
            ContentType="application/json",
            ServerSideEncryption="AES256",
        )
    except Exception:
        LOGGER.exception("Unable to persist the %s USGS snapshot.", region)
        raise

    LOGGER.info(
        "Stored %d validated USGS events for %s at %s.",
        len(events),
        region,
        retrieved_at,
    )
    return {
        "region": region,
        "event_count": len(events),
        "retrieved_at": retrieved_at,
        "object_key": object_key,
    }
