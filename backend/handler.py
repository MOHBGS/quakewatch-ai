"""Public, read-only API Gateway handler for verified USGS events."""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from typing import Any

if __package__:
    from .ingest import UsgsDataError, fetch_usgs, normalize_feature_collection
else:
    from ingest import UsgsDataError, fetch_usgs, normalize_feature_collection

LOGGER = logging.getLogger(__name__)
logger = logging.getLogger()
logger.setLevel(logging.INFO)
MAX_STALE_SECONDS = int(os.environ.get("MAX_STALE_SECONDS", 6 * 60 * 60))
FRESH_SNAPSHOT_SECONDS = int(
    os.environ.get("FRESH_SNAPSHOT_SECONDS", 20 * 60)
)


def _response(
    status_code: int,
    body: dict[str, Any],
    *,
    extra_headers: dict[str, str] | None = None,
) -> dict[str, Any]:
    headers = {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
        "Access-Control-Allow-Origin": os.environ.get("ALLOWED_ORIGIN", "*"),
        "Access-Control-Allow-Methods": "GET,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "X-Content-Type-Options": "nosniff",
    }
    if extra_headers:
        headers.update(extra_headers)
    return {
        "statusCode": status_code,
        "headers": headers,
        "body": (
            ""
            if status_code == 204
            else json.dumps(body, separators=(",", ":"), allow_nan=False)
        ),
    }


def _read_snapshot(region: str) -> dict[str, Any] | None:
    bucket = os.environ.get("DATA_BUCKET")
    if not bucket:
        return None
    import boto3
    from botocore.exceptions import ClientError

    object_key = f"snapshots/{region}/latest.json"
    try:
        result = boto3.client("s3").get_object(Bucket=bucket, Key=object_key)
    except ClientError as error:
        error_code = error.response.get("Error", {}).get("Code")
        if error_code in {"NoSuchKey", "NotFound", "404"}:
            return None
        LOGGER.exception("Unable to read the USGS snapshot for %s.", region)
        raise
    try:
        snapshot = json.loads(result["Body"].read())
    except (KeyError, json.JSONDecodeError, UnicodeDecodeError) as error:
        raise ValueError("The stored earthquake snapshot is invalid.") from error
    if not isinstance(snapshot, dict) or not isinstance(snapshot.get("events"), list):
        raise ValueError("The stored earthquake snapshot has an invalid shape.")
    return snapshot


def _validate_snapshot(snapshot: dict[str, Any]) -> dict[str, Any]:
    retrieved_at = snapshot.get("retrieved_at")
    if (
        not isinstance(retrieved_at, str)
        or not retrieved_at.endswith("Z")
        or not isinstance(snapshot.get("events"), list)
    ):
        raise ValueError("The stored earthquake snapshot is invalid.")

    raw_features = []
    for event in snapshot["events"]:
        if not isinstance(event, dict):
            continue
        raw_features.append(
            {
                "id": event.get("id"),
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [
                        event.get("longitude"),
                        event.get("latitude"),
                        event.get("depth_km"),
                    ],
                },
                "properties": {
                    "mag": event.get("magnitude"),
                    "magType": event.get("magnitude_type"),
                    "place": event.get("place"),
                    "time": event.get("time_ms"),
                    "url": event.get("url"),
                    "sig": event.get("significance"),
                },
            }
        )
    verified = normalize_feature_collection(
        {"type": "FeatureCollection", "features": raw_features}
    )
    if len(verified) != len(snapshot["events"]):
        raise ValueError("The stored earthquake snapshot contains invalid events.")
    return {**snapshot, "events": verified}


def _age_seconds(retrieved_at: str) -> float:
    timestamp = datetime.fromisoformat(retrieved_at.replace("Z", "+00:00"))
    return max(0.0, (datetime.now(timezone.utc) - timestamp).total_seconds())


def _error_message(error: BaseException) -> str:
    if isinstance(error, UsgsDataError):
        return "The live USGS catalog is temporarily unavailable."
    return "Live earthquake data is temporarily unavailable. Please retry."


def lambda_handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    """Handle API Gateway GET /events, GET /health and CORS preflight."""
    method = (
        event.get("httpMethod")
        or event.get("requestContext", {}).get("http", {}).get("method")
        or ""
    ).upper()
    path = event.get("path") or event.get("rawPath") or "/"
    if method == "OPTIONS":
        return _response(204, {})
    if method == "GET" and path.endswith("/health"):
        return _response(
            200,
            {"status": "ok", "source": "USGS Earthquake Catalog"},
        )
    if method != "GET" or not path.endswith("/events"):
        return _response(404, {"error": "Not found."})

    query = event.get("queryStringParameters") or {}
    region = query.get("region", "india") if isinstance(query, dict) else "india"
    if region not in {"india", "global"}:
        return _response(400, {"error": "Region must be 'india' or 'global'."})

    try:
        snapshot = _read_snapshot(region)
        stale = False
        if snapshot is not None:
            snapshot = _validate_snapshot(snapshot)
            age = _age_seconds(snapshot["retrieved_at"])
            if age <= FRESH_SNAPSHOT_SECONDS:
                return _response(
                    200,
                    {
                        "events": snapshot["events"],
                        "retrieved_at": snapshot["retrieved_at"],
                        "data_source": "USGS catalog · scheduled S3 snapshot",
                        "stale": False,
                        "truncated": len(snapshot["events"]) >= 2_000,
                        "region": region,
                    },
                )
            stale = True

        try:
            events, retrieved_at = fetch_usgs(region)
            return _response(
                200,
                {
                    "events": events,
                    "retrieved_at": retrieved_at,
                    "data_source": "USGS catalog · live FDSN query",
                    "stale": False,
                    "truncated": len(events) >= 2_000,
                    "region": region,
                },
            )
        except UsgsDataError:
            if snapshot is not None and _age_seconds(snapshot["retrieved_at"]) <= MAX_STALE_SECONDS:
                LOGGER.warning("Serving a validated stale %s snapshot.", region)
                return _response(
                    200,
                    {
                        "events": snapshot["events"],
                        "retrieved_at": snapshot["retrieved_at"],
                        "data_source": "USGS catalog · last successful snapshot",
                        "stale": True,
                        "truncated": len(snapshot["events"]) >= 2_000,
                        "region": region,
                        "notice": "The live feed is unavailable; showing the last successful USGS snapshot.",
                    },
                    extra_headers={"Warning": '110 - "Response is stale"'},
                )
            raise
    except (UsgsDataError, OSError, ValueError, RuntimeError) as error:
        LOGGER.warning("Earthquake API request failed: %s", error)
        return _response(
            503,
            {"error": _error_message(error), "retry_after_seconds": 60},
            extra_headers={"Retry-After": "60"},
        )
    except Exception:
        LOGGER.exception("Unexpected earthquake API failure.")
        return _response(
            500,
            {"error": "The earthquake service encountered an internal error."},
        )
