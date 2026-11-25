"""What a Zone's pages may do in the content container, and what becomes of them.

BUCKYOS_SIM=<udid> python3 test/mobile/container.py [section …]
BUCKYOS_ADB=<serial> python3 test/mobile/container.py [section …]
"""
import http.server, json, os, socket, sys, tempfile, threading, time
from client import IOS, LOCAL, Client, check, failed

c = Client()
ZONE = os.environ.get("BUCKYOS_TEST_ZONE_HOST", "test.buckyos.io")
FILES, EDITOR, WORKSPACE = "app/files", f"text-editor.{ZONE}", f"{ZONE}/workspace"


def files():
    return c.open("文件", "files")["id"]


def section_switching():
    for name, app in [("AI 工作区", "aiworkspace"), ("文本编辑器", "text-editor"), ("文件", "files")]: c.open(name, app)
    for page in (FILES, WORKSPACE, EDITOR): c.js(page, "(window.__mark = 1, true)")
    for name, app in [("AI 工作区", "aiworkspace"), ("文本编辑器", "text-editor"), ("文件", "files")]: c.open(name, app)
    check("switching does not load again", all(c.js(page, "window.__mark") == 1 for page in (FILES, WORKSPACE, EDITOR)))
    check("a hidden page is told so", c.js(FILES, "document.visibilityState") == "visible" and c.js(WORKSPACE, "document.visibilityState") == "hidden")
    c.open("MessageHub", "messagehub")
    check("tab and icon are one view", sum(v["app"] == "messagehub" for v in c.views().values()) == 1)
    for name, app in [("AI 中心", "ai-center"), ("用户与 Agent", "users-agents"), ("任务中心", "task-center"), ("工作流", "workflow")]: c.open(name, app)
    windows = [v for v in c.views().values() if v["presentation"] == "window"]
    check("five apps keep their page", sum(not v["discarded"] for v in windows) == 5)
    c.open("AI 工作区", "aiworkspace")
    check("one that lost it loads again", c.js(WORKSPACE, "window.__mark") is None)


def section_history():
    c.invoke("content_close", id=c.open("文本编辑器", "text-editor")["id"])
    view = c.open("文本编辑器", "text-editor")["id"]
    check("there is no way back behind the sign-in", c.invoke("content_back", id=view) is False)
    c.js(EDITOR, "(location.href = '/?one=1', true)", gesture=True); time.sleep(1.5)
    c.js(EDITOR, "(history.pushState({}, '', '/?two=2'), true)", gesture=True); time.sleep(0.6)
    check("a page's own addresses are followed", c.views()[view]["path"] == "/?two=2")
    for path in ("/?one=1", "/"):
        moved = c.invoke("content_back", id=view); time.sleep(1.2)
        check(f"back to {path}", moved and c.views()[view]["path"] == path, c.views()[view]["path"])
    check("and no further", c.invoke("content_back", id=view) is False)


def section_session():
    view, before = files(), c.cookies(FILES)
    check("the refresh token is kept from scripts", before["buckyos_refresh_token"]["httpOnly"] and before["buckyos_refresh_token"]["sameSite"] == "Lax")
    for name in before: c.delete_cookie(FILES, name, ZONE)
    c.js(FILES, "(location.href = '/app/files?path=%2Fhome', true)")
    c.wait(lambda: c.cookies(FILES).get("buckyos_refresh_token", {}).get("value") not in (None, before["buckyos_refresh_token"]["value"]), 20, "a new session")
    check("a lost session is made again", c.views()[view]["status"] in ("ready", "loading"))
    c.wait(lambda: c.views()[view]["status"] == "ready")
    check("without a way back to the round trip", c.invoke("content_back", id=view) is False)


def section_crash():
    view = files()
    hang = "(setTimeout(() => { const t = Date.now(); while (Date.now() - t < 15000) {} }, 100), true)"
    c.js(FILES, hang); time.sleep(1.5)
    start = time.time(); c.main("1")
    check("the local page answers while an app hangs", time.time() - start < 1)
    c.open("AI 工作区", "aiworkspace")
    c.tap("文件"); time.sleep(0.5)
    c.kill_busiest_page()
    c.wait(lambda: c.views()[view]["status"] == "ready" and not c.views()[view]["discarded"], 20, "back by itself")
    check("the one in front comes back by itself", True)
    c.open("文本编辑器", "text-editor"); files()
    time.sleep(1); c.js(FILES, hang); time.sleep(2); c.kill_busiest_page(); time.sleep(2)
    check("twice in a minute is an error to the user", c.views()[view]["status"] == "error")
    c.main("(document.querySelector('[data-testid=content-status] button').click(), true)")
    c.wait(lambda: c.views()[view]["status"] == "ready")


