"""Evaluates scripts in the WebViews of a debug build in the simulator (Remote Web Inspector protocol)."""
import json, plistlib, socket, struct, subprocess, time, uuid

APP = "com.buckyos.buckyosapp"

class Inspector:
    def __init__(self, udid):
        self.udid = udid
        # A connection that just ended takes the inspector's service down for a moment.
        for attempt in range(10):
            try:
                self.connect()
                if self.pages(): return
            except (ConnectionError, OSError):
                pass
            time.sleep(0.5)

    def connect(self):
        path = subprocess.check_output(["xcrun", "simctl", "getenv", self.udid, "RWI_LISTEN_SOCKET"], text=True).strip()
        self.sock = socket.socket(socket.AF_UNIX)
        self.sock.connect(path)
        self.sock.settimeout(0.2)
        self.buffer = b""
        self.me = str(uuid.uuid4()).upper()
        self.apps, self.listing, self.data = {}, {}, []
        self.send("_rpc_reportIdentifier:")
        deadline = time.time() + 5
        while time.time() < deadline and not self.app():
            self.pump()

    def send(self, selector, **argument):
        argument["WIRConnectionIdentifierKey"] = self.me
        body = plistlib.dumps({"__selector": selector, "__argument": argument}, fmt=plistlib.FMT_BINARY)
        self.sock.sendall(struct.pack(">I", len(body)) + body)

    def pump(self):
        try:
            chunk = self.sock.recv(1 << 20)
            if not chunk: raise ConnectionError("closed")
            self.buffer += chunk
        except socket.timeout:
            pass
        while len(self.buffer) >= 4:
            size = struct.unpack(">I", self.buffer[:4])[0]
            if len(self.buffer) < 4 + size: break
            message = plistlib.loads(self.buffer[4:4 + size])
            self.buffer = self.buffer[4 + size:]
            self.handle(message["__selector"], message.get("__argument", {}))

    def handle(self, selector, argument):
        if selector == "_rpc_reportConnectedApplicationList:":
            self.apps = dict(argument["WIRApplicationDictionaryKey"])
        elif selector in ("_rpc_applicationConnected:", "_rpc_applicationUpdated:"):
            self.apps[argument["WIRApplicationIdentifierKey"]] = argument
        elif selector == "_rpc_applicationDisconnected:":
            self.apps.pop(argument["WIRApplicationIdentifierKey"], None)
        elif selector == "_rpc_applicationSentListing:":
            self.listing[argument["WIRApplicationIdentifierKey"]] = argument["WIRListingKey"]
        elif selector == "_rpc_applicationSentData:":
            self.data.append((argument["WIRDestinationKey"], json.loads(argument["WIRMessageDataKey"])))

    def app(self):
        for key, info in self.apps.items():
            if info.get("WIRApplicationBundleIdentifierKey") == APP: return key
        return None

    def pages(self):
        app = self.app()
        if not app: return []
        self.listing.pop(app, None)
        self.send("_rpc_forwardGetListing:", WIRApplicationIdentifierKey=app)
        deadline = time.time() + 2
        while time.time() < deadline and app not in self.listing: self.pump()
        return [(v["WIRPageIdentifierKey"], v.get("WIRURLKey", ""), v.get("WIRTitleKey", "")) for v in self.listing.get(app, {}).values()]

    def page(self, match, wait=8):
        deadline = time.time() + wait
        while True:
            found = self.pages()
            if not found:
                time.sleep(0.3)
                try: self.connect()
                except OSError: pass
                found = self.pages()
            for number, url, title in found:
                if (match(url) if callable(match) else match in url): return Page(self, number, url)
            if time.time() >= deadline: raise LookupError(f"no page {match}: {self.pages()}")
            time.sleep(0.3)

class Page:
    def __init__(self, inspector, number, url):
        self.i, self.number, self.url, self.sender, self.n, self.target = inspector, number, url, str(uuid.uuid4()).upper(), 0, None
        inspector.send("_rpc_forwardSocketSetup:", WIRApplicationIdentifierKey=inspector.app(), WIRPageIdentifierKey=number,
                       WIRSenderKey=self.sender, WIRAutomaticallyPause=False)
        deadline = time.time() + 8
        while time.time() < deadline and not self.target:
            inspector.pump()
            for dest, message in inspector.data:
                if dest == self.sender and message.get("method") == "Target.targetCreated" and message["params"]["targetInfo"]["type"] == "page":
                    self.target = message["params"]["targetInfo"]["targetId"]
        if not self.target: raise TimeoutError(f"no target for {url}")

    def close(self):
        self.i.send("_rpc_forwardDidClose:", WIRApplicationIdentifierKey=self.i.app(), WIRPageIdentifierKey=self.number, WIRSenderKey=self.sender)

    def raw(self, message):
        self.i.send("_rpc_forwardSocketData:", WIRApplicationIdentifierKey=self.i.app(), WIRPageIdentifierKey=self.number,
                    WIRSenderKey=self.sender, WIRSocketDataKey=json.dumps(message).encode())

    def call(self, method, timeout=20, **params):
        self.n += 1
        inner = self.n
        self.n += 1
        self.raw({"id": self.n, "method": "Target.sendMessageToTarget",
                  "params": {"targetId": self.target, "message": json.dumps({"id": inner, "method": method, "params": params})}})
        deadline = time.time() + timeout
        while time.time() < deadline:
            self.i.pump()
            for dest, message in list(self.i.data):
                if dest != self.sender: continue
                if message.get("method") == "Target.didCommitProvisionalTarget":
                    self.target = message["params"]["newTargetId"]
                if message.get("method") != "Target.dispatchMessageFromTarget": continue
                answer = json.loads(message["params"]["message"])
                if answer.get("id") == inner:
                    self.i.data.remove((dest, message))
                    if "error" in answer: raise RuntimeError(answer["error"])
                    return answer["result"]
        raise TimeoutError(method)

    def eval(self, expression, timeout=20, gesture=False):
        """The value of an expression; promises are waited for."""
        wrapped = "(async () => { try { return { v: await (async () => (" + expression + "))() } } catch (e) { return { e: String(e && e.code ? e.code + ': ' + e.message : e) } } })()"
        result = self.call("Runtime.evaluate", timeout, expression=wrapped, objectGroup="t", **({"emulateUserGesture": True} if gesture else {}))
        obj = result["result"]
        if result.get("wasThrown"): raise RuntimeError(obj.get("description"))
        result = self.call("Runtime.awaitPromise", timeout, promiseObjectId=obj["objectId"], returnByValue=True)
        value = result["result"].get("value")
        if value is None: return None
        if "e" in value: raise RuntimeError(value["e"])
        return value.get("v")
