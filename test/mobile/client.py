"""The client on a phone, driven through its own pages."""
import json, os, subprocess, time

UDID, SERIAL = os.environ.get("BUCKYOS_SIM", ""), os.environ.get("BUCKYOS_ADB", "")
if bool(UDID) == bool(SERIAL): raise SystemExit("BUCKYOS_SIM: the UDID of an iOS simulator, or BUCKYOS_ADB: the serial of an Android device")
IOS = bool(UDID)
if IOS: from ios import APP, Inspector
else: from android import APP, Inspector
LOCAL = "tauri://localhost" if IOS else "http://tauri.localhost"
failed = []


def adb(*args):
    return subprocess.check_output(["adb", "-s", SERIAL, *args], text=True, stderr=subprocess.DEVNULL)


class Client:
    def __init__(self):
        self.inspector, self.opened = None, {}

    # ---- pages ----

    def connect(self):
        if self.inspector is None: self.inspector, self.opened = Inspector(UDID or SERIAL), {}
        return self.inspector

    def page(self, match, wait=6):
        for attempt in range(3):
            try:
                end = time.time() + wait
                while True:
                    for key, url, _ in self.connect().pages():
                        if match in url:
                            if key not in self.opened: self.opened[key] = self.inspector.page(lambda found, url=url: found == url)
                            return self.opened[key]
                    if time.time() > end: raise LookupError(f"no page {match}: {self.urls()}")
                    time.sleep(0.2)
            except (ConnectionError, OSError, TimeoutError):
                self.inspector = None
        raise ConnectionError("no inspector")

    def js(self, match, expression, timeout=20, gesture=False):
        for attempt in range(2):
            try: return self.page(match).eval(expression, timeout, gesture)
            except (ConnectionError, OSError) as error:
                self.inspector = None
                # The inspector of iOS loses a page that changed its process.
                if attempt or isinstance(error, TimeoutError) and not IOS: raise

    def main(self, expression, timeout=20, gesture=False):
        return self.js(LOCAL, expression, timeout, gesture)

    def urls(self):
        for attempt in range(3):
            try: return [url for _, url, _ in self.connect().pages()]
            except (ConnectionError, OSError): self.inspector = None
        raise ConnectionError("no inspector")

    def cookies(self, match):
        page = self.page(match)
        if IOS: return {c["name"]: c for c in page.call("Page.getCookies")["cookies"]}
        return {c["name"]: c for c in page.call("Network.getCookies")["cookies"]}

    def delete_cookie(self, match, name, host):
        if IOS: self.page(match).call("Page.deleteCookie", cookieName=name, url=f"https://{host}/")
        else: self.page(match).call("Network.deleteCookies", name=name, url=f"https://{host}/")

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

    def tap(self, name):
        """The icon of an app on Home."""
        self.main("(location.hash = '#/main/home', true)")
        time.sleep(0.5)
        self.main("(() => { const tile = [...document.querySelectorAll('.app-tile')].find((tile) => tile.textContent.includes(%s)); "
                  "if (!tile) throw new Error('no such tile'); tile.click(); return true })()" % json.dumps(name))

    def open(self, name, app):
        self.tap(name)
        view = self.wait(lambda: next((v for v in self.views().values() if v["app"].startswith(app) and v["status"] == "ready" and v["focused"]), None), 30, name)
        time.sleep(1)
        return view

    def restart(self):
        if IOS:
            subprocess.run(["xcrun", "simctl", "terminate", UDID, APP], capture_output=True)
            subprocess.run(["xcrun", "simctl", "launch", UDID, APP], capture_output=True, check=True)
        else:
            adb("shell", "am", "force-stop", APP)
            adb("shell", "am", "start", "-n", f"{APP}/.MainActivity")
        self.inspector = None
        time.sleep(4)
        self.ready()

    def ready(self):
        self.wait(lambda: self.main("document.readyState") == "complete" and self.main("typeof window.__TAURI_INTERNALS__") == "object", 40, "the client")

    # ---- the device ----

    def downloads(self):
        if IOS:
            data = subprocess.check_output(["xcrun", "simctl", "get_app_container", UDID, APP, "data"], text=True).strip()
            return set(os.listdir(data + "/Documents"))
        return set(line for line in adb("shell", "ls", "-1", "/sdcard/Download").splitlines() if line)

    def remove_download(self, name):
        if IOS:
            data = subprocess.check_output(["xcrun", "simctl", "get_app_container", UDID, APP, "data"], text=True).strip()
            os.remove(f"{data}/Documents/{name}")
        else: adb("shell", "rm", "-f", "'/sdcard/Download/" + name + "'")

    def foreground(self):
        """In front again, should an address have opened in the browser."""
        if IOS: return
        adb("shell", "am", "start", "-n", f"{APP}/.MainActivity")
        time.sleep(1.5)

    def dismiss(self):
        """Dialogs a page left standing."""
        self.restart()

    def kill_busiest_page(self):
        """Ends the process of the page that is busy."""
        if IOS:
            lines = subprocess.check_output(["ps", "-axo", "pid=,ppid=,%cpu=,command="], text=True).splitlines()
            simulator = next(line.split()[0] for line in lines if "launchd_sim" in line and UDID in line)
            pages = [line.split() for line in lines if line.split()[1] == simulator and "com.apple.WebKit.WebContent" in line]
            os.kill(int(max(pages, key=lambda f: float(f[2]))[0]), 9)
            return
        lines = adb("shell", "top", "-b", "-n", "1", "-o", "PID,%CPU,ARGS").splitlines()
        pages = [line.split(None, 2) for line in lines if "sandboxed_process" in line or "webview" in line.lower() and "isolated" in line]
        adb("shell", "kill", "-9", max(pages, key=lambda f: float(f[1]))[0])


def check(name, ok, info=""):
    if not ok: failed.append(name)
    print(("PASS " if ok else "FAIL ") + name + (f"   {info}" if info != "" and not ok else ""), flush=True)