def section_windows():
    files()
    c.js(FILES, f"(() => {{ const a = document.createElement('a'); a.href = 'https://{EDITOR}/?via=blank'; a.target = '_blank'; document.body.append(a); a.click(); a.remove(); return true }})()", gesture=True)
    c.wait(lambda: any(v["focused"] and v["path"] == "/?via=blank" for v in c.views().values()), 15, "target=_blank")
    files()
    c.js(FILES, f"window.open('https://{EDITOR}/?via=open') === null", gesture=True)
    c.wait(lambda: any(v["focused"] and v["path"] == "/?via=open" for v in c.views().values()), 15, "window.open")
    check("new windows open as apps", True)
    time.sleep(1)
    check("and leave nothing behind", sum(EDITOR in url for url in c.urls()) == 1, c.urls())
    files(); count = len(c.views())
    for url in ("about:blank", "javascript:alert(1)", "data:text/html,x"): c.js(FILES, f"(window.open({json.dumps(url)}), true)", gesture=True)
    time.sleep(1)
    check("nothing opens for about:, javascript:, data:", len(c.views()) == count)
    c.open("AI 工作区", "aiworkspace")
    try: check("a hidden page gets no dialog", c.js(FILES, "[confirm('?'), prompt('?')]", 5) == [False, None])
    except TimeoutError:
        check("a hidden page gets no dialog", False, "there is one")
        c.dismiss()


def section_downloads():
    files(); before = c.downloads()
    for href in ("URL.createObjectURL(new Blob(['x']))", "'data:text/plain,x'", "'/favicon.ico'"):
        c.js(FILES, f"(() => {{ const a = document.createElement('a'); a.href = {href}; a.download = '../test file'; document.body.append(a); a.click(); a.remove(); return true }})()", gesture=True)
        time.sleep(2)
    made = c.downloads() - before
    check("files a page offers are saved, under a clean name", len(made) == 3 and all("/" not in name and not name.startswith(".") for name in made), made)
    for name in made: c.remove_download(name)


# What a document gets when it calls the client past the page's own script.
ASK = """const handler = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.buckyPort;
const ask = (text) => handler.postMessage(text);""" if IOS else """const port = window.__buckyPort;
const ask = (text) => Promise.race([new Promise((r) => { port.onmessage = (e) => r(e.data); port.postMessage(text) }), new Promise((r) => setTimeout(() => r('nothing'), 2000))]);"""
PROBE = """
const out = { api: typeof window.BuckyApi };
""" + ASK + """
for (const name of ['getPublicKey', 'audio.record.list']) {
  try { out[name] = await ask(JSON.stringify({ id: 1, name, payload: {} })) } catch (error) { out[name] = 'threw ' + error }
}
"""


def refused(out):
    no = lambda answer: "not_allowed" in answer or answer.startswith("threw")
    return out is not None and out["api"] == "undefined" and no(out["getPublicKey"]) and no(out["audio.record.list"])


def section_security():
    view = files()
    check("the page itself may call", '"ok":true' in c.js(FILES, f"(async () => {{{PROBE} return out}})()")["getPublicKey"])
    for name, make in [("about:blank", "f.src = 'about:blank'"), ("srcdoc", "f.srcdoc = '<p>x'"), ("same-origin", "f.src = '/favicon.ico'")]:
        out = c.js(FILES, f"""(async () => {{ const f = document.createElement('iframe'); {make}; await new Promise((r) => {{ f.onload = r; document.body.append(f) }});
          try {{ return await new f.contentWindow.Function(`return (async () => {{{PROBE} return out}})()`)() }} finally {{ f.remove() }} }})()""")
        check(f"a frame ({name}) is refused", refused(out), out)
    for name, make in [("data:", "f.src = 'data:text/html,' + encodeURIComponent(code)"), ("sandboxed", "f.sandbox = 'allow-scripts'; f.srcdoc = code")]:
        out = c.js(FILES, f"""(async () => {{ const code = '<script>' + `(async () => {{{PROBE} parent.postMessage(JSON.stringify(out), '*')}})()` + '<' + '/script>';
          const f = document.createElement('iframe'); {make};
          const got = new Promise((r) => addEventListener('message', (e) => {{ if (e.source === f.contentWindow) r(JSON.parse(e.data)) }}));
          document.body.append(f); const out = await Promise.race([got, new Promise((r) => setTimeout(() => r(null), 4000))]); f.remove(); return out }})()""")
        check(f"a frame ({name}) is refused", refused(out), out)

    def go(url, seconds=1.5):
        c.js(FILES, f"(setTimeout(() => {{ location.href = {json.dumps(url)} }}, 50), true)"); time.sleep(seconds)
        return c.urls()

    go("data:text/html,<h1>x")
    check("no top-level data: page", any(FILES in url for url in c.urls()))
    blank = next((url for url in go("about:blank") if url.startswith("about:")), None)
    check("a top-level about:blank is the app's own or has no bridge", blank is None or c.js(blank, "origin") == f"https://{ZONE}" or refused(c.js(blank, f"(async () => {{{PROBE} return out}})()")))
    c.invoke("content_retry", id=view); time.sleep(3)
    for url in (f"https://{ZONE}/sso_callback?nonce=1", f"https://{EDITOR}/sso_callback?nonce=1", f"http://{ZONE}/", "file:///etc/passwd", f"{LOCAL}/"):
        urls = go(url)
        check(f"not gone to: {url}", any(FILES in found for found in urls) and sum(LOCAL in found for found in urls) == 1, urls)
    c.foreground()
    seen = c.js(FILES, "JSON.stringify([performance.getEntries().map((e) => e.name), document.referrer, location.href])")
    check("nothing of the one-time address is to be seen", "nonce" not in seen and "sso_callback" not in seen)
    c.js(FILES, "(setTimeout(() => { location.href = '/login' }, 50), true)")
    end, shown = time.time() + 4, set()
    while time.time() < end: shown.update(c.urls()); time.sleep(0.1)
    check("the sign-in page is never shown", not any("/login" in url for url in shown), shown)
    c.wait(lambda: c.views()[view]["status"] == "ready")
    check("another app opens as itself", any(EDITOR in url for url in go(f"https://{EDITOR}/", 3)) and any(FILES in url for url in c.urls()))
    files()
    out = c.js(FILES, """(async () => { const out = [typeof window.ipc, typeof window.__TAURI_INTERNALS__];
      for (const url of ['ipc://localhost/zone_list', 'tauri://localhost/index.html', 'zonemedia://localhost/x', 'http://ipc.localhost/zone_list']) { try { out.push((await fetch(url, { method: 'POST' })).status) } catch { out.push('threw') } } return out })()""")
    check("no way to the client's commands", out == ["undefined", "undefined", "threw", "threw", "threw", "threw"], out)
    out = c.js(FILES, """(async () => { const out = []; for (const what of [{ video: true }, { video: true, audio: true }]) { try { await navigator.mediaDevices.getUserMedia(what); out.push('granted') } catch (e) { out.push(e.name) } }
      out.push(await new Promise((r) => navigator.geolocation.getCurrentPosition(() => r('granted'), (e) => r(e.code)))); return out })()""")
    check("no camera, no place", out[:2] == ["NotAllowedError"] * 2 and out[2] == 1, out)


