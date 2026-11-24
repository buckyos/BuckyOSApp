"""The client in the simulator, driven through its own pages."""
import json, os, subprocess, time
from inspector import APP, Inspector

UDID = os.environ.get("BUCKYOS_SIM", "")
failed = []


class Client:
    def __init__(self):
        if not UDID: raise SystemExit("BUCKYOS_SIM: the UDID of the simulator")
        self.inspector, self.opened = None, {}

    # ---- pages ----

    def page(self, match, wait=6):
        for attempt in range(3):
            try:
                if self.inspector is None: self.inspector, self.opened = Inspector(UDID), {}
                end = time.time() + wait
                while True:
                    for number, url, _ in self.inspector.pages():
                        if match in url:
                            if number not in self.opened: self.opened[number] = self.inspector.page(lambda found, url=url: found == url)
                            return self.opened[number]
                    if time.time() > end: raise LookupError(f"no page {match}: {self.urls()}")
                    time.sleep(0.2)
            except (ConnectionError, OSError, TimeoutError):
                self.inspector = None
        raise ConnectionError("no inspector")

    def js(self, match, expression, timeout=20, gesture=False):
        for attempt in range(2):
            try: return self.page(match).eval(expression, timeout, gesture)
            except (ConnectionError, OSError, TimeoutError):
                self.inspector = None
                if attempt: raise

    def call(self, match, method, **params):
        return self.page(match).call(method, **params)

    def main(self, expression, timeout=20, gesture=False):
        return self.js("tauri://localhost", expression, timeout, gesture)

    def urls(self):
        if self.inspector is None: self.inspector, self.opened = Inspector(UDID), {}
        return [url for _, url, _ in self.inspector.pages()]

    # ---- the client ----

    def invoke(self, command, **args):
        return self.main(f"window.__TAURI_INTERNALS__.invoke({json.dumps(command)}, {json.dumps(args)})")

    def views(self):
        return {view["id"]: view for view in self.invoke("content_list")}

    def wait(self, check, seconds=20, what=""):
        end, last = time.time() + seconds, None
        while time.time() < end:
            try:
                last = check()
                if last: return last
            except (RuntimeError, LookupError) as error: last = error
            time.sleep(0.3)
        raise TimeoutError(f"{what}: {last}")

    def open(self, name, app):
        """Opens an app by its icon on Home."""
        self.main("(location.hash = '#/main/home', true)")
        time.sleep(0.5)
        self.main("(() => { const tile = [...document.querySelectorAll('.app-tile')].find((tile) => tile.textContent.includes(%s)); "
                  "if (!tile) throw new Error('no such tile'); tile.click(); return true })()" % json.dumps(name))
        view = self.wait(lambda: next((v for v in self.views().values() if v["app"].startswith(app) and v["status"] == "ready" and v["focused"]), None), 30, name)
        time.sleep(1)
        return view

    def cookies(self, match):
        return {c["name"]: c for c in self.call(match, "Page.getCookies")["cookies"]}

    def restart(self):
        subprocess.run(["xcrun", "simctl", "terminate", UDID, APP], capture_output=True)
        subprocess.run(["xcrun", "simctl", "launch", UDID, APP], capture_output=True, check=True)
        self.inspector = None
        time.sleep(4)
        self.wait(lambda: self.main("document.readyState") == "complete", 30, "start")

    def data(self):
        return subprocess.check_output(["xcrun", "simctl", "get_app_container", UDID, APP, "data"], text=True).strip()


def check(name, ok, info=""):
    if not ok: failed.append(name)
    print(("PASS " if ok else "FAIL ") + name + (f"   {info}" if info != "" and not ok else ""), flush=True)
