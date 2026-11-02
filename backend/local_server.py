"""Run the Lambda API handler locally without AWS credentials."""

from __future__ import annotations

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

from backend.handler import lambda_handler


class ApiHandler(BaseHTTPRequestHandler):
    def _respond(self, method: str) -> None:
        parsed = urlsplit(self.path)
        query = {}
        if parsed.query:
            for part in parsed.query.split("&"):
                key, _, value = part.partition("=")
                from urllib.parse import unquote_plus

                query[unquote_plus(key)] = unquote_plus(value)
        result = lambda_handler(
            {
                "httpMethod": method,
                "path": parsed.path,
                "queryStringParameters": query,
            },
            None,
        )
        body = result.get("body", "")
        encoded = body.encode("utf-8")
        self.send_response(int(result["statusCode"]))
        for name, value in result.get("headers", {}).items():
            if name.lower() != "content-length":
                self.send_header(name, value)
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        if method != "HEAD":
            self.wfile.write(encoded)

    def do_GET(self) -> None:
        self._respond("GET")

    def do_OPTIONS(self) -> None:
        self._respond("OPTIONS")

    def log_message(self, fmt: str, *args: object) -> None:
        print(f"{self.address_string()} - {fmt % args}")


if __name__ == "__main__":
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "8000"))
    with ThreadingHTTPServer((host, port), ApiHandler) as server:
        print(f"QuakeWatch API listening on http://{host}:{port}")
        server.serve_forever()
