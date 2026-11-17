"""Explicit production Treetop administration qualification; standard library only."""
import argparse
import base64
import functools
import hashlib
from http.server import ThreadingHTTPServer
from http.client import HTTPConnection
import importlib
import json
import os
from pathlib import Path
import select
import shutil
import ssl
import subprocess
import sys
import threading
import time
import traceback
import urllib.request

from authentication import Consumer, FRONTEND, Proxy, ROOT, SOURCE


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--server-source", type=Path, required=True)
    parser.add_argument("--image", required=True)
    parser.add_argument("--node", type=Path, required=True)
    parser.add_argument("--evidence", type=Path, required=True)
    parser.add_argument("--fixture-only", action="store_true", help="Prepare/check the real policy fixture without claiming product qualification")
    args = parser.parse_args()
    source = args.server_source.resolve()
    commit = subprocess.check_output(["git", "-C", str(source), "rev-parse", "HEAD"], text=True).strip()
    if commit != SOURCE["accepted_server_source"]:
        raise RuntimeError("Server fixture checkout is not accepted")
    image = json.loads(subprocess.check_output(["docker", "image", "inspect", args.image], text=True))[0]
    if not any(image["Id"] in (pin.get("docker_image_id"), pin["manifest"], pin["config"]) for pin in SOURCE["qualified_server_images"]):
        raise RuntimeError("Server image is not a qualified immutable candidate")
    if not subprocess.check_output([str(args.node), "--version"], text=True).startswith("v24."):
        raise RuntimeError("Qualification requires Node.js 24 LTS")
    sys.path.insert(0, str(source / "tests/python"))
    oauth = importlib.import_module("integration.oauth")
    support = importlib.import_module("support.treetop_server")
    pins = dict(line.split("=", 1) for line in (source / ".github/treetop-conformance.env").read_text().splitlines() if line and not line.startswith("#"))
    treetop_image = pins["HUBUUM_TREETOP_TEST_IMAGE"]
    if "@sha256:" not in treetop_image:
        raise RuntimeError("Policy service must be immutable")

    class Fixture(oauth.Fixture):
        def __init__(self):
            super().__init__(args.image, args.evidence, 48479, 48480)
            self.policy_http = self.policy_proxy = None
            self.policy_url = None

        def env(self, name, values):
            if name == "server":
                settings = json.loads(values["HUBUUM_AUTH_BROWSER"])
                settings["return_targets"].append({"id": "frontend", "client_id": "hubuum-frontend", "uri": FRONTEND + "/_hubuum-bff/auth/interactions/return"})
                values.update(HUBUUM_AUTH_BROWSER=json.dumps(settings), HUBUUM_SESSION_ACCESS_SECONDS="900")
                if not args.fixture_only:
                    values["HUBUUM_TREETOP_CA_CERT"] = "/fixture/ca.pem"
            return super().env(name, values)

        def policy_status(self):
            with urllib.request.urlopen(self.policy_url + "/api/v1/status", timeout=3) as response:
                return json.load(response)

        def wait_policy(self, expected_policy_hash=None):
            deadline = time.monotonic() + 90
            while time.monotonic() < deadline:
                try:
                    status = self.policy_status()
                    (self.evidence / "treetop-status-observed.json").write_text(json.dumps(status, indent=2) + "\n")
                    policies = status["policy_configuration"]["policies"]
                    if policies["entries"] > 0 and status["policy_configuration"]["schema"]["entries"] > 0 and status["request_context"]["schema_backed"] and (expected_policy_hash is None or policies["sha256"] == expected_policy_hash):
                        return status
                except (OSError, ValueError, KeyError):
                    pass
                time.sleep(0.25)
            raise RuntimeError("Real Treetop schema/policy readiness deadline expired")

        def set_policy(self, allow):
            # Match the pinned service's lexical policy-count metadata too.
            policy = f'permit (principal in Group::"{self.admin_group if allow else 999999}", action, resource);\n'
            self.policy_file.write_text(policy)
            # A policy fetch consumes a fresh schema handoff. Advance both
            # Last-Modified validators; schema content remains byte-identical.
            changed = max(time.time(), self.policy_file.stat().st_mtime + 2, self.schema_file.stat().st_mtime + 2)
            for path in (self.policy_file, self.schema_file):
                os.utime(path, (changed, changed))
            return self.wait_policy(hashlib.sha256(policy.encode()).hexdigest())

        def start(self):
            self.stage = "base-fixture"
            super().start()
            self.stage = "policy-fixture-files"
            self.admin_group = int(self.sql("SELECT g.id FROM groups g JOIN identity_scopes s ON s.id=g.identity_scope_id WHERE g.groupname='admin' AND s.name='local'"))
            directory = self.root / "treetop-public"
            directory.mkdir()
            self.schema_file = directory / "schema.json"
            shutil.copyfile(source / "docs/treetop/schema.json", self.schema_file)
            self.policy_file = directory / "test-fixture.cedar"
            self.policy_file.write_text('permit (principal in Group::"999999", action, resource);\n')
            handler = functools.partial(support.FixtureHandler, directory=str(directory), schema_permits=threading.Semaphore(0),
                                        schema_ready=lambda: bool(self.policy_url) and support.schema_is_loaded(self.policy_url))
            self.policy_http = ThreadingHTTPServer(("0.0.0.0", 0), handler)
            self.policy_http.daemon_threads = True
            threading.Thread(target=self.policy_http.serve_forever, daemon=True).start()
            fixture_port = self.policy_http.server_address[1]
            network = json.loads(subprocess.check_output(["docker", "network", "inspect", self.network], text=True))[0]
            gateway = network["IPAM"]["Config"][0]["Gateway"]
            self.stage = "policy-container"
            self.policy_container = self.run("treetop", "--network", self.network, "--add-host", "host.docker.internal:host-gateway", "--publish", "127.0.0.1::3030",
                "--env", "TREETOP_LISTEN=0.0.0.0", "--env", "TREETOP_PORT=3030", "--env", "TREETOP_WORKERS=2", "--env", "TREETOP_RAYON_THREADS=2",
                "--env", "TREETOP_CLIENT_ALLOWLIST=127.0.0.1,::1," + gateway, "--env", "TREETOP_TRUST_IP_HEADERS=false", "--env", "TREETOP_ALLOW_UPLOAD=false",
                "--env", f"TREETOP_SCHEMA_URL=http://host.docker.internal:{fixture_port}/schema.json", "--env", f"TREETOP_POLICY_URL=http://host.docker.internal:{fixture_port}/test-fixture.cedar",
                "--env", "TREETOP_SCHEMA_UPDATE_FREQUENCY=1", "--env", "TREETOP_POLICY_UPDATE_FREQUENCY=1", "--env", "TREETOP_SCHEMA_VALIDATION_MODE=strict", "--env", "RUST_LOG=warn", treetop_image)
            port = oauth.command("docker", "port", self.policy_container, "3030/tcp").rsplit(":", 1)[1]
            self.policy_url = "http://127.0.0.1:" + port
            self.stage = "policy-readiness"
            status = self.wait_policy()
            (self.evidence / "treetop-status.json").write_text(json.dumps(status, indent=2) + "\n")

            class PolicyProxy(Proxy):
                upstream_host = "127.0.0.1:" + port

                def upstream_headers(self):
                    return {"Host": self.upstream_host}

                def connection_to_upstream(self):
                    return HTTPConnection(self.upstream_host, timeout=40)

            self.policy_proxy = ThreadingHTTPServer(("0.0.0.0", 0), PolicyProxy)
            self.policy_proxy.daemon_threads = True
            tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            tls.load_cert_chain(self.root / "mount/server.pem", self.root / "mount/server.key")
            self.policy_proxy.socket = tls.wrap_socket(self.policy_proxy.socket, server_side=True)
            threading.Thread(target=self.policy_proxy.serve_forever, daemon=True).start()
            self.treetop_url = "https://host.docker.internal:" + str(self.policy_proxy.server_address[1])
            self.stage = "verified-policy-tls"
            status, _, _ = self.browser.request("https://localhost:" + str(self.policy_proxy.server_address[1]) + "/readyz")
            if status != 200:
                raise RuntimeError("Policy TLS readiness probe failed")

        def cleanup(self):
            if getattr(self, "policy_container", None):
                with (self.evidence / "treetop.log").open("w") as output:
                    subprocess.run(["docker", "logs", self.policy_container], stdout=output, stderr=subprocess.STDOUT)
            for server in (self.policy_proxy, self.policy_http):
                if server:
                    server.shutdown()
                    server.server_close()
            super().cleanup()

    args.evidence.mkdir(parents=True, exist_ok=True)
    fixture = Fixture()
    consumer = None
    report = {"scope": "real Treetop fixture preparation only" if args.fixture_only else "actual runtime authorization administration UI",
              "server_source": SOURCE, "treetop_image": treetop_image, "treetop_source": pins["HUBUUM_TREETOP_TEST_REVISION"], "checks": [], "passed": False,
              "controller_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              "frontend_source_commit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
              "frontend_source_dirty": bool(subprocess.check_output(["git", "status", "--porcelain"], cwd=ROOT, text=True))}
    try:
        fixture.start()
        report["checks"].append("immutable real Treetop loads the pinned schema before strict deny policies; uploads remain disabled")
        if args.fixture_only:
            fixture.set_policy(True)
            report["checks"].append("real policy service reloads a fixture administrator policy")
        else:
            consumer = Consumer(fixture, oauth, args.node.resolve(), "local")
            consumer.start()
            run_ui(consumer, fixture, args.node.resolve(), report)
        report["passed"] = True
    except Exception as error:
        frame = traceback.extract_tb(error.__traceback__)[-1]
        report["failure"] = {"type": type(error).__name__, "location": Path(frame.filename).name + ":" + str(frame.lineno), "stage": getattr(fixture, "stage", "initialization")}
        if Path(frame.filename).resolve() == Path(__file__).resolve() and isinstance(error, RuntimeError):
            report["failure"]["reason"] = str(error)
        raise
    finally:
        if consumer:
            consumer.cleanup()
        fixture.cleanup()
        (args.evidence / "authorization-qualification.json").write_text(json.dumps(report, indent=2) + "\n")


