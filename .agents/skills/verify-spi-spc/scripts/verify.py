"""Run SPI·SPC locally on Windows. See SKILL.md for dependencies and scope."""
import argparse
import json
import os
import re
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import time
from uuid import uuid4

import psutil
from playwright.sync_api import sync_playwright

from journeys import FEATURES, doctor, login, run_feature

ROOT = Path(__file__).resolve().parents[4]
NODE = shutil.which("node")
WRANGLER = ROOT / "node_modules/wrangler/bin/wrangler.js"


def unused_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def listener(port):
    # Windows may expose a listening socket as NONE. Confirm by connecting,
    # then identify the bound endpoint, excluding accepted client sockets.
    with socket.socket() as probe:
        probe.settimeout(0.25)
        if probe.connect_ex(("127.0.0.1", port)) != 0:
            return None
    for conn in psutil.net_connections(kind="tcp"):
        if conn.laddr.port == port and not conn.raddr and conn.laddr.ip == "127.0.0.1":
            return conn.pid
    raise RuntimeError(f"Cannot identify loopback listener on {port}")


def await_worker(process, port):
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"Wrangler exited before login (exit {process.returncode})")
        if listener(port):
            verify_owner(process, port)
            return
        time.sleep(0.25)
    raise TimeoutError("Worker did not bind its assigned port")


def verify_owner(process, port):
    if process.poll() is not None:
        raise RuntimeError("Worker process has exited")
    owned = {p.pid for p in psutil.Process(process.pid).children(recursive=True)}
    if listener(port) not in owned | {process.pid}:
        raise RuntimeError("Listener is outside the Wrangler process tree")


def stop_worker(process):
    if process is None or process.poll() is not None:
        return
    root = psutil.Process(process.pid)
    children = root.children(recursive=True)
    for proc in [root, *children]:
        try:
            proc.kill()
        except psutil.NoSuchProcess:
            pass
    _, alive = psutil.wait_procs([root, *children], timeout=10)
    if alive:
        raise RuntimeError("Wrangler process tree did not exit")


def child_environment(scratch):
    # Do not inherit Cloudflare credentials, worker secrets, proxy or browser settings.
    keys = ("PATH", "PATHEXT", "SystemRoot", "WINDIR", "COMSPEC", "ProgramFiles",
            "ProgramFiles(x86)", "PROCESSOR_ARCHITECTURE", "NUMBER_OF_PROCESSORS")
    env = {key: os.environ[key] for key in keys if key in os.environ}
    for key in ("HOME", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "TEMP", "TMP"):
        folder = scratch / "env" / key
        folder.mkdir(parents=True)
        env[key] = str(folder)
    env.update(CI="true", WRANGLER_SEND_METRICS="false", WRANGLER_LOG_PATH=str(scratch / "wrangler.log"))
    return env


