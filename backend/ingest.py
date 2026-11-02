"""Fetch, validate, and normalize real events from the USGS catalog."""

from __future__ import annotations

import json
import logging
import math
import random
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlparse

LOGGER = logging.getLogger(__name__)
USGS_QUERY_URL = "https://earthquake.usgs.gov/fdsnws/event/1/query"
USGS_BASE = "https://earthquake.usgs.gov/earthquakes/eventpage/"
MAX_EVENTS = 2_000
TIMEOUT_SECONDS = 5
MAX_ATTEMPTS = 3

REGION_BOUNDS: dict[str, dict[str, float]] = {
    "india": {
        "minlatitude": 5,
        "maxlatitude": 38,
        "minlongitude": 65,
        "maxlongitude": 100,
    }
}


class UsgsDataError(Exception):
    """Raised when the real catalog cannot be retrieved or validated."""


def _isoformat_utc(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace(
        "+00:00", "Z"
    )


def _as_finite_number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    result = float(value)
    return result if math.isfinite(result) else None


def _normalized_event(feature: Any) -> dict[str, Any] | None:
    if not isinstance(feature, dict):
        return None
    event_id = feature.get("id")
    geometry = feature.get("geometry")
    properties = feature.get("properties")
    if (
        not isinstance(event_id, str)
        or not event_id.strip()
        or not isinstance(geometry, dict)
        or geometry.get("type") != "Point"
        or not isinstance(properties, dict)
    ):
        return None

    coordinates = geometry.get("coordinates")
    if not isinstance(coordinates, list) or len(coordinates) < 2:
        return None
    longitude = _as_finite_number(coordinates[0])
    latitude = _as_finite_number(coordinates[1])
    magnitude = _as_finite_number(properties.get("mag"))
    timestamp = properties.get("time")
    if (
        longitude is None
        or latitude is None
        or not -180 <= longitude <= 180
        or not -90 <= latitude <= 90
        or magnitude is None
        or isinstance(timestamp, bool)
        or not isinstance(timestamp, int)
        or timestamp <= 0
    ):
        return None

    depth = (
        _as_finite_number(coordinates[2]) if len(coordinates) > 2 else None
    )
    place = properties.get("place")
    magnitude_type = properties.get("magType")
    source_url = properties.get("url")
    parsed_source_url = urlparse(source_url) if isinstance(source_url, str) else None
    return {
        "id": event_id.strip(),
        "magnitude": magnitude,
        "magnitude_type": magnitude_type if isinstance(magnitude_type, str) else None,
        "place": place.strip() if isinstance(place, str) and place.strip() else None,
        "longitude": longitude,
        "latitude": latitude,
        "depth_km": depth,
        "time_ms": timestamp,
        "time": datetime.fromtimestamp(timestamp / 1000, tz=timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z"),
        "url": (
            source_url
            if parsed_source_url is not None
            and parsed_source_url.scheme == "https"
            and parsed_source_url.hostname == "earthquake.usgs.gov"
            and parsed_source_url.port is None
            else f"{USGS_BASE}{urllib.parse.quote(event_id.strip(), safe='')}"
        ),
        "significance": _as_finite_number(properties.get("sig")),
    }


def normalize_feature_collection(payload: Any) -> list[dict[str, Any]]:
    """Normalize valid earthquake points and drop invalid/duplicate records."""
    if not isinstance(payload, dict) or not isinstance(payload.get("features"), list):
        raise UsgsDataError("USGS response is not a GeoJSON feature collection.")

    events: list[dict[str, Any]] = []
    seen: set[str] = set()
    for candidate in payload["features"]:
        event = _normalized_event(candidate)
        if event is None or event["id"] in seen:
            continue
        events.append(event)
        seen.add(event["id"])
        if len(events) == MAX_EVENTS:
            break
    return events


def build_query_url(region: str, now: datetime | None = None) -> str:
    """Create a bounded, documented FDSN query for India or a global snapshot."""
    if region not in {"india", "global"}:
        raise ValueError(f"Unsupported region: {region!r}")

    provided_time = now or datetime.now(timezone.utc)
    if provided_time.tzinfo is None:
        raise ValueError("The query time must include a timezone.")
    current_time = provided_time.astimezone(timezone.utc)
    start_time = (current_time - timedelta(days=30)).isoformat(
        timespec="seconds"
    ).replace("+00:00", "Z")
    end_time = current_time.isoformat(timespec="seconds").replace("+00:00", "Z")
    parameters: dict[str, str] = {
        "format": "geojson",
        "starttime": start_time,
        "endtime": end_time,
        "limit": str(MAX_EVENTS),
        "orderby": "time",
    }
    parameters.update(
        {
            name: str(bound)
            for name, bound in REGION_BOUNDS.get(region, {}).items()
        }
    )
    return f"{USGS_QUERY_URL}?{urllib.parse.urlencode(parameters)}"


def _read_usgs_response(region: str) -> Any:
    request = urllib.request.Request(
        build_query_url(region),
        headers={
            "Accept": "application/geo+json, application/json",
            "User-Agent": "QuakeWatchAI/1.0 (USGS catalog viewer)",
        },
        method="GET",
    )
    with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
        if response.status != 200:
            raise UsgsDataError(f"USGS returned HTTP {response.status}.")
        return json.loads(response.read())


def fetch_usgs(region: str) -> tuple[list[dict[str, Any]], str]:
    """Fetch the real USGS response with a bounded timeout and retry budget."""
    if region not in {"india", "global"}:
        raise ValueError(f"Unsupported region: {region!r}")

    for attempt in range(MAX_ATTEMPTS):
        try:
            payload = _read_usgs_response(region)
            metadata = payload.get("metadata") if isinstance(payload, dict) else None
            status = metadata.get("status") if isinstance(metadata, dict) else 200
            if status != 200:
                raise UsgsDataError(f"USGS catalog reported status {status}.")
            return normalize_feature_collection(payload), _isoformat_utc(
                datetime.now(timezone.utc)
            )
        except (
            urllib.error.HTTPError,
            urllib.error.URLError,
            TimeoutError,
            json.JSONDecodeError,
            UsgsDataError,
        ) as error:
            retryable = not isinstance(error, urllib.error.HTTPError) or error.code in {
                429,
                500,
                502,
                503,
                504,
            }
            if attempt + 1 >= MAX_ATTEMPTS or not retryable:
                LOGGER.warning("USGS %s query failed: %s", region, error)
                raise UsgsDataError(
                    "The live USGS catalog is temporarily unavailable."
                ) from error
            time.sleep(random.uniform(0.15, 0.45) * (attempt + 1))

    raise UsgsDataError("The live USGS catalog is temporarily unavailable.")
