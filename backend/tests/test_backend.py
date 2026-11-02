from __future__ import annotations

import json
import os
import unittest
from datetime import datetime, timezone
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

from backend.handler import lambda_handler
from backend.ingest_lambda import build_snapshot
from backend.ingest import (
    UsgsDataError,
    build_query_url,
    normalize_feature_collection,
)


def make_feature(
    event_id: str = "us7000test",
    *,
    longitude: object = 77.2,
    latitude: object = 28.6,
    depth: object = 10.0,
    magnitude: object = 3.5,
    timestamp: object = 1_798_500_000_000,
    place: object = "Delhi, India",
) -> dict:
    return {
        "type": "Feature",
        "id": event_id,
        "properties": {
            "mag": magnitude,
            "magType": "mb",
            "place": place,
            "time": timestamp,
            "url": f"https://earthquake.usgs.gov/earthquakes/eventpage/{event_id}",
            "sig": 152,
        },
        "geometry": {"type": "Point", "coordinates": [longitude, latitude, depth]},
    }


class NormalizeFeatureCollectionTests(unittest.TestCase):
    def test_normalizes_real_event_fields(self) -> None:
        events = normalize_feature_collection(
            {"type": "FeatureCollection", "features": [make_feature()]}
        )
        self.assertEqual(len(events), 1)
        event = events[0]
        self.assertEqual(event["id"], "us7000test")
        self.assertEqual(event["magnitude"], 3.5)
        self.assertEqual(event["place"], "Delhi, India")
        self.assertEqual(event["longitude"], 77.2)
        self.assertEqual(event["latitude"], 28.6)
        self.assertEqual(event["depth_km"], 10)
        self.assertEqual(event["time_ms"], 1_798_500_000_000)
        self.assertTrue(event["url"].startswith("https://earthquake.usgs.gov/"))

    def test_deduplicates_event_ids(self) -> None:
        events = normalize_feature_collection(
            {
                "type": "FeatureCollection",
                "features": [make_feature(), make_feature()],
            }
        )
        self.assertEqual([event["id"] for event in events], ["us7000test"])

    def test_drops_invalid_coordinates_and_values(self) -> None:
        features = [
            make_feature("invalid-longitude", longitude=181),
            make_feature("invalid-latitude", latitude=-91),
            make_feature("nan-coordinate", longitude=float("nan")),
            make_feature("missing-magnitude", magnitude=None),
            make_feature("string-timestamp", timestamp="not-a-timestamp"),
            make_feature(event_id=""),
        ]
        self.assertEqual(
            normalize_feature_collection(
                {"type": "FeatureCollection", "features": features}
            ),
            [],
        )

    def test_missing_optional_values_remain_explicitly_missing(self) -> None:
        event = make_feature("unknown-place", depth=None, place=None)
        event["properties"].pop("url")
        normalized = normalize_feature_collection(
            {"type": "FeatureCollection", "features": [event]}
        )[0]
        self.assertIsNone(normalized["place"])
        self.assertIsNone(normalized["depth_km"])
        self.assertEqual(
            normalized["url"],
            "https://earthquake.usgs.gov/earthquakes/eventpage/unknown-place",
        )

    def test_untrusted_event_link_is_not_returned_as_a_usgs_link(self) -> None:
        feature = make_feature("safe-id")
        feature["properties"]["url"] = (
            "https://earthquake.usgs.gov.attacker.example/event"
        )
        normalized = normalize_feature_collection(
            {"type": "FeatureCollection", "features": [feature]}
        )[0]
        self.assertEqual(
            normalized["url"],
            "https://earthquake.usgs.gov/earthquakes/eventpage/safe-id",
        )

    def test_rejects_malformed_geojson_top_level(self) -> None:
        with self.assertRaises(UsgsDataError):
            normalize_feature_collection({"features": "not-an-array"})

    def test_ignores_non_point_and_non_record_features(self) -> None:
        collection = {
            "type": "FeatureCollection",
            "features": [
                None,
                {"type": "Feature", "id": "line", "geometry": {"type": "LineString"}},
                make_feature(),
            ],
        }
        self.assertEqual(
            [event["id"] for event in normalize_feature_collection(collection)],
            ["us7000test"],
        )