def stage_project(scratch):
    for folder in ("cloudflare", "lib"):
        shutil.copytree(ROOT / folder, scratch / folder)
    shutil.copy(ROOT / "package.json", scratch)
    source = json.loads((ROOT / "wrangler.jsonc").read_text(encoding="utf-8"))
    config = {key: source[key] for key in ("main", "compatibility_date", "assets", "ratelimits")}
    if "compatibility_flags" in source:
        config["compatibility_flags"] = source["compatibility_flags"]
    config["name"] = "spi-spc-verify"
    config["vars"] = {"AUTH_KDF_ITER": source["vars"]["AUTH_KDF_ITER"], "AI_ENABLED": "false"}
    config["d1_databases"] = [dict(binding="DB", database_name="spi-spc",
                                   database_id=str(uuid4()), migrations_dir="cloudflare/migrations")]
    config["r2_buckets"] = [dict(binding="BLOBS", bucket_name="spi-spc-verify")]
    (scratch / "wrangler.json").write_text(json.dumps(config), encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("feature", choices=["all", "doctor", *FEATURES], default="database", nargs="?")
    args = parser.parse_args()
    evidence = Path(os.environ["LOCALAPPDATA"]) / "spi-spc-verify/evidence" / uuid4().hex
    evidence.mkdir(parents=True)
    print(f"Evidence: {evidence}", flush=True)
    log = open(evidence / "events.jsonl", "x", encoding="utf-8")
    private_values = []

    def safe_message(value):
        for sensitive in private_values:
            value = value.replace(sensitive, "[redacted]")
        return re.sub(r"(?i)(spi_auth=|set-cookie:|cookie:|authorization:)[^\r\n]*", "[redacted header]", value)

    def note(action, **data):
        fields = {k: safe_message(v) if isinstance(v, str) else v for k, v in data.items()}
        log.write(json.dumps(dict(time=time.time(), action=action, **fields), ensure_ascii=False) + "\n")
        log.flush()

    container = ROOT / ".wrangler"
    container.mkdir(exist_ok=True)
    scratch = Path(tempfile.mkdtemp(prefix="verify-", dir=container)).resolve()
    worker = None
    ports = []
    exit_code = 0
    try:
        port = unused_port()
        inspector = unused_port()
        while inspector == port:
            inspector = unused_port()
        ports = [port, inspector]
        origin = f"http://127.0.0.1:{port}"
        env = child_environment(scratch)
        stage_project(scratch)
        meta = json.loads((scratch / "package.json").read_text(encoding="utf-8"))
        result = subprocess.run([NODE, Path(__file__).with_name("prepare.mjs")], cwd=scratch, env=env,
                                stdin=subprocess.DEVNULL, capture_output=True, timeout=90)
        if result.returncode:
            raise RuntimeError("Local build/credential setup failed: " + result.stderr.decode(errors="replace")[-1600:])
        credentials = json.loads(result.stdout)
        private_values.append(credentials["password"])
        for line in (scratch / ".dev.vars").read_text(encoding="utf-8").splitlines():
            private_values.append(line.split("=", 1)[1].strip("'"))
        state = ["--config", "wrangler.json", "--local", "--persist-to", str(scratch / "state")]
        cli = [NODE, str(WRANGLER)]
        source_head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
        note("build", head=source_head, version=meta["version"], built=credentials["built"], origin=origin)
        with open(scratch / "process.log", "wb") as stream:
            result = subprocess.run([*cli, "d1", "migrations", "apply", "spi-spc", *state], cwd=scratch,
                                    env=env, stdin=subprocess.DEVNULL, stdout=stream, stderr=subprocess.STDOUT, timeout=120)
            if result.returncode:
                raise RuntimeError("Local D1 migration failed")
            note("local migrations", files=sorted(p.name for p in (scratch / "cloudflare/migrations").glob("*.sql")))
            worker = subprocess.Popen([*cli, "dev", *state, "--ip", "127.0.0.1", "--port", str(port),
                                       "--inspector-ip", "127.0.0.1", "--inspector-port", str(inspector)],
                                      cwd=scratch, env=env, stdin=subprocess.DEVNULL, stdout=stream, stderr=subprocess.STDOUT)
            await_worker(worker, port)
            with sync_playwright() as pw:
                context = pw.chromium.launch_persistent_context(str(scratch / "profile"), channel="chrome",
                                                                viewport={"width": 1440, "height": 900})
                try:
                    page = context.pages[0]
                    page.set_default_timeout(15000)
                    login(page, origin, credentials, meta["version"], note)

                    def check():
                        verify_owner(worker, port)
                        doctor(page, origin, credentials, meta["version"], note)

                    check()
                    features = FEATURES if args.feature == "all" else ([] if args.feature == "doctor" else [args.feature])
                    for feature in features:
                        try:
                            run_feature(feature, page, evidence, note)
                        except Exception as error:
                            note("failed feature", feature=feature, error=str(error)[:1800])
                            page.screenshot(path=evidence / f"{feature}-failed.png")
                            check()
                            raise
                finally:
                    context.close()
    except Exception as error:
        note("failure", error=str(error)[:2000])
        print(safe_message(str(error))[:2000], flush=True)
        # Keep only error excerpts from local Wrangler, never binding values or login data.
        path = scratch / "process.log"
        if path.exists():
            for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
                if any(word in line.lower() for word in ("error", "failed", "exception", "could not resolve")) and "AUTH_" not in line.upper():
                    note("wrangler diagnostic", message=line[:400])
        exit_code = 1
    finally:
        try:
            stop_worker(worker)
            if scratch.parent != container.resolve() or not scratch.name.startswith("verify-"):
                raise RuntimeError("Unsafe scratch path")
            shutil.rmtree(scratch)
            occupied = [port for port in ports if listener(port)]
            note("cleanup", scratch_removed=not scratch.exists(),
                 ports_released=[port for port in ports if port not in occupied], occupied=occupied)
            if occupied:
                raise RuntimeError(f"Ports still occupied after cleanup: {occupied}")
        except Exception as error:
            note("cleanup failure", error=str(error), scratch=str(scratch))
            exit_code = 1
        finally:
            log.close()
    files = [p for p in evidence.iterdir() if p.is_file() and p.stat().st_size]
    if not files or (exit_code == 0 and args.feature != "doctor" and not any(p.suffix == ".png" for p in files)):
        raise RuntimeError("Missing evidence after cleanup")
    for path in files:
        if path.suffix == ".png":
            with path.open("rb") as stream:
                if stream.read(8) != b"\x89PNG\r\n\x1a\n":
                    raise RuntimeError(f"Unreadable screenshot after cleanup: {path.name}")
    events = [json.loads(line) for line in (evidence / "events.jsonl").read_text(encoding="utf-8").splitlines()]
    if events[-1]["action"] != "cleanup" or not events[-1]["scratch_removed"]:
        raise RuntimeError(f"Cleanup incomplete. Inspect {evidence / 'events.jsonl'}")
    print(f"Evidence retained: {len(files)} file(s)", flush=True)
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