def run_ui(consumer, fixture, node, report):
    public_key = subprocess.check_output(["openssl", "x509", "-in", str(fixture.root / "mount/server.pem"), "-pubkey", "-noout"])
    der = subprocess.check_output(["openssl", "pkey", "-pubin", "-outform", "DER"], input=public_key)
    payload = {"localPassword": fixture.local_password, "treetopUrl": fixture.treetop_url, "spki": base64.b64encode(hashlib.sha256(der).digest()).decode()}
    child = subprocess.Popen([str(node), "tests/integration/browser-authorization.mjs"], cwd=ROOT, env=consumer.env,
                             stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    deadline = time.monotonic() + 300
    complete = False
    before = None
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
            kind = event["event"]
            if kind == "allow-policy":
                fixture.set_policy(True)
            elif kind == "candidate-before":
                before = consumer.counts()
            elif kind == "candidate-after":
                if before is None or before != consumer.counts():
                    raise RuntimeError("Authorization candidate preflight changed persistent identity/session state")
                report["checks"].append("authorization candidate preparation leaves all six persistent identity, membership, session and credential counts unchanged")
            elif kind == "restart":
                consumer.module.command("docker", "restart", fixture.server)
                fixture.wait(fixture.origin + "/healthz")
                consumer.stop_process()
                consumer.start_process()
            elif kind == "outage":
                consumer.module.command("docker", "stop", fixture.policy_container)
            elif kind == "recover":
                consumer.module.command("docker", "start", fixture.policy_container)
                port = consumer.module.command("docker", "port", fixture.policy_container, "3030/tcp").rsplit(":", 1)[1]
                fixture.policy_url = "http://127.0.0.1:" + port
                fixture.policy_proxy.RequestHandlerClass.upstream_host = "127.0.0.1:" + port
                fixture.wait_policy()
            elif kind == "recovery-login":
                fixture.verify_local_recovery()
            elif kind == "failure":
                (fixture.evidence / "authorization-ui-failure.json").write_text(json.dumps(event, indent=2) + "\n")
                raise RuntimeError("Authorization UI stopped at " + event["stage"])
            elif kind == "complete":
                if event.get("passed") is not True:
                    raise RuntimeError("Authorization UI returned no acceptance")
                report["checks"].extend(event["checks"])
                complete = True
                break
            else:
                raise RuntimeError("Unknown authorization UI checkpoint")
            child.stdin.write("ok\n")
            child.stdin.flush()
        if not complete or child.wait(timeout=10) != 0:
            raise RuntimeError("Authorization UI deadline expired")
    finally:
        if child.poll() is None:
            child.kill()
            child.wait()
        child.stdin.close()
        child.stdout.close()
        child.stderr.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print("Authorization qualification failed (" + type(error).__name__ + "); sanitized report retained.", file=sys.stderr)
        raise SystemExit(1) from None
