"""Run SPI·SPC locally on Windows or Linux/CI. See SKILL.md for dependencies and scope."""
import argparse
import json
import os
import platform
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
from ui_matrix import run_ui_matrix

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


def evidence_base():
    if "LOCALAPPDATA" in os.environ:
        return Path(os.environ["LOCALAPPDATA"]) / "spi-spc-verify/evidence"
    state_home = os.environ.get("XDG_STATE_HOME")
    base = Path(state_home) if state_home else (Path.home() / ".local/state")
    return base / "spi-spc-verify/evidence"


def build_launch_kwargs(headed: bool):
    kwargs = {"headless": not headed}
    if os.name == "nt" or shutil.which("google-chrome") or shutil.which("chrome"):
        kwargs["channel"] = "chrome"
    if not headed and os.name != "nt":
        # Enable software WebGL rendering on headless Linux VMs/CI without GPU
        kwargs["args"] = [
            "--use-gl=angle",
            "--use-angle=swiftshader",
            "--enable-unsafe-swiftshader",
        ]
    return kwargs


def write_summary(evidence: Path, summary: dict):
    (evidence / "summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    lines = [
        "# SPI·SPC Local Verification Summary",
        "",
        f"- **Target**: `{summary['target']}`",
        f"- **Outcome**: **{summary['outcome']}**",
        f"- **Version**: `v{summary.get('version', '?')}` (built `{summary.get('built', '?')}`, head `{summary.get('head', '?')[:10]}`)",
        f"- **Environment**: {summary['environment']['os']} / Python {summary['environment']['python']} / headless={summary['headless']}",
        f"- **Duration**: {summary['duration_sec']:.1f}s",
        f"- **Browser Errors**: {len(summary['browser_errors'])}",
        "",
    ]
    if summary["features"]:
        lines.extend([
            "## Functional Journeys",
            "",
            "| Feature | Status | Duration (s) | Error |",
            "|---|---|---:|---|",
        ])
        for item in summary["features"]:
            err = (item.get("error") or "").replace("\n", " ")[:120]
            lines.append(f"| `{item['name']}` | **{item['status']}** | {item['duration_sec']:.1f} | {err} |")
        lines.append("")

    matrix = summary.get("ui_matrix")
    if matrix:
        lines.extend([
            f"## UI Matrix (dpr={matrix['dpr']}, total violations={matrix['total_violations']})",
            "",
            "| Viewport | Theme | Status | Violations |",
            "|---|---|---|---:|",
        ])
        for cell in matrix["cells"]:
            lines.append(
                f"| `{cell['viewport']}` ({cell['width']}×{cell['height']}) | `{cell['theme']}` | **{cell['status']}** | {cell['violations']} |"
            )
        lines.append("")
        if matrix["violations"]:
            lines.append("### UI Matrix Violations")
            lines.append("")
            for v in matrix["violations"][:20]:
                lines.append(f"- `{v['viewport']}` `{v['theme']}` `{v['target']}` **{v['check']}**: `{json.dumps({k: val for k, val in v.items() if k not in ('viewport', 'theme', 'target', 'check')}, ensure_ascii=False)[:240]}`")
            lines.append("")

    if summary["browser_errors"]:
        lines.append("## Browser Console / Page Errors")
        lines.append("")
        for err in summary["browser_errors"][:20]:
            lines.append(f"- [{err['scope']}] `{err['kind']}`: {err['message'][:240]}")
        lines.append("")

    (evidence / "summary.md").write_text("\n".join(lines), encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "feature",
        choices=["all", "full", "doctor", "ui-matrix", *FEATURES],
        default="database",
        nargs="?",
    )
    parser.add_argument("--headed", action="store_true", help="Launch browser with visible window instead of headless")
    parser.add_argument("--all-screenshots", action="store_true", help="Save screenshots for every tab in ui-matrix")
    parser.add_argument("--allow-console-errors", action="store_true", help="Log browser console/page errors as warnings instead of failing")
    args = parser.parse_args()

    started_at = time.monotonic()
    evidence = evidence_base() / uuid4().hex
    evidence.mkdir(parents=True)
    print(f"Evidence: {evidence}", flush=True)
    log = open(evidence / "events.jsonl", "x", encoding="utf-8")
    private_values = []
    browser_errors = []
    feature_results = []
    matrix_result = None
    run_meta = {}

    def safe_message(value):
        for sensitive in private_values:
            value = value.replace(sensitive, "[redacted]")
        return re.sub(r"(?i)(spi_auth=|set-cookie:|cookie:|authorization:)[^\r\n]*", "[redacted header]", value)

    def note(action, **data):
        fields = {k: safe_message(v) if isinstance(v, str) else v for k, v in data.items()}
        log.write(json.dumps(dict(time=time.time(), action=action, **fields), ensure_ascii=False) + "\n")
        log.flush()

    def attach_error_listeners(page, scope):
        expected_ai_403 = [0]

        def on_response(resp):
            if resp.status == 403 and ("/api/analyze" in resp.url or "/api/ai" in resp.url):
                expected_ai_403[0] += 1
                note("expected ai-disabled 403", scope=scope, url=resp.url)

        def on_pageerror(err):
            msg = safe_message(str(err))[:600]
            browser_errors.append({"scope": scope, "kind": "pageerror", "message": msg})
            note("browser pageerror", scope=scope, message=msg)

        def on_console(msg):
            if msg.type == "error":
                text = safe_message(msg.text)[:600]
                if "403 (Forbidden)" in text and expected_ai_403[0] > 0:
                    expected_ai_403[0] -= 1
                    return
                browser_errors.append({"scope": scope, "kind": "console.error", "message": text})
                note("browser console error", scope=scope, message=text)

        page.on("response", on_response)
        page.on("pageerror", on_pageerror)
        page.on("console", on_console)

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
        run_meta = {"head": source_head, "version": meta["version"], "built": credentials["built"]}
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
            launch_base = build_launch_kwargs(args.headed)
            with sync_playwright() as pw:
                run_functional = args.feature != "ui-matrix"
                run_matrix = args.feature in ("ui-matrix", "full")

                if run_functional:
                    launch_kwargs = dict(launch_base)
                    launch_kwargs["viewport"] = {"width": 1440, "height": 900}
                    context = pw.chromium.launch_persistent_context(str(scratch / "profile"), **launch_kwargs)
                    try:
                        page = context.pages[0]
                        page.set_default_timeout(15000)
                        attach_error_listeners(page, "functional")
                        login(page, origin, credentials, meta["version"], note)

                        def check():
                            verify_owner(worker, port)
                            doctor(page, origin, credentials, meta["version"], note)

                        check()
                        if args.feature in ("all", "full"):
                            features = list(FEATURES)
                        elif args.feature == "doctor":
                            features = []
                        else:
                            features = [args.feature]

                        for feature in features:
                            t0 = time.monotonic()
                            try:
                                run_feature(feature, page, evidence, note, scratch=scratch)
                                feature_results.append({
                                    "name": feature,
                                    "status": "PASS",
                                    "duration_sec": round(time.monotonic() - t0, 2),
                                })
                            except Exception as error:
                                feature_results.append({
                                    "name": feature,
                                    "status": "FAIL",
                                    "duration_sec": round(time.monotonic() - t0, 2),
                                    "error": safe_message(str(error))[:600],
                                })
                                note("failed feature", feature=feature, error=str(error)[:1800])
                                page.screenshot(path=evidence / f"{feature}-failed.png")
                                check()
                                raise
                    finally:
                        context.close()

                if run_matrix:
                    verify_owner(worker, port)
                    matrix_result = run_ui_matrix(
                        pw,
                        launch_base,
                        scratch,
                        origin,
                        credentials,
                        meta["version"],
                        evidence,
                        note,
                        all_screenshots=args.all_screenshots,
                        attach_error_listeners=attach_error_listeners,
                    )
                    if matrix_result["total_violations"] > 0:
                        exit_code = 1
                        note("ui-matrix failed", total_violations=matrix_result["total_violations"])

        if browser_errors and not args.allow_console_errors:
            exit_code = 1
            note("browser errors failed run", count=len(browser_errors))
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

    summary = {
        "target": args.feature,
        "outcome": "PASS" if exit_code == 0 else "FAIL",
        "version": run_meta.get("version"),
        "built": run_meta.get("built"),
        "head": run_meta.get("head"),
        "headless": not args.headed,
        "duration_sec": round(time.monotonic() - started_at, 2),
        "environment": {
            "os": f"{platform.system()} {platform.release()}",
            "python": platform.python_version(),
        },
        "features": feature_results,
        "ui_matrix": matrix_result,
        "browser_errors": browser_errors,
    }
    write_summary(evidence, summary)

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
    print(f"Summary: {evidence / 'summary.md'} ({summary['outcome']}, {summary['duration_sec']}s)", flush=True)
    print(f"Evidence retained: {len(files)} file(s)", flush=True)
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