def section_leaks():
    c.restart()
    download = "(() => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['x'])); a.download = 'leak'; document.body.append(a); a.click(); return true })()"
    for name, act in [
        ("plain", lambda: None),
        ("an unanswered call", lambda: c.js(FILES, "(BuckyApi.getCurrentUser(), true)")),
        ("a dialog", lambda: (c.js(FILES, "(setTimeout(() => confirm('?'), 50), true)"), time.sleep(1.2))),
        ("a refused camera", lambda: c.js(FILES, "navigator.mediaDevices.getUserMedia({ video: true }).catch((e) => e.name)")),
        ("a download", lambda: (c.js(FILES, download, gesture=True), time.sleep(1.5))),
        ("a location from a new frame", lambda: c.js(FILES, "(() => { const f = document.createElement('iframe'); document.body.append(f); f.contentWindow.navigator.geolocation.getCurrentPosition(() => 1, () => 1); return true })()")),
    ]:
        view = files(); act(); c.invoke("content_close", id=view); time.sleep(3)
        left = [url for url in c.urls() if not url.startswith(LOCAL)]
        check(f"a closed view is gone ({name})", left == [], left)
        if left: c.restart()


def section_activation():
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
        probe.connect(("192.0.2.1", 9)); address = probe.getsockname()[0]
    folder = tempfile.mkdtemp()
    open(f"{folder}/index.html", "w").write("<script>window.out = [typeof BuckyApi, BuckyApi.env.zone, BuckyApi.env.capabilities.length, document.cookie, localStorage.getItem('seen')]; localStorage.setItem('seen', 1); document.cookie = 'seen=1; Max-Age=999'</script>")
    handler = lambda *args: http.server.SimpleHTTPRequestHandler(*args, directory=folder)
    http.server.SimpleHTTPRequestHandler.log_message = lambda *args: None
    server = http.server.ThreadingHTTPServer(("0.0.0.0", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f"{address}:{server.server_port}"
    for turn in ("first", "second"):
        opened = c.invoke("activation_open", url=f"http://{origin}/", title="Device"); time.sleep(1.5)
        check(f"the {turn} activation page begins with nothing", c.js(origin, "window.out") == ["object", "", 0, "", None], c.js(origin, "window.out"))
    check("the one before is closed", sum(origin in url for url in c.urls()) == 1)
    names = ["frame.post", "audio.record.list", "app.open", "zone_list"]
    check("only wallet methods", c.js(origin, f"Promise.all({json.dumps(names)}.map((name) => BuckyApi.call(name, {{}}).then(() => 'ok', (e) => e.code)))") == ["unsupported"] * 4)
    check("which answer", c.js(origin, "BuckyApi.getPublicKey()")["code"] == 0)
    c.invoke("activation_close", id=opened["id"]); time.sleep(1.5)
    check("closed", not any(origin in url for url in c.urls()))


SECTIONS = {name[8:]: work for name, work in list(globals().items()) if name.startswith("section_")}
if __name__ == "__main__":
    c.ready()
    for name in sys.argv[1:] or SECTIONS:
        print(f"-- {name}")
        try: SECTIONS[name]()
        except Exception as error: check(f"{name} runs through", False, repr(error)[:300])
    print("failed:", failed or "none")
    sys.exit(bool(failed))
