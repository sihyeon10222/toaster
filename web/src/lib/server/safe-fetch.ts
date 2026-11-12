// 사용자가 넣은 주소로 요청을 보낼 때 내부망(SSRF)을 막는다. 리다이렉트마다 다시 검사한다.
// (없어진 파이썬 서버의 safety.py · SafeClient 를 옮긴 것)
import "server-only";
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 20_000;

export const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

export class FetchError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

// 사설·루프백·링크로컬·멀티캐스트 등 밖에서 닿으면 안 되는 대역
const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blocked.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  // ::ffff:0:0/96(IPv4 를 담은 IPv6)는 넣지 않는다. 넣으면 모든 IPv4 가 막히고, 위의 IPv4 규칙이 이미 그 주소에도 적용된다.
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blocked.addSubnet(net, prefix, "ipv6");
}

async function ensureSafeUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FetchError(`주소 형식이 아닙니다: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new FetchError("http 또는 https 주소만 받을 수 있습니다.");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookup(host, { all: true }).catch(() => []);
  if (addresses.length === 0) throw new FetchError(`주소를 찾을 수 없습니다: ${url.hostname}`);
  for (const a of addresses) {
    if (blocked.check(a.address, a.family === 6 ? "ipv6" : "ipv4")) {
      throw new FetchError("내부망 주소는 받을 수 없습니다.");
    }
  }
  return url;
}

/** 안전한 주소인지 확인하며 GET. 리다이렉트는 직접 따라가며 매번 검사한다. */
export async function safeFetch(raw: string, { referer }: { referer?: string } = {}): Promise<Response> {
  let url = raw;
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const checked = await ensureSafeUrl(url);
    let res: Response;
    try {
      res = await fetch(checked, {
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          "User-Agent": USER_AGENT,
          "Accept-Language": "ko,en;q=0.8",
          ...(referer ? { Referer: referer } : {}),
        },
      });
    } catch {
      throw new FetchError(`연결하지 못했습니다: ${checked.hostname}`, 502);
    }
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      url = new URL(location, checked).toString();
      continue;
    }
    if (!res.ok) throw new FetchError(`${httpReason(res.status)} (HTTP ${res.status}: ${checked})`, 502);
    return res;
  }
  throw new FetchError("리다이렉트가 너무 많습니다.", 502);
}

/** 본문을 maxBytes 까지만 읽는다. 넘으면 FetchError. */
export async function readLimited(res: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(res.headers.get("content-length"));
  if (declared > maxBytes) throw new FetchError("파일이 너무 큽니다.", 413);
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new FetchError("파일이 너무 큽니다.", 413);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/** 스트림을 maxBytes 에서 끊는다 (큰 영상을 메모리에 모으지 않고 흘려보낼 때) */
export function limitStream(body: ReadableStream<Uint8Array>, maxBytes: number): ReadableStream<Uint8Array> {
  let total = 0;
  return body.pipeThrough(
    new TransformStream({
      transform(chunk, controller) {
        total += chunk.byteLength;
        if (total > maxBytes) controller.error(new FetchError("파일이 너무 큽니다.", 413));
        else controller.enqueue(chunk);
      },
    }),
  );
}

/** 앱(Collector.swift)과 같은 문구 */
function httpReason(status: number) {
  if (status === 404 || status === 410) return "페이지를 찾을 수 없습니다. 주소를 확인해 주세요.";
  if (status === 401 || status === 403) return "사이트가 접근을 막았습니다.";
  if (status === 429) return "요청이 너무 많다고 사이트가 막았습니다. 잠시 뒤 다시 해 주세요.";
  if (status >= 500) return "사이트 서버에 문제가 있습니다.";
  return "받지 못했습니다.";
}
