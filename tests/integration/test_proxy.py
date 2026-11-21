"""Regression tests for the shared authentication and authorization fixture proxy."""
from http.client import HTTPResponse
from pathlib import Path
import socket
import ssl
import unittest
from unittest.mock import Mock, patch

from authentication import Proxy, fixture_server_tls


def proxy_response(headers):
    upstream = Mock()
    response = upstream.getresponse.return_value
    response.status = 303
    response.getheaders.return_value = headers
    response.read.return_value = b"fixture"
    client, server = socket.socketpair()
    with client, server, patch.object(Proxy, "connection_to_upstream", return_value=upstream):
        client.settimeout(2)
        client.sendall(b"GET / HTTP/1.0\r\n\r\n")
        Proxy(server, ("127.0.0.1", 0), None)
        with HTTPResponse(client) as forwarded:
            forwarded.begin()
            return forwarded.status, forwarded.headers, forwarded.read()


class ProxyTests(unittest.TestCase):
    def test_redirect_and_each_cookie_survive_forwarding(self):
        status, headers, body = proxy_response([
            ("Location", "/return?step=2"), ("Set-Cookie", "first=1; HttpOnly"),
            ("Set-Cookie", "second=2; Secure"), ("X-Empty", ""), ("Connection", "close"),
            ("Transfer-Encoding", "chunked"), ("Content-Length", "99"),
        ])
        self.assertEqual(status, 303)
        self.assertEqual(headers["Location"], "/return?step=2")
        self.assertEqual(headers.get_all("Set-Cookie"), ["first=1; HttpOnly", "second=2; Secure"])
        self.assertEqual(headers["X-Empty"], "")
        self.assertNotIn("Connection", headers)
        self.assertNotIn("Transfer-Encoding", headers)
        self.assertEqual(headers.get_all("Content-Length"), [str(len(body))])
        self.assertEqual(body, b"fixture")

    def test_invalid_upstream_header_rejects_the_whole_response(self):
        for name, value in [
            ("Bad Name", "value"), ("Bad\nName", "value"), ("Bad:Name", "value"),
            ("X-Test", "first\rsecond"), ("X-Test", "first\nsecond"), ("X-Test", "\x00"),
        ]:
            with self.subTest(name=name, value=value):
                status, headers, body = proxy_response([("Location", "/return"), (name, value)])
                self.assertEqual(status, 502)
                self.assertNotIn("Location", headers)
                self.assertNotEqual(body, b"fixture")

    def test_server_context_requires_tls_1_2_or_newer(self):
        with patch.object(ssl.SSLContext, "load_cert_chain"):
            context = fixture_server_tls(Path("."))
        self.assertGreaterEqual(context.minimum_version, ssl.TLSVersion.TLSv1_2)
