#!/usr/bin/env python3
"""Qualify the production BFF with accepted server/provider fixtures (stdlib 3.11+).

Provider protocol stays in the hash-pinned server fixture. BFF requests use the
actual production Next.js process, verified TLS and disposable private Valkey.
Reports contain only source/image identities, counts and sanitized check names.
"""
import argparse
import base64
import hashlib
from http.client import HTTPConnection, HTTPSConnection
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib
import json
import os
import select
from pathlib import Path
import signal
import socket
import ssl
import subprocess
import sys
import threading
import time
import traceback
import urllib.parse

ROOT = Path(__file__).resolve().parents[2]
SOURCE = json.loads((ROOT / "docs/authentication-project-source.json").read_text())
VALKEY = "docker.io/valkey/valkey:9.1.2-alpine3.24@sha256:48332870af354a799964c0012ae1194a0bf2bf894eb508f945810596dc2d8d11"
LDAP = "ghcr.io/rroemhild/docker-test-openldap@sha256:3470e15c60119a1c0392cc162cdce71edfb42b55affdc69da574012f956317cd"
FRONTEND = "https://localhost:48601"


class DeferredReturn(Exception):
    def __init__(self, url):
        super().__init__("Fixture deliberately deferred the frontend return")
        self.url = url


class Proxy(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def request_body(self):
        """The real BFF streams generic proxy writes using HTTP/1.1 chunks."""
        limit = 1024 * 1024
        if self.headers.get("Transfer-Encoding", "").lower() != "chunked":
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 <= size <= limit:
                raise ValueError("Fixture request exceeds its bound")
            body = self.rfile.read(size)
            if len(body) != size:
                raise ValueError("Incomplete fixture request")
            return body
        body = bytearray()
        while True:
            line = self.rfile.readline(129)
            if len(line) > 128 or not line.endswith(b"\r\n"):
                raise ValueError("Invalid fixture chunk header")
            size = int(line.split(b";", 1)[0], 16)
            if not 0 <= size <= limit - len(body):
                raise ValueError("Fixture request exceeds its bound")
            if size == 0:
                remaining = 8192
                while remaining > 0:
                    trailer = self.rfile.readline(remaining + 1)
                    remaining -= len(trailer)
                    if trailer == b"\r\n":
                        return bytes(body)
                    if not trailer.endswith(b"\r\n"):
                        break
                raise ValueError("Invalid fixture trailers")
            chunk = self.rfile.read(size)
            if len(chunk) != size or self.rfile.read(2) != b"\r\n":
                raise ValueError("Incomplete fixture chunk")
            body.extend(chunk)

    def forward(self):
        try:
            body = self.request_body()
        except ValueError:
            self.send_error(400, "Invalid bounded fixture request")
            return
        headers = {key: value for key, value in self.headers.items() if key.lower() not in ("host", "connection", "transfer-encoding", "content-length")}
        headers.update(self.upstream_headers())
        connection = self.connection_to_upstream()
        try:
            if self.command == "POST" and self.path == "/api/v1/auth/interactions":
                self.server.begins = getattr(self.server, "begins", 0) + 1
            connection.request(self.command, self.path, body, headers)
            response = connection.getresponse()
            if self.path in getattr(self.server, "record_public_paths", ()):
                self.server.public_statuses.append({"path": self.path, "status": response.status})
            result = response.read(2 * 1024 * 1024)
            completion = self.command == "POST" and self.path.startswith("/api/v1/auth/interactions/") and self.path.endswith("/complete")
            if completion:
                self.server.completions = getattr(self.server, "completions", 0) + 1
            if completion and response.status == 200 and getattr(self.server, "hold_next_completion", False):
                self.server.hold_next_completion = False
                self.server.completion_received.set()
                if not self.server.release_completion.wait(20):
                    raise TimeoutError("Disposable completion barrier timed out")
            lost_return = getattr(self.server, "drop_next_return", False) and self.path.startswith("/_hubuum-bff/auth/interactions/return?") and response.status == 303
            lost_completion = getattr(self.server, "drop_next_completion", False) and self.command == "POST" and self.path.startswith("/api/v1/auth/interactions/") and self.path.endswith("/complete") and response.status == 200
            mutation = self.command == "POST" and self.path.startswith("/api/v1/iam/principals/") and self.path.endswith("/tokens")
            if mutation:
                self.server.mutations = getattr(self.server, "mutations", 0) + 1
            lost_mutation = mutation and response.status == 201 and getattr(self.server, "drop_next_mutation", False)
            if lost_return or lost_completion or lost_mutation:
                self.server.drop_next_return = self.server.drop_next_completion = self.server.drop_next_mutation = False
                self.connection.shutdown(socket.SHUT_RDWR)
                self.close_connection = True
                return
            self.send_response(response.status)
            for key, value in response.getheaders():
                if key.lower() not in ("connection", "transfer-encoding", "content-length"):
                    self.send_header(key, value)
            self.send_header("Content-Length", str(len(result)))
            self.end_headers()
            self.wfile.write(result)
        except (OSError, TimeoutError):
            try:
                self.send_error(503, "Disposable frontend is starting or restarting")
            except OSError:
                pass
        finally:
            connection.close()

    do_GET = do_POST = do_PATCH = do_DELETE = forward

    def upstream_headers(self):
        return {"Host": "localhost:48601", "X-Forwarded-Proto": "https", "X-Forwarded-Host": "localhost:48601"}

    def connection_to_upstream(self):
        return HTTPConnection("127.0.0.1", 48600, timeout=40)


class BackendProxy(Proxy):
    def upstream_headers(self):
        return {"Host": self.server.upstream_host}

    def connection_to_upstream(self):
        return HTTPSConnection("localhost", self.server.upstream_port, context=self.server.upstream_tls, timeout=40)


def definition(fixture, profile):
    if profile == "ldap":
        return {"scope": "company", "url": "ldaps://planetexpress.com:10636",
                "bind_dn": "cn=admin,dc=planetexpress,dc=com", "bind_password": "GoodNewsEveryone",
                "user_base_dn": "ou=people,dc=planetexpress,dc=com", "user_filter": "(uid={username})",
                "subject_attribute": "entryUUID", "group_attributes": ["memberOf"], "group_rules": []}
    if profile != "oauth":
        return {"issuer": fixture.issuer, "client_id": "hubuum", "client_authentication": "client_secret_basic",
                "scopes": ["openid", "profile", "email"], "signing_algorithms": ["RS256"], "retain_refresh_tokens": True,
                "membership": {"mode": "provider_groups", "refresh_interval_seconds": 5, "max_stale_seconds": 15,
                               "claim_source": profile, "claim_pointer": "/groups", "key_mode": "full_path"},
                "admission": {"mode": "provision_without_grants"}, "credential": {"action": "replace", "value": fixture.client_secret}}
    return {"profile": "json_user", "authorization_endpoint": fixture.provider_origin + "/authorize",
            "token_endpoint": f"https://host.docker.internal:{fixture.provider_port}/token",
            "profile_endpoint": f"https://host.docker.internal:{fixture.provider_port}/account", "client_id": "fixture",
            "client_authentication": "client_secret_basic", "scopes": ["identity"], "subject_pointer": "/account/key",
            "subject_type": "string", "name_pointer": "/account/display", "profile_headers": {"x-profile-version": "2"},
            "membership": {"mode": "provider_groups", "claim_source": "profile", "claim_pointer": "/roles", "key_mode": "immutable_id",
                           "refresh_interval_seconds": 5, "max_stale_seconds": 15},
            "admission": {"mode": "provision_without_grants"}, "credential": {"action": "replace", "value": fixture.client_secret}}


class Consumer:
    def __init__(self, fixture, module, node, profile):
        self.fixture, self.module, self.node, self.profile = fixture, module, node, profile
        self.results = []
        class Browser(module.Browser):
            defer_return = False

            def follow(self, url, body=None, *, headers=None, form=False, stop_origin=None):
                result = super().follow(url, body, headers=headers, form=form,
                                        stop_origin=stop_origin or (FRONTEND if self.defer_return else None))
                if self.defer_return and result[0].startswith(FRONTEND):
                    raise DeferredReturn(result[0])
                return result

        self.front = Browser(fixture.root / "mount/ca.pem")
        self.admin = Browser(fixture.root / "mount/ca.pem")
        self.prefix = fixture.prefix + ":"
        self.process = None
        self.browser_ui = False
        self.admin_ui = False
        self.log = (fixture.root / "frontend.log").open("w")
        os.chmod(fixture.root / "frontend.log", 0o600)
        self.secrets = [fixture.local_password, fixture.client_secret]
        if profile == "ldap":
            self.secrets.append(fixture.ldap_password)

    def start(self):
        self.valkey = self.fixture.run("valkey", "--publish", "127.0.0.1::6379", "--tmpfs", "/data", VALKEY,
                                      "valkey-server", "--save", "", "--appendonly", "no")
        port = self.module.command("docker", "port", self.valkey, "6379/tcp").rsplit(":", 1)[1]
        self.env = {key: value for key, value in os.environ.items() if key not in (
            "NODE_TLS_REJECT_UNAUTHORIZED", "NODE_OPTIONS", "SETUP_KEY")}
        self.env.update(BACKEND_BASE_URL="https://localhost:48602", AUTH_BROWSER_ORIGIN=self.fixture.origin,
                        AUTH_BFF_RETURN_TARGET_ID="frontend", VALKEY_URL="redis://127.0.0.1:" + port + "/0",
                        SESSION_PREFIX=self.prefix, NODE_EXTRA_CA_CERTS=str(self.fixture.root / "mount/ca.pem"),
                        NEXT_TELEMETRY_DISABLED="1")
        self.env["PATH"] = str(self.node.parent) + os.pathsep + self.env.get("PATH", "")
        self.proxy = ThreadingHTTPServer(("127.0.0.1", 48601), Proxy)
        self.proxy.daemon_threads = True
        tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        tls.load_cert_chain(self.fixture.root / "mount/server.pem", self.fixture.root / "mount/server.key")
        self.proxy.socket = tls.wrap_socket(self.proxy.socket, server_side=True)
        self.proxy_thread = threading.Thread(target=self.proxy.serve_forever, daemon=True)
        self.proxy_thread.start()
        self.backend_proxy = ThreadingHTTPServer(("127.0.0.1", 48602), BackendProxy)
        self.backend_proxy.daemon_threads = True
        upstream = urllib.parse.urlsplit(self.fixture.origin)
        self.backend_proxy.upstream_host = upstream.netloc
        self.backend_proxy.upstream_port = upstream.port
        self.backend_proxy.upstream_tls = ssl.create_default_context(cafile=str(self.fixture.root / "mount/ca.pem"))
        self.backend_proxy.socket = tls.wrap_socket(self.backend_proxy.socket, server_side=True)
        self.backend_thread = threading.Thread(target=self.backend_proxy.serve_forever, daemon=True)
        self.backend_thread.start()
        self.start_process()

    def start_process(self):
        self.process = subprocess.Popen([str(self.node), "scripts/start-standalone.mjs", "--port", "48600", "--listen", "127.0.0.1"],
                                        cwd=ROOT, env=self.env, stdout=self.log, stderr=subprocess.STDOUT, start_new_session=True)
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            if self.process.poll() is not None:
                raise RuntimeError("Production frontend exited before readiness")
            try:
                if self.front.request(FRONTEND + "/healthz")[0] == 200:
                    return
            except OSError:
                pass
            time.sleep(0.2)
        raise RuntimeError("Production frontend readiness deadline exceeded")

    def stop_process(self):
        if self.process and self.process.poll() is None:
            os.killpg(self.process.pid, signal.SIGTERM)
            try:
                self.process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                os.killpg(self.process.pid, signal.SIGKILL)
                self.process.wait(timeout=10)

    def cleanup(self):
        self.stop_process()
        if hasattr(self, "proxy"):
            self.proxy.shutdown()
            self.proxy.server_close()
            self.proxy_thread.join(timeout=5)
        if hasattr(self, "backend_proxy"):
            self.backend_proxy.shutdown()
            self.backend_proxy.server_close()
            self.backend_thread.join(timeout=5)
        self.log.close()

    def passed(self, name):
        self.results.append(name)
        print(self.profile + ": " + name, flush=True)

    def api(self, path, body=None, *, browser=None, expected=(200,), credential_output=False, origin=FRONTEND, headers=None):
        status, response_headers, raw = (browser or self.front).request(FRONTEND + "/_hubuum-bff/" + path, body,
                                                             headers={"Origin": origin, **(headers or {})})
        if status not in expected:
            reason = json.loads(raw).get("reason", "unspecified") if raw.startswith("{") else "non-json"
            # Reasons are selected from the server-owned stable vocabulary only.
            safe = reason if reason in ("interaction_invalid", "access_denied", "interaction_expired", "capability_unsupported", "protocol_error", "cleanup_unconfirmed") else "unspecified"
            raise RuntimeError(f"BFF request returned {status} ({safe})")
        captured = raw + json.dumps(list(response_headers.items()))
        if any(value in captured for value in self.secrets) or any(prefix in captured for prefix in ("hai1.", "hca1.", "hcv1.")):
            raise RuntimeError("BFF exposed a fixture secret or reusable proof")
        value = json.loads(raw) if raw else None
        def check_fields(item):
            if isinstance(item, dict):
                for key, child in item.items():
                    if key in ("access_token", "refresh_token", "redemption_secret", "approval", "verification_receipt") or (key == "token" and isinstance(child, str) and not credential_output):
                        raise RuntimeError("Unexpected reusable credential field in browser output")
                    check_fields(child)
            elif isinstance(item, list):
                for child in item:
                    check_fields(child)
        check_fields(value)
        return value, response_headers

    def sid(self, browser):
        return next(cookie.value for cookie in browser.cookies if cookie.name == "hubuum.sid")

    def private_value(self, key):
        raw = self.module.command("docker", "exec", "-i", self.valkey, "valkey-cli", "--raw", "-x", "GET", input=key)
        return json.loads(raw)

    def snapshot(self, browser):
        value = self.private_value(self.prefix + self.sid(browser))
        self.secrets.extend([value["token"], value["refreshToken"]])
        if self.fixture.local_password in json.dumps(value):
            raise RuntimeError("Frontend persisted the login password")
        return value

    def authorize(self, flow, browser, decision="approve", defer=False):
        event = {"id": flow["id"], "next": flow["next"]}
        if flow["purpose"] == "credential_approval":
            event["_operation"] = True
        browser.defer_return = defer
        try:
            if self.profile in ("local", "ldap"):
                url, status, page = browser.follow(flow["next"]["verification_uri"])
                if status != 200:
                    raise RuntimeError("Hosted password entry unavailable")
                url, status, page = browser.submit(url, page, {"user_code": flow["next"]["user_code"]})
                if status == 200 and "/provider\"" in page:
                    url, status, page = browser.submit(url, page)
                if status != 200 or "name=\"password\"" not in page:
                    fields = {name for item in self.module.Forms(page).forms for name in item["fields"]}
                    known = sorted(fields & {"name", "password", "csrf", "user_code", "decision"})
                    raise RuntimeError(f"Hosted LDAP credentials form unavailable (HTTP {status}; fields {known})")
                username, password = ("admin", self.fixture.local_password) if self.profile == "local" else ("amy", self.fixture.ldap_password)
                url, status, page = browser.submit(url, page, {"name": username, "password": password})
                if status != 200 or "Approve this request?" not in page:
                    raise RuntimeError("Hosted LDAP explicit approval unavailable")
                url, status, _ = browser.submit(url, page, {"decision": decision})
                if status != 200:
                    raise RuntimeError("Hosted LDAP decision failed")
                return url
            if self.profile == "oauth":
                if decision != "approve":
                    raise RuntimeError("OAuth denial uses the dedicated provider fixture")
                original = self.module.Browser
                self.module.Browser = lambda _ca: browser
                try:
                    return self.fixture.authorize(event)
                finally:
                    self.module.Browser = original
            return self.fixture.authorize(event, browser=browser, decision=decision)
        except DeferredReturn as returned:
            return returned.url
        finally:
            browser.defer_return = False

    def counts(self):
        return {table: int(self.fixture.sql(f"SELECT count(*) FROM {table}")) for table in (
            "users", "principals", "group_memberships", "group_membership_sources", "auth_sessions", "auth_upstream_credentials")}

    def result(self, flow, browser, *, expected=(200,), credential_output=False):
        deadline = time.monotonic() + 45
        while time.monotonic() < deadline:
            value, _ = self.api(f"auth/interactions/{flow['id']}/result", {"nonce": flow["nonce"]}, browser=browser,
                                expected=expected, credential_output=credential_output)
            if value.get("state") not in ("pending", "claimed"):
                return value
            time.sleep(min(value.get("interval_seconds", 1), 10))
        raise RuntimeError("BFF completion result deadline exceeded")

    def browser_return(self, returned):
        public_key = subprocess.check_output(["openssl", "x509", "-in", str(self.fixture.root / "mount/server.pem"), "-pubkey", "-noout"])
        der = subprocess.check_output(["openssl", "pkey", "-pubin", "-outform", "DER"], input=public_key)
        spki = base64.b64encode(hashlib.sha256(der).digest()).decode()
        result = subprocess.run([str(self.node), "tests/integration/browser-security.mjs"], cwd=ROOT, env=self.env,
                                input=json.dumps({"returnUrl": returned, "sid": self.sid(self.front), "spki": spki}),
                                text=True, capture_output=True, timeout=90)
        if result.returncode:
            raise RuntimeError("Production Chromium return/cookie/storage security check failed")
        accepted = json.loads(result.stdout)
        if accepted.get("passed") is not True:
            raise RuntimeError("Production Chromium returned no acceptance")
        # The real browser received this exact opaque cookie; keep the HTTP
        # consumer attached to that same session for the remaining assertions.
        for cookie in self.front.cookies:
            if cookie.name == "hubuum.sid":
                cookie.value = accepted["sid"]
        self.passed("actual Chromium return rotates a Secure HttpOnly cookie, leaves browser storage empty and cannot replay issuance")

    def browser_login_ui(self):
        public_key = subprocess.check_output(["openssl", "x509", "-in", str(self.fixture.root / "mount/server.pem"), "-pubkey", "-noout"])
        der = subprocess.check_output(["openssl", "pkey", "-pubin", "-outform", "DER"], input=public_key)
        password = self.fixture.local_password if self.profile == "local" else self.fixture.ldap_password if self.profile == "ldap" else getattr(self.fixture, "password", "")
        result = subprocess.run([str(self.node), "tests/integration/browser-login.mjs"], cwd=ROOT, env=self.env,
                                input=json.dumps({"profile": self.profile, "provider": self.provider, "serverOrigin": self.fixture.origin,
                                                  "spki": base64.b64encode(hashlib.sha256(der).digest()).decode(),
                                                  "eligibilityInterval": 30,
                                                  "username": "admin" if self.profile == "local" else "amy" if self.profile == "ldap" else "alice", "password": password}),
                                text=True, capture_output=True, timeout=180)
        if result.returncode:
            failure = json.loads(result.stderr)
            failure["interaction_phases"] = json.loads(self.fixture.sql("SELECT coalesce(json_agg(json_build_object('state',document#>>'{lifecycle,phase,state}','reason',document#>>'{lifecycle,phase,reason}')), '[]')::text FROM auth_interactions"))
            failure["external_state_counts"] = {
                "active_sessions": int(self.fixture.sql("SELECT count(*) FROM auth_sessions s JOIN principals p ON p.id=s.principal_id WHERE p.provider_managed AND s.revoked_at IS NULL")),
                "revoked_sessions": int(self.fixture.sql("SELECT count(*) FROM auth_sessions s JOIN principals p ON p.id=s.principal_id WHERE p.provider_managed AND s.revoked_at IS NOT NULL")),
                "retained_credentials": int(self.fixture.sql("SELECT count(*) FROM auth_upstream_credentials")),
                "proof_tokens": int(self.fixture.sql("SELECT count(*) FROM tokens WHERE name='ui-fresh-proof'")),
            }
            for check in failure["checks"]:
                self.passed(check)
            self.fixture.evidence.joinpath("ui-failure.json").write_text(json.dumps(failure, indent=2) + "\n")
            raise RuntimeError("Production browser login UI stopped at " + failure["stage"])
        outcome = json.loads(result.stdout)
        if outcome.get("passed") is not True:
            raise RuntimeError("Production browser login UI returned no acceptance")
        for check in outcome["checks"]:
            self.passed(check)

    def crash_owned_completion(self):
        flow, _ = self.api("auth/interactions", {"provider_id": self.provider, "purpose": "login", "return_path": "/healthz"}, expected=(201,))
        returned = self.authorize(flow, self.front, defer=True)
        active = int(self.fixture.sql("SELECT count(*) FROM auth_sessions WHERE revoked_at IS NULL"))
        retained = self.counts()["auth_upstream_credentials"]
        self.backend_proxy.completion_received = threading.Event()
        self.backend_proxy.release_completion = threading.Event()
        self.backend_proxy.hold_next_completion = True

        def callback():
            try:
                self.front.request(returned)
            except OSError:
                pass

        request = threading.Thread(target=callback, daemon=True)
        request.start()
        try:
            if not self.backend_proxy.completion_received.wait(15):
                raise RuntimeError("Backend did not reach the post-commit crash barrier")
            os.killpg(self.process.pid, signal.SIGKILL)
            self.process.wait(timeout=10)
        finally:
            self.backend_proxy.release_completion.set()
            request.join(timeout=10)
        if request.is_alive():
            raise RuntimeError("Crashed frontend request did not stop")
        completions = self.backend_proxy.completions
        self.start_process()
        deadline = time.monotonic() + 135
        while time.monotonic() < deadline:
            record = self.private_value(self.prefix + "auth:interaction:" + flow["id"])
            if record.get("state") == "finished":
                break
            time.sleep(2)
        else:
            raise RuntimeError("Restarted production cleanup worker did not recover its abandoned claim")
        if self.backend_proxy.completions != completions:
            raise RuntimeError("Crash recovery replayed backend completion")
        if int(self.fixture.sql("SELECT count(*) FROM auth_sessions WHERE revoked_at IS NULL")) != active or self.counts()["auth_upstream_credentials"] != retained:
            raise RuntimeError("Crash recovery left an active orphaned family or retained credential")
        if "redemption_secret" in record or "hai1." in json.dumps(record):
            raise RuntimeError("Crash recovery retained a completed redemption capability")
        self.api("auth/session", expected=(401,))
        self.passed("SIGKILL after backend issuance is recovered by the restarted production cleanup worker without replay or an orphaned family")

    def lost_mutation_result(self, principal):
        mutation = {"method": "POST", "path": f"/api/v1/iam/principals/{principal}/tokens", "body": {"name": "bff-lost-result"}}
        flow, _ = self.api("auth/interactions", {"provider_id": self.provider, "purpose": "credential_approval", "mutation": mutation, "return_path": "/healthz"}, expected=(201,))
        before = self.backend_proxy.mutations
        self.backend_proxy.drop_next_mutation = True
        self.authorize(flow, self.front)
        result = self.result(flow, self.front)
        if result["result"]["body"].get("reason") != "operation_outcome_unknown" or self.backend_proxy.mutations != before + 1 or self.backend_proxy.drop_next_mutation:
            raise RuntimeError("Lost protected mutation result was replayed or presented as a confirmed outcome")
        rows = self.fixture.sql("SELECT id FROM tokens WHERE name = 'bff-lost-result'").splitlines()
        if len(rows) != 1 or not rows[0].isdigit():
            raise RuntimeError("Lost protected operation did not create exactly one inspectable credential")
        path = f"hubuum/api/v1/iam/principals/{principal}/tokens/{rows[0]}"
        _, metadata = self.api(path)
        self.api(path + "/revoke", {}, expected=(204,), headers={"If-Match": metadata["ETag"]})
        self.api(f"auth/interactions/{flow['id']}/result", {"nonce": flow["nonce"]}, expected=(409,))
        self.passed("lost protected mutation result is reported as uncertain without replay and its one created credential can be inspected and revoked")

    def provider_configuration(self):
        spec = definition(self.fixture, self.profile)
        if self.browser_ui and "membership" in spec:
            # Exercise complete UI actions before forcing the next due refresh.
            # The server's protocol fixture separately stresses five-second leases.
            spec["membership"].update(refresh_interval_seconds=30, max_stale_seconds=90)
        return spec

    def browser_admin_ui(self):
        public_key = subprocess.check_output(["openssl", "x509", "-in", str(self.fixture.root / "mount/server.pem"), "-pubkey", "-noout"])
        der = subprocess.check_output(["openssl", "pkey", "-pubin", "-outform", "DER"], input=public_key)
        configuration = self.provider_configuration()
        credential = configuration.pop("bind_password") if self.profile == "ldap" else configuration.pop("credential")["value"]
        payload = {"profile": self.profile, "serverOrigin": self.fixture.origin, "spki": base64.b64encode(hashlib.sha256(der).digest()).decode(),
                   "localPassword": self.fixture.local_password, "configuration": configuration, "credential": credential,
                   "username": "amy" if self.profile == "ldap" else "alice",
                   "password": self.fixture.ldap_password if self.profile == "ldap" else getattr(self.fixture, "password", "")}
        child = subprocess.Popen([str(self.node), "tests/integration/browser-admin.mjs"], cwd=ROOT, env=self.env,
                                 stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        before = None
        deadline = time.monotonic() + 180
        complete = False
        try:
            child.stdin.write(json.dumps(payload) + "\n")
            child.stdin.flush()
            while time.monotonic() < deadline:
                if not select.select([child.stdout], [], [], min(5, max(0, deadline - time.monotonic())))[0]:
                    continue
                line = child.stdout.readline()
                if not line:
                    break
                event = json.loads(line)
                if event["event"] == "candidate-created":
                    self.fixture.provider_id = self.provider = event["provider"]
                    if self.profile in ("id_token", "userinfo"):
                        client = self.fixture.provider_api("/clients?clientId=hubuum")[0]
                        client["redirectUris"] = [self.fixture.origin + "/api/v1/auth/callbacks/" + self.provider]
                        self.fixture.provider_api("/clients/" + client["id"], client, method="PUT")
                elif event["event"] == "preview-before":
                    before = self.counts()
                elif event["event"] == "preview-after":
                    if before is None or before != self.counts():
                        raise RuntimeError("Product candidate preview changed persistent identity, membership, session or credential counts")
                    self.passed("product administration preview leaves all six persistent identity, membership, session and credential counts unchanged")
                elif event["event"] == "failure":
                    self.fixture.evidence.joinpath("admin-ui-failure.json").write_text(json.dumps(event, indent=2) + "\n")
                    raise RuntimeError("Product administration UI stopped at " + event["stage"])
                elif event["event"] == "complete":
                    if event.get("passed") is not True or event["provider"] != self.provider:
                        raise RuntimeError("Product administration returned no matching provider acceptance")
                    for check in event["checks"]:
                        self.passed(check)
                    complete = True
                    break
                else:
                    raise RuntimeError("Unknown product administration checkpoint")
                child.stdin.write("ok\n")
                child.stdin.flush()
            if not complete or child.wait(timeout=10) != 0:
                raise RuntimeError("Product administration did not complete within its bounded deadline")
        finally:
            if child.poll() is None:
                child.kill()
                child.wait()
            child.stdin.close()
            child.stdout.close()
            child.stderr.close()

    def configure(self):
        self.api("auth/login", {"name": "admin", "password": self.fixture.local_password}, browser=self.admin)
        administrator = self.snapshot(self.admin)
        self.passed("ordinary local administrator login persists privately before external setup")
        if self.profile == "local":
            self.provider = "local"
            return
        if self.admin_ui:
            self.browser_admin_ui()
            return
        spec = self.provider_configuration()
        candidate = self.fixture.api("/api/v1/admin/runtime-settings/security-candidates", {
            "group": "authentication", "expected_revision": 1,
            "providers": [{"name": "company", "enabled": True, "source": "runtime", "kind": self.profile if self.profile in ("oauth", "ldap") else "oidc", "configuration": spec}]}, token=administrator["token"])
        self.fixture.provider_id = self.provider = candidate["providers"][0]["provider_id"]
        if self.profile in ("id_token", "userinfo"):
            client = self.fixture.provider_api("/clients?clientId=hubuum")[0]
            client["redirectUris"] = [self.fixture.origin + "/api/v1/auth/callbacks/" + self.provider]
            self.fixture.provider_api("/clients/" + client["id"], client, method="PUT")
        before = self.counts()
        if self.profile == "ldap":
            verified = self.fixture.api(f"/api/v1/admin/runtime-settings/security-candidates/{candidate['id']}/verify-ldap", {
                "provider_id": self.provider, "username": "amy", "password": self.fixture.ldap_password}, token=administrator["token"])["candidate"]
            if self.counts() != before or verified["state"] != "verified":
                raise RuntimeError("LDAP fixture preview changed identities or did not verify")
            self.passed("LDAPS fixture setup verifies without provisioning before hosted BFF login")
        else:
            flow, _ = self.api("auth/interactions", {"provider_id": self.provider, "purpose": "provider_verification", "candidate_id": candidate["id"], "return_path": "/healthz"}, browser=self.admin, expected=(201,))
            self.authorize(flow, self.admin)
            preview = self.result(flow, self.admin)
            if self.counts() != before or preview["result"]["candidate"]["state"] != "verified":
                raise RuntimeError("BFF candidate preview changed identities or did not verify")
            self.passed("actual BFF provider preview leaves six identity/session tables unchanged")
            vault = self.private_value(self.prefix + "auth:candidate:" + self.sid(self.admin) + ":" + candidate["id"])
            verified = vault["report"]
            if vault.get("credentialFingerprint") != hashlib.sha256(administrator["token"].encode()).hexdigest():
                raise RuntimeError("Candidate receipt lost its initiating credential binding")
            if "verification_receipt" in preview["result"]["candidate"] or not verified["verification_receipt"].startswith("hcv1."):
                raise RuntimeError("Candidate receipt did not stay in private Valkey")
            self.passed("activation receipt stays private while the browser receives a safe preview")
        self.fixture.admin = self.snapshot(self.admin)["token"]
        approval = self.fixture.api("/api/v1/iam/credential-approvals", {"password": self.fixture.local_password, "operation": {
            "kind": "activate_security_candidate", "candidate_id": candidate["id"], "group": "authentication", "expected_revision": 1}}, token=self.fixture.admin)
        status, _, _ = self.fixture.browser.request(self.fixture.origin + f"/api/v1/admin/runtime-settings/security-candidates/{candidate['id']}/activate", {
            "expected_revision": 1, "verification_receipt": verified["verification_receipt"]},
            headers={"Authorization": "Bearer " + self.fixture.admin, "X-Hubuum-Credential-Approval": approval["approval"]})
        if status != 200:
            raise RuntimeError("Fixture activation did not accept its exact receipt and fresh approval")
        self.passed("runtime provider setup activates through the fixture with its exact verified receipt")

    def qualify(self):
        self.configure()
        if self.browser_ui:
            self.browser_login_ui()
            return
        methods, _ = self.api("auth/methods")
        if not any(method["provider_id"] == "local" for method in methods["methods"]) or not any(method["provider_id"] == self.provider for method in methods["methods"]):
            raise RuntimeError("Typed discovery omitted local recovery or the active provider")
        self.passed("typed discovery includes the selected provider and always-on local authentication")
        flow, _ = self.api("auth/interactions", {"provider_id": self.provider, "purpose": "login", "return_path": "/healthz"}, expected=(201,))
        seed = self.sid(self.front)
        self.authorize(flow, self.front)
        self.api("auth/session")
        first = self.snapshot(self.front)
        if self.sid(self.front) == seed:
            raise RuntimeError("BFF did not rotate its pre-authentication cookie")
        cookie = next(cookie for cookie in self.front.cookies if cookie.name == "hubuum.sid")
        if not cookie.secure or not cookie.has_nonstandard_attr("HttpOnly"):
            raise RuntimeError("BFF session cookie is missing Secure/HttpOnly")
        who, _ = self.api("hubuum/api/v1/iam/me")
        principal = who["principal"]["principal_id"]
        self.passed("actual BFF completion rotates an opaque HttpOnly cookie and persists an ordinary session")
        self.stop_process()
        self.start_process()
        self.api("auth/session")
        if self.snapshot(self.front)["sessionId"] != first["sessionId"]:
            raise RuntimeError("Frontend restart replaced the session family")
        self.passed("frontend process restart resumes the same private session family")
        delay = max(0, (first["accessExpiresAt"] - time.time() * 1000) / 1000) + 0.1
        if delay > 35:
            raise RuntimeError("Fixture must use 30-second access credentials")
        time.sleep(delay)
        renewed, _ = self.api("hubuum/api/v1/iam/me")
        after = self.snapshot(self.front)
        if renewed["principal"]["principal_id"] != principal or after["sessionId"] != first["sessionId"] or after["token"] == first["token"]:
            raise RuntimeError("BFF renewal changed principal/family or failed to rotate")
        self.passed("ordinary distributed refresh rotates access while preserving principal and family")
        operation = {"method": "POST", "path": f"/api/v1/iam/principals/{principal}/tokens", "body": {"name": "bff-qualification"}}
        if self.profile == "oauth":
            unsupported, _ = self.api("auth/interactions", {"provider_id": self.provider, "purpose": "credential_approval", "mutation": operation}, expected=(422,))
            if unsupported["reason"] != "capability_unsupported":
                raise RuntimeError("OAuth fresh approval did not remain explicitly unsupported")
            self.passed("OAuth fresh approval reports an explicit unsupported capability without downgrade")
        else:
            flow, _ = self.api("auth/interactions", {"provider_id": self.provider, "purpose": "credential_approval", "mutation": operation, "return_path": "/healthz"}, expected=(201,))
            self.authorize(flow, self.front)
            result = self.result(flow, self.front, credential_output=True)
            if result["result"]["status"] != 201:
                raise RuntimeError("Fresh exact-operation credential creation failed")
            self.fixture.api("/api/v1/auth/logout", {}, token=result["result"]["body"]["token"])
            self.api(f"auth/interactions/{flow['id']}/result", {"nonce": flow["nonce"]}, expected=(409,))
            self.passed("fresh approval submits the current-principal mutation once and consumes its explicit result")
            if self.profile == "id_token":
                self.lost_mutation_result(principal)
        if self.profile != "local":
            before = self.backend_proxy.begins
            self.api("auth/interactions", {"provider_id": self.provider, "purpose": "provider_verification",
                     "candidate_id": "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa"}, expected=(403,))
            if self.backend_proxy.begins != before:
                raise RuntimeError("BFF contacted privileged authentication before its administrator boundary")
            self.passed("external non-administrator provider verification is rejected before backend interaction creation")
        before = self.backend_proxy.begins
        self.api("auth/interactions", {"provider_id": self.provider, "purpose": "login", "mutation": operation}, expected=(400,))
        if self.backend_proxy.begins != before:
            raise RuntimeError("Purpose-confused browser input reached backend interaction creation")
        self.passed("purpose-confused browser input is rejected before backend interaction creation")
        self.api("auth/logout", {})
        self.api("auth/session", expected=(401,))
        self.passed("logout destroys the matching frontend session and opaque cookie")
        if self.profile != "oauth":
            flow, _ = self.api("auth/interactions", {"provider_id": self.provider, "purpose": "login", "return_path": "/healthz"}, expected=(201,))
            before = self.counts()
            self.authorize(flow, self.front, decision="deny", defer=True)
            denied = self.result(flow, self.front, expected=(200, 403))
            if denied.get("reason") != "access_denied" or self.counts() != before:
                raise RuntimeError("BFF denial did not remain terminal and non-provisioning")
            self.passed("bounded BFF polling surfaces denial without a return callback or provisioning")
        flow, _ = self.api("auth/interactions", {"provider_id": self.provider, "purpose": "login"}, expected=(201,))
        self.api(f"auth/interactions/{flow['id']}/cancel", {"nonce": flow["nonce"]})
        self.api("auth/session", expected=(401,))
        self.passed("pending browser cancellation fences completion and leaves no frontend login")
        if self.profile == "id_token":
            flow, _ = self.api("auth/interactions", {"provider_id": self.provider, "purpose": "login", "return_path": "//attacker.example"}, expected=(201,))
            returned = self.authorize(flow, self.front, defer=True)
            status, headers, _ = self.front.request(returned)
            if status != 303 or headers.get("Location") != "/app":
                raise RuntimeError("Browser completion accepted an external return destination")
            self.api("auth/logout", {})
            self.passed("an external return destination completes only to the normalized local application path")
        flow, _ = self.api("auth/interactions", {"provider_id": self.provider, "purpose": "login", "return_path": "/healthz"}, expected=(201,))
        returned = self.authorize(flow, self.front, defer=True)
        parsed = urllib.parse.urlsplit(returned)
        query = urllib.parse.parse_qs(parsed.query)
        wrong = urllib.parse.urlunsplit(parsed._replace(query=urllib.parse.urlencode({"interaction_id": query["interaction_id"][0], "nonce": "b" * 43})))
        before = self.counts()
        if self.front.request(wrong)[0] != 401:
            raise RuntimeError("BFF accepted a mismatched return nonce")
        stranger = self.module.Browser(self.fixture.root / "mount/ca.pem")
        if stranger.request(returned)[0] != 401 or self.counts() != before:
            raise RuntimeError("Another browser consumed the approved interaction")
        self.proxy.drop_next_return = True
        try:
            self.front.request(returned)
        except OSError:
            pass
        else:
            raise RuntimeError("Fixture did not lose the committed frontend response")
        after_loss = self.counts()
        if after_loss["auth_sessions"] != before["auth_sessions"] + 1:
            raise RuntimeError("Lost frontend response did not create exactly one family")
        self.stop_process()
        self.start_process()
        self.browser_return(returned)
        if self.counts() != after_loss:
            raise RuntimeError("Recovery of a lost frontend response repeated backend issuance")
        self.passed("lost frontend response survives process restart and redelivers the existing cookie without new issuance")
        accepted = self.snapshot(self.front)
        before = self.counts()
        if self.front.follow(returned)[1] != 200 or self.counts() != before or self.snapshot(self.front)["sessionId"] != accepted["sessionId"]:
            raise RuntimeError("Return replay repeated issuance or replaced the family")
        self.passed("wrong nonce/browser cannot consume a return; accepted handoff replay preserves the same family")
        self.api("auth/interactions", {"provider_id": self.provider, "purpose": "login"}, expected=(403,), origin="https://attacker.example")
        self.passed("cross-origin browser mutation is rejected before new authentication")
        for path in ("auth/interactions", "%61uth/interactions", "auth%2Finteractions", "auth/%69nteractions"):
            self.api("hubuum/api/v1/" + path, {"client_id": "hubuum-frontend", "provider_id": self.provider,
                     "purpose": "login", "delivery": "poll", "interaction_mode": "browser"}, expected=(403,))
        for path in ("security-candidates", "%73ecurity-candidates"):
            self.api("hubuum/api/v1/admin/runtime-settings/" + path, expected=(403,))
        self.passed("production generic proxy blocks raw redemption and candidate secret surfaces")
        self.api("auth/logout", {})
        flow, _ = self.api("auth/interactions", {"provider_id": self.provider, "purpose": "login", "return_path": "/healthz"}, expected=(201,))
        returned = self.authorize(flow, self.front, defer=True)
        active = int(self.fixture.sql("SELECT count(*) FROM auth_sessions WHERE revoked_at IS NULL"))
        retained = self.counts()["auth_upstream_credentials"]
        self.backend_proxy.drop_next_completion = True
        status, _, _ = self.front.request(returned)
        if status not in (502, 503) or self.backend_proxy.drop_next_completion:
            raise RuntimeError("Fixture did not lose a successful backend completion response")
        if int(self.fixture.sql("SELECT count(*) FROM auth_sessions WHERE revoked_at IS NULL")) != active or self.counts()["auth_upstream_credentials"] != retained:
            raise RuntimeError("Lost backend response left an active issued family or retained credential")
        self.api("auth/session", expected=(401,))
        self.passed("lost successful backend completion response cancels and revokes only its issued family without installing a login")
        if self.profile == "oauth":
            self.crash_owned_completion()
        self.api("auth/login", {"name": "admin", "password": self.fixture.local_password}, browser=self.admin)
        self.passed("local recovery remains available after browser login, approval and cancellation")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--server-source", type=Path, required=True)
    parser.add_argument("--image", required=True)
    parser.add_argument("--node", type=Path, required=True)
    parser.add_argument("--profile", choices=("id_token", "userinfo", "oauth", "ldap", "local"), required=True)
    parser.add_argument("--evidence", type=Path, required=True)
    parser.add_argument("--browser-ui", action="store_true", help="Qualify actual product login and fresh-approval UI")
    parser.add_argument("--admin-ui", action="store_true", help="Qualify actual provider configure/test/activate UI before native login")
    args = parser.parse_args()
    node_version = subprocess.check_output([str(args.node), "--version"], text=True).strip()
    if not node_version.startswith("v24."):
        raise RuntimeError("Qualification requires Node.js 24 LTS")
    source = args.server_source.resolve()
    commit = subprocess.check_output(["git", "-C", str(source), "rev-parse", "HEAD"], text=True).strip()
    if commit != SOURCE["accepted_server_source"]:
        raise RuntimeError("Server fixture checkout is not accepted")
    for name, digest in SOURCE["source_live_fixture_sha256"].items():
        if hashlib.sha256((source / name).read_bytes()).hexdigest() != digest:
            raise RuntimeError("Server fixture source drift")
    image = json.loads(subprocess.check_output(["docker", "image", "inspect", args.image], text=True))[0]
    qualified = next((pin for pin in SOURCE["qualified_server_images"] if image["Id"] in (pin.get("docker_image_id"), pin["manifest"], pin["config"])), None)
    if not qualified:
        raise RuntimeError("Server image is not a qualified immutable candidate")
    sys.path.insert(0, str(source / "tests/python"))
    module = importlib.import_module("integration.oauth" if args.profile in ("oauth", "ldap", "local") else "integration.keycloak")

    class Fixture(module.Fixture):
        def certificates(self):
            mount = super().certificates()
            if args.profile == "ldap":
                directory = mount / "ldap"
                directory.mkdir()
                module.command("openssl", "req", "-new", "-newkey", "rsa:2048", "-nodes", "-subj", "/CN=planetexpress.com",
                               "-keyout", str(directory / "ldap.key"), "-out", str(self.root / "ldap.csr"))
                extensions = self.root / "ldap.ext"
                extensions.write_text("subjectAltName=DNS:planetexpress.com\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n")
                module.command("openssl", "x509", "-req", "-in", str(self.root / "ldap.csr"), "-CA", str(mount / "ca.pem"),
                               "-CAkey", str(self.root / "ca.key"), "-CAcreateserial", "-days", "2", "-extfile", str(extensions),
                               "-out", str(directory / "ldap.crt"))
                (directory / "ca.crt").write_bytes((mount / "ca.pem").read_bytes())
                (directory / "ldap.key").chmod(0o644)
            return mount

        def start(self):
            super().start()
            if args.profile == "ldap":
                ldap = self.run("ldap", "--network", self.network, "--network-alias", "planetexpress.com",
                                "--mount", f"type=bind,src={self.root / 'mount/ldap'},dst=/etc/ldap/ssl,readonly", LDAP)
                deadline = time.monotonic() + 90
                while True:
                    try:
                        result = module.command("docker", "exec", ldap, "ldappasswd", "-x", "-H", "ldap://127.0.0.1:10389",
                                                "-D", "cn=admin,dc=planetexpress,dc=com", "-w", "GoodNewsEveryone",
                                                "cn=Amy Wong+sn=Kroker,ou=people,dc=planetexpress,dc=com")
                        self.ldap_password = next(line.removeprefix("New password: ") for line in result.splitlines() if line.startswith("New password: "))
                        break
                    except RuntimeError:
                        if time.monotonic() >= deadline:
                            raise
                        time.sleep(1)

        def env(self, name, values):
            if name == "server":
                settings = json.loads(values["HUBUUM_AUTH_BROWSER"])
                settings["return_targets"].append({"id": "frontend", "client_id": "hubuum-frontend", "uri": FRONTEND + "/_hubuum-bff/auth/interactions/return"})
                values["HUBUUM_AUTH_BROWSER"] = json.dumps(settings)
                values["HUBUUM_SESSION_ACCESS_SECONDS"] = "120" if args.browser_ui or args.admin_ui else "30"
            return super().env(name, values)

    fixture = Fixture(args.image, args.evidence, 48479, 48480) if args.profile in ("oauth", "ldap", "local") else Fixture(args.image, args.evidence, 48477, 48478, args.profile)
    report = {"profile": args.profile, "source": SOURCE, "server_image": qualified, "valkey": VALKEY,
              "scope": "product provider administration and login/approval UI" if args.admin_ui else "product login/approval UI" if args.browser_ui else "BFF transport",
              "admin_ui_controller_sha256": hashlib.sha256((ROOT / "tests/integration/browser-admin.mjs").read_bytes()).hexdigest() if args.admin_ui else None,
              "provider_ui_controller_sha256": hashlib.sha256((ROOT / "tests/integration/browser-provider.mjs").read_bytes()).hexdigest() if args.browser_ui or args.admin_ui else None,
              "browser_ui_controller_sha256": hashlib.sha256((ROOT / "tests/integration/browser-login.mjs").read_bytes()).hexdigest() if args.browser_ui or args.admin_ui else None,
              "node_version": node_version, "ldap_image": LDAP if args.profile == "ldap" else None,
              "browser_controller_sha256": hashlib.sha256((ROOT / "tests/integration/browser-security.mjs").read_bytes()).hexdigest(),
              "controller_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), "checks": [], "passed": False,
              "frontend_source_commit": subprocess.check_output(["git", "-C", str(ROOT), "rev-parse", "HEAD"], text=True).strip(),
              "frontend_source_dirty": bool(subprocess.check_output(["git", "-C", str(ROOT), "status", "--porcelain"], text=True))}
    compiled = ROOT / ".next/standalone/.next/server"
    compiled_files = [(path.relative_to(compiled).as_posix(), hashlib.sha256(path.read_bytes()).hexdigest())
                      for path in sorted(compiled.rglob("*")) if path.is_file()]
    if not compiled_files:
        raise RuntimeError("Build the production standalone frontend before qualification")
    report["production_server_files"] = len(compiled_files)
    report["production_server_tree_sha256"] = hashlib.sha256(json.dumps(compiled_files, separators=(",", ":")).encode()).hexdigest()
    consumer = None
    try:
        fixture.start()
        identity_path = args.evidence / "images.json"
        identity = json.loads(identity_path.read_text())
        identity.pop("source_commit", None)
        identity.pop("source_dirty", None)
        identity.update(server_source_commit=commit, frontend_source_commit=report["frontend_source_commit"], frontend_source_dirty=report["frontend_source_dirty"])
        identity_path.write_text(json.dumps(identity, indent=2) + "\n")
        consumer = Consumer(fixture, module, args.node.resolve(), args.profile)
        consumer.browser_ui = args.browser_ui or args.admin_ui
        consumer.admin_ui = args.admin_ui
        report["checks"] = consumer.results
        consumer.start()
        consumer.qualify()
        report["passed"] = True
    except Exception as error:
        frames = traceback.extract_tb(error.__traceback__)
        report["failure"] = {"type": type(error).__name__, "location": Path(frames[-1].filename).name + ":" + str(frames[-1].lineno)}
        if type(error) is RuntimeError and Path(frames[-1].filename).resolve() == Path(__file__).resolve():
            report["failure"]["reason"] = str(error)
            print(str(error), file=sys.stderr)
        raise
    finally:
        if consumer:
            consumer.cleanup()
        fixture.cleanup()
        (args.evidence / "bff-qualification.json").write_text(json.dumps(report, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print("Production BFF qualification failed (" + type(error).__name__ + "); sanitized report retained.", file=sys.stderr)
        raise SystemExit(1) from None
