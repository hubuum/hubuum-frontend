#!/usr/bin/env python3
"""Qualify the production BFF with accepted server/provider fixtures (stdlib 3.11+).

Provider protocol stays in the hash-pinned server fixture. BFF requests use the
actual production Next.js process, verified TLS and disposable private Valkey.
Reports contain only source/image identities, counts and sanitized check names.
"""
import argparse
import base64
import hashlib
from http.client import HTTPConnection
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib
import json
import os
from pathlib import Path
import signal
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

    def forward(self):
        body = self.rfile.read(min(int(self.headers.get("Content-Length", "0")), 1024 * 1024))
        headers = {key: value for key, value in self.headers.items() if key.lower() not in ("host", "connection", "transfer-encoding")}
        headers.update({"Host": "localhost:48601", "X-Forwarded-Proto": "https", "X-Forwarded-Host": "localhost:48601"})
        connection = HTTPConnection("127.0.0.1", 48600, timeout=40)
        try:
            connection.request(self.command, self.path, body, headers)
            response = connection.getresponse()
            result = response.read(2 * 1024 * 1024)
            self.send_response(response.status)
            for key, value in response.getheaders():
                if key.lower() not in ("connection", "transfer-encoding", "content-length"):
                    self.send_header(key, value)
            self.send_header("Content-Length", str(len(result)))
            self.end_headers()
            self.wfile.write(result)
        except (OSError, TimeoutError):
            self.send_error(503, "Disposable frontend is starting or restarting")
        finally:
            connection.close()

    do_GET = do_POST = do_PATCH = do_DELETE = forward


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
        self.log = (fixture.root / "frontend.log").open("w")
        os.chmod(fixture.root / "frontend.log", 0o600)
        self.secrets = [fixture.local_password, fixture.client_secret]

    def start(self):
        self.valkey = self.fixture.run("valkey", "--publish", "127.0.0.1::6379", "--tmpfs", "/data", VALKEY,
                                      "valkey-server", "--save", "", "--appendonly", "no")
        port = self.module.command("docker", "port", self.valkey, "6379/tcp").rsplit(":", 1)[1]
        self.env = {key: value for key, value in os.environ.items() if key not in (
            "NODE_TLS_REJECT_UNAUTHORIZED", "NODE_OPTIONS", "SETUP_KEY")}
        self.env.update(BACKEND_BASE_URL=self.fixture.origin, AUTH_BROWSER_ORIGIN=self.fixture.origin,
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
        self.log.close()

    def passed(self, name):
        self.results.append(name)
        print(self.profile + ": " + name, flush=True)

    def api(self, path, body=None, *, browser=None, expected=(200,), credential_output=False, origin=FRONTEND):
        status, headers, raw = (browser or self.front).request(FRONTEND + "/_hubuum-bff/" + path, body,
                                                             headers={"Origin": origin})
        if status not in expected:
            reason = json.loads(raw).get("reason", "unspecified") if raw.startswith("{") else "non-json"
            # Reasons are selected from the server-owned stable vocabulary only.
            safe = reason if reason in ("interaction_invalid", "access_denied", "interaction_expired", "capability_unsupported", "protocol_error", "cleanup_unconfirmed") else "unspecified"
            raise RuntimeError(f"BFF request returned {status} ({safe})")
        captured = raw + json.dumps(list(headers.items()))
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
        return value, headers

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
            if self.profile == "ldap":
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
                url, status, page = browser.submit(url, page, {"name": "amy", "password": self.fixture.ldap_password})
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

    def qualify(self):
        self.api("auth/login", {"name": "admin", "password": self.fixture.local_password}, browser=self.admin)
        administrator = self.snapshot(self.admin)
        self.passed("ordinary local administrator login persists privately before external setup")
        spec = definition(self.fixture, self.profile)
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
        methods, _ = self.api("auth/methods")
        if not any(method["provider_id"] == "local" for method in methods["methods"]) or not any(method["provider_id"] == self.provider for method in methods["methods"]):
            raise RuntimeError("Typed discovery omitted local recovery or the active provider")
        self.passed("typed discovery includes the runtime provider and always-on local authentication")
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
        self.browser_return(returned)
        accepted = self.snapshot(self.front)
        before = self.counts()
        if self.front.follow(returned)[1] != 200 or self.counts() != before or self.snapshot(self.front)["sessionId"] != accepted["sessionId"]:
            raise RuntimeError("Return replay repeated issuance or replaced the family")
        self.passed("wrong nonce/browser cannot consume a return; accepted handoff replay preserves the same family")
        self.api("auth/interactions", {"provider_id": self.provider, "purpose": "login"}, expected=(403,), origin="https://attacker.example")
        self.passed("cross-origin browser mutation is rejected before new authentication")
        self.api("hubuum/api/v1/auth/interactions", expected=(403,))
        self.api("hubuum/api/v1/admin/runtime-settings/security-candidates", expected=(403,))
        self.passed("production generic proxy blocks raw redemption and candidate secret surfaces")
        self.api("auth/logout", {})
        self.api("auth/login", {"name": "admin", "password": self.fixture.local_password}, browser=self.admin)
        self.passed("local recovery remains available after external provider activation")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--server-source", type=Path, required=True)
    parser.add_argument("--image", required=True)
    parser.add_argument("--node", type=Path, required=True)
    parser.add_argument("--profile", choices=("id_token", "userinfo", "oauth", "ldap"), required=True)
    parser.add_argument("--evidence", type=Path, required=True)
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
    module = importlib.import_module("integration.oauth" if args.profile in ("oauth", "ldap") else "integration.keycloak")

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
                values["HUBUUM_SESSION_ACCESS_SECONDS"] = "30"
            return super().env(name, values)

    fixture = Fixture(args.image, args.evidence, 48479, 48480) if args.profile in ("oauth", "ldap") else Fixture(args.image, args.evidence, 48477, 48478, args.profile)
    report = {"profile": args.profile, "source": SOURCE, "server_image": qualified, "valkey": VALKEY,
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