class UsgsQueryTests(unittest.TestCase):
    def test_india_query_uses_documented_bounds_and_date_window(self) -> None:
        now = datetime(2026, 11, 2, 12, 0, tzinfo=timezone.utc)
        query = parse_qs(urlparse(build_query_url("india", now)).query)
        self.assertEqual(query["minlatitude"], ["5"])
        self.assertEqual(query["maxlatitude"], ["38"])
        self.assertEqual(query["minlongitude"], ["65"])
        self.assertEqual(query["maxlongitude"], ["100"])
        self.assertEqual(query["starttime"], ["2026-10-03T12:00:00Z"])
        self.assertEqual(query["endtime"], ["2026-11-02T12:00:00Z"])
        self.assertEqual(query["limit"], ["2000"])
        self.assertEqual(query["orderby"], ["time"])

    def test_global_query_does_not_apply_india_bounds(self) -> None:
        query = parse_qs(
            urlparse(
                build_query_url(
                    "global", datetime(2026, 11, 2, tzinfo=timezone.utc)
                )
            ).query
        )
        self.assertNotIn("minlatitude", query)

    def test_unknown_region_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            build_query_url("not-a-region")

    @patch.dict(os.environ, {}, clear=True)
    @patch("backend.handler.fetch_usgs")
    def test_api_returns_live_usgs_events_and_headers(self, fetch_mock) -> None:
        fetch_mock.return_value = ([{
            "id": "us7000test",
            "magnitude": 3.5,
            "magnitude_type": "mb",
            "place": "Delhi, India",
            "longitude": 77.2,
            "latitude": 28.6,
            "depth_km": 10,
            "time_ms": 1_798_500_000_000,
            "time": "2026-12-19T13:20:00.000Z",
            "url": "https://earthquake.usgs.gov/earthquakes/eventpage/us7000test",
            "significance": 152,
        }], "2026-11-02T12:00:00.000Z")
        response = lambda_handler(
            {
                "httpMethod": "GET",
                "path": "/events",
                "queryStringParameters": {"region": "india"},
            },
            None,
        )
        payload = json.loads(response["body"])
        self.assertEqual(response["statusCode"], 200)
        self.assertEqual(payload["data_source"], "USGS catalog · live FDSN query")
        self.assertEqual(payload["events"][0]["id"], "us7000test")
        self.assertFalse(payload["stale"])
        self.assertEqual(response["headers"]["Access-Control-Allow-Origin"], "*")

    def test_health_endpoint_is_healthy_without_cloud_credentials(self) -> None:
        response = lambda_handler(
            {"httpMethod": "GET", "path": "/health"}, None
        )
        self.assertEqual(response["statusCode"], 200)
        self.assertEqual(json.loads(response["body"])["status"], "ok")

    @patch("backend.handler.fetch_usgs")
    def test_api_validates_region(self, fetch_mock) -> None:
        response = lambda_handler(
            {
                "httpMethod": "GET",
                "path": "/events",
                "queryStringParameters": {"region": "earth"},
            },
            None,
        )
        self.assertEqual(response["statusCode"], 400)
        fetch_mock.assert_not_called()

    @patch.dict(os.environ, {}, clear=True)
    @patch("backend.handler.fetch_usgs", side_effect=UsgsDataError("upstream error"))
    def test_api_reports_upstream_errors_without_fake_data(self, _fetch_mock) -> None:
        response = lambda_handler(
            {
                "httpMethod": "GET",
                "path": "/events",
                "queryStringParameters": {"region": "india"},
            },
            None,
        )
        payload = json.loads(response["body"])
        self.assertEqual(response["statusCode"], 503)
        self.assertIn("USGS", payload["error"])
        self.assertNotIn("events", payload)
        self.assertEqual(response["headers"]["Retry-After"], "60")

    def test_api_rejects_unknown_route(self) -> None:
        response = lambda_handler({"httpMethod": "POST", "path": "/events"}, None)
        self.assertEqual(response["statusCode"], 404)

    def test_options_returns_cors_preflight(self) -> None:
        response = lambda_handler({"httpMethod": "OPTIONS", "path": "/events"}, None)
        self.assertEqual(response["statusCode"], 204)
        self.assertEqual(response["body"], "")
        self.assertEqual(response["headers"]["Access-Control-Allow-Methods"], "GET,OPTIONS")

    def test_s3_snapshot_contains_validated_source_records_and_freshness(self) -> None:
        events = normalize_feature_collection(
            {"type": "FeatureCollection", "features": [make_feature()]}
        )
        snapshot = json.loads(
            build_snapshot(events, "2026-11-02T12:00:00.000Z").decode("utf-8")
        )
        self.assertEqual(snapshot["data_source"], "USGS Earthquake Catalog")
        self.assertEqual(snapshot["events"][0]["id"], "us7000test")
        self.assertEqual(snapshot["retrieved_at"], "2026-11-02T12:00:00.000Z")


if __name__ == "__main__":
    unittest.main()
