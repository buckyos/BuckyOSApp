"""Evaluates scripts in the WebViews of a debug build on Android (Chrome DevTools protocol over adb)."""
import base64, http.client, json, os, socket, struct, subprocess, time
from urllib.parse import urlparse

APP = "com.buckyos.buckyosapp"


class Socket:
    """Just enough of a WebSocket."""
    def __init__(self, url):
        at = urlparse(url)
        self.sock = socket.create_connection((at.hostname, at.port), 10)
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall((f"GET {at.path} HTTP/1.1\r\nHost: {at.netloc}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                           f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n").encode())
        self.buffer = b""
        while b"\r\n\r\n" not in self.buffer: self.fill()
        head, self.buffer = self.buffer.split(b"\r\n\r\n", 1)
        if b" 101 " not in head.split(b"\r\n")[0]: raise ConnectionError(head.decode(errors="replace"))

    def fill(self):
        chunk = self.sock.recv(1 << 20)
        if not chunk: raise ConnectionError("closed")
        self.buffer += chunk

    def take(self, count):
        while len(self.buffer) < count: self.fill()
        taken, self.buffer = self.buffer[:count], self.buffer[count:]
        return taken

    def send(self, text, opcode=1):
        data, mask = text.encode() if isinstance(text, str) else text, os.urandom(4)
        size = len(data)
        head = bytes([0x80 | opcode]) + (bytes([0x80 | size]) if size < 126 else bytes([0x80 | 126]) + struct.pack(">H", size) if size < 65536 else bytes([0x80 | 127]) + struct.pack(">Q", size))
        self.sock.sendall(head + mask + bytes(byte ^ mask[i % 4] for i, byte in enumerate(data)))

    def receive(self, timeout):
        self.sock.settimeout(timeout)
        whole = b""
        while True:
            first, second = self.take(2)
            size = second & 0x7f
            if size == 126: size = struct.unpack(">H", self.take(2))[0]
            elif size == 127: size = struct.unpack(">Q", self.take(8))[0]
            data = self.take(size)
            if first & 0xf == 9: self.send(data, 10); continue
            if first & 0xf == 8: raise ConnectionError("closed")
            if first & 0xf == 10: continue
            whole += data
            if first & 0x80: return whole.decode()


class Page:
    def __init__(self, url):
        self.socket, self.n = Socket(url), 0

    def call(self, method, timeout=20, **params):
        self.n += 1
        self.socket.send(json.dumps({"id": self.n, "method": method, "params": params}))
        end = time.time() + timeout
        while True:
            left = end - time.time()
            if left <= 0: raise TimeoutError(method)
            answer = json.loads(self.socket.receive(left))
            if answer.get("id") == self.n:
                if "error" in answer: raise RuntimeError(answer["error"])
                return answer["result"]

    def eval(self, expression, timeout=20, gesture=False):
        """The value of an expression; promises are waited for."""
        wrapped = "(async () => { try { return { v: await (async () => (" + expression + "))() } } catch (e) { return { e: String(e && e.code ? e.code + ': ' + e.message : e) } } })()"
        answer = self.call("Runtime.evaluate", timeout, expression=wrapped, awaitPromise=True, returnByValue=True, userGesture=gesture)
        value = answer["result"].get("value")
        if value is None: raise RuntimeError(json.dumps(answer)[:300])
        if "e" in value: raise RuntimeError(value["e"])
        return value.get("v")


class Inspector:
    def __init__(self, serial):
        self.serial = serial
        for attempt in range(30):
            try:
                self.pid = self.adb("shell", "pidof", APP).strip()
                if self.pid:
                    self.port = int(self.adb("forward", "tcp:0", f"localabstract:webview_devtools_remote_{self.pid.split()[0]}").strip())
                    if self.pages(): return
            except (OSError, ValueError, subprocess.CalledProcessError): pass
            time.sleep(0.5)
        raise ConnectionError("no WebView to inspect")

    def adb(self, *args):
        return subprocess.check_output(["adb", "-s", self.serial, *args], text=True, stderr=subprocess.DEVNULL)

    def listing(self):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        connection.request("GET", "/json/list")
        return [page for page in json.loads(connection.getresponse().read()) if page.get("type") == "page"]

    def pages(self):
        return [(page["id"], page.get("url", ""), page.get("title", "")) for page in self.listing()]

    def page(self, match):
        for page in self.listing():
            if match(page.get("url", "")): return Page(page["webSocketDebuggerUrl"])
        raise LookupError("no such page")
