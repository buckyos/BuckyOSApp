const DEFAULT_SN_AUTH_URL = "https://sn.buckyos.ai/kapi/sn/auth";
const DEFAULT_USERNAME = "ssood111";
const DEFAULT_TIMEOUT_MS = 10000;

const username = (process.argv[2] || DEFAULT_USERNAME).trim().toLowerCase();
const snAuthUrl = process.env.SN_AUTH_URL || DEFAULT_SN_AUTH_URL;
const timeoutMs = Number(process.env.SN_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);

if (!username) {
    console.error("Usage: node test/check-sn-username.mjs [username]");
    process.exit(1);
}

const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), timeoutMs);
const seq = Date.now();

try {
    const response = await fetch(snAuthUrl, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            method: "auth.check_username",
            params: {
                name: username,
            },
            sys: [seq],
        }),
        signal: controller.signal,
    });

    const text = await response.text();
    let payload;

    try {
        payload = JSON.parse(text);
    } catch {
        payload = text;
    }

    console.log(JSON.stringify({
        request: {
            url: snAuthUrl,
            method: "auth.check_username",
            params: { name: username },
            timeoutMs,
        },
        httpStatus: response.status,
        ok: response.ok,
        response: payload,
    }, null, 2));

    if (!response.ok) {
        process.exit(1);
    }
} catch (error) {
    const cause = error instanceof Error && error.cause
        ? error.cause
        : null;

    console.error(JSON.stringify({
        request: {
            url: snAuthUrl,
            method: "auth.check_username",
            params: { name: username },
            timeoutMs,
        },
        error: error instanceof Error ? error.message : String(error),
        cause: cause instanceof Error
            ? {
                name: cause.name,
                message: cause.message,
                code: cause.code,
                syscall: cause.syscall,
                hostname: cause.hostname,
            }
            : cause,
    }, null, 2));
    process.exit(1);
} finally {
    clearTimeout(timer);
}
