// 스트리밍 영상(HLS, .m3u8)을 받아 mp4 한 파일로 만든다. 브라우저에서 모두 한다. (iOS 앱의 HLS.swift 와 같은 규칙)
//
//   1) 재생 목록을 읽는다. 화질 목록(master)이면 가장 큰 화질을 고르고, 소리가 따로 있으면 소리 목록도 고른다.
//   2) 조각(segment)을 /api/file 로 받는다. AES-128 로 잠긴 조각은 목록에 적힌 열쇠로 푼다.
//      그 밖의 잠금(SAMPLE-AES, Widevine·FairPlay 같은 DRM)은 받지 않는다.
//   3) 조각이 fMP4 면 그대로 잇고, MPEG-TS 면 mux.js 로 fMP4 로 바꿔 잇는다.
//   4) 소리가 따로 있으면 영상·소리 fMP4 를 한 파일로 합친다.
//
// 재생 목록 규칙: RFC 8216 (https://datatracker.ietf.org/doc/html/rfc8216)

const CONCURRENCY = 6;
const MAX_SEGMENTS = 20_000;
const MAX_BYTES = 1.5 * 1024 * 1024 * 1024;

export class HlsError extends Error {}

interface Part {
  url: string;
  /** [시작, 끝) 바이트 */
  range: [number, number] | null;
}
interface Key {
  url: string;
  iv: Uint8Array | null;
}
interface Segment {
  part: Part;
  key: Key | null;
  sequence: number;
  map: Part | null;
  mapEncrypted: boolean;
}

// ---------------------------------------------------------------- 재생 목록 읽기

const lines = (text: string) =>
  text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

/** `KEY=VALUE,KEY="VALUE, 쉼표 포함"` 꼴 속성 */
function attributes(line: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of line.matchAll(/([A-Z0-9-]+)=("[^"]*"|[^,]*)/g)) out[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
  return out;
}

const resolve = (uri: string, base: string) => new URL(uri, base).toString();

function hex(text: string): Uint8Array | null {
  const h = text.replace(/^0x/i, "");
  if (!/^[0-9a-f]+$/i.test(h) || h.length > 32) return null;
  const out = new Uint8Array(16);
  const padded = h.padStart(32, "0");
  for (let i = 0; i < 16; i++) out[i] = parseInt(padded.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function parseMaster(text: string, base: string) {
  const variants: { url: string; bandwidth: number; pixels: number; audio: string | null }[] = [];
  const audio: { group: string; url: string | null; isDefault: boolean }[] = [];
  let pending: Record<string, string> | null = null;
  for (const line of lines(text)) {
    if (line.startsWith("#EXT-X-STREAM-INF:")) pending = attributes(line.slice(18));
    else if (line.startsWith("#EXT-X-MEDIA:")) {
      const a = attributes(line.slice(13));
      if (a.TYPE === "AUDIO" && a["GROUP-ID"]) {
        audio.push({ group: a["GROUP-ID"], url: a.URI ? resolve(a.URI, base) : null, isDefault: a.DEFAULT === "YES" });
      }
    } else if (!line.startsWith("#") && pending) {
      const [w, h] = (pending.RESOLUTION ?? "").split("x").map(Number);
      variants.push({
        url: resolve(line, base),
        bandwidth: Number(pending.BANDWIDTH) || 0,
        pixels: w && h ? w * h : 0,
        audio: pending.AUDIO ?? null,
      });
      pending = null;
    }
  }
  return { variants, audio };
}

function parseMedia(text: string, base: string): Segment[] {
  const all = lines(text);
  if (!all.includes("#EXT-X-ENDLIST") && !all.some((l) => l.startsWith("#EXT-X-PLAYLIST-TYPE:VOD"))) {
    throw new HlsError("실시간 방송은 받을 수 없습니다. 다 올라온 영상만 받을 수 있습니다.");
  }
  const segments: Segment[] = [];
  let sequence = 0;
  let key: Key | null = null;
  let map: Part | null = null;
  let mapEncrypted = false;
  let range: { length: number; offset: number | null } | null = null;
  const lastEnd = new Map<string, number>();
  const byteRange = (spec: string) => {
    const [length, offset] = spec.split("@");
    return Number.isFinite(Number(length)) ? { length: Number(length), offset: offset ? Number(offset) : null } : null;
  };

  for (const line of all) {
    if (line.startsWith("#EXT-X-MEDIA-SEQUENCE:")) sequence = Number(line.slice(22)) || 0;
    else if (line.startsWith("#EXT-X-KEY:")) {
      const a = attributes(line.slice(11));
      const method = a.METHOD ?? "NONE";
      if (method === "NONE") key = null;
      else if (method === "AES-128" && (a.KEYFORMAT ?? "identity") === "identity" && a.URI) {
        key = { url: resolve(a.URI, base), iv: a.IV ? hex(a.IV) : null };
      } else throw new HlsError("DRM 으로 잠긴 영상이라 받을 수 없습니다.");
    } else if (line.startsWith("#EXT-X-MAP:")) {
      const a = attributes(line.slice(11));
      if (!a.URI) continue;
      const r = a.BYTERANGE ? byteRange(a.BYTERANGE) : null;
      const start = r?.offset ?? 0;
      map = { url: resolve(a.URI, base), range: r ? [start, start + r.length] : null };
      mapEncrypted = key !== null;
    } else if (line.startsWith("#EXT-X-BYTERANGE:")) range = byteRange(line.slice(17));
    else if (!line.startsWith("#")) {
      const url = resolve(line, base);
      let bytes: [number, number] | null = null;
      if (range) {
        const start = range.offset ?? lastEnd.get(url) ?? 0;
        bytes = [start, start + range.length];
        lastEnd.set(url, start + range.length);
      }
      segments.push({ part: { url, range: bytes }, key, sequence, map, mapEncrypted });
      sequence++;
      range = null;
    }
  }
  return segments;
}

// ---------------------------------------------------------------- 받기

async function get(part: Part, referer: string, signal?: AbortSignal): Promise<Uint8Array> {
  const q = new URLSearchParams({ url: part.url, referer });
  if (part.range) q.set("range", `bytes=${part.range[0]}-${part.range[1] - 1}`);
  const res = await fetch(`/api/file?${q}`, { signal, cache: "no-store" });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new HlsError(typeof body?.error === "string" ? body.error : `HTTP ${res.status}`);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  // 사이트가 Range 를 무시하고 파일 전체를 줬으면 필요한 부분만 자른다
  if (part.range && res.status !== 206 && bytes.byteLength >= part.range[1]) return bytes.slice(...part.range);
  return bytes;
}

async function getText(url: string, referer: string, signal?: AbortSignal) {
  const text = new TextDecoder().decode(await get({ url, range: null }, referer, signal));
  if (!text.replace(/^﻿/, "").trimStart().startsWith("#EXTM3U")) throw new HlsError("재생 목록(m3u8)이 아닙니다.");
  return text;
}

/** AES-128 열쇠는 한 번만 받는다 */
function keyStore(referer: string, signal?: AbortSignal) {
  const cache = new Map<string, Promise<CryptoKey>>();
  return async (data: Uint8Array, key: Key, sequence: number) => {
    let secret = cache.get(key.url);
    if (!secret) {
      secret = get({ url: key.url, range: null }, referer, signal).then((raw) => {
        if (raw.byteLength !== 16) throw new HlsError("영상 잠금 열쇠를 받지 못했습니다.");
        return crypto.subtle.importKey("raw", raw as BufferSource, "AES-CBC", false, ["decrypt"]);
      });
      cache.set(key.url, secret);
    }
    // IV 가 없으면 조각 번호를 16바이트 big-endian 으로 쓴다
    const iv = key.iv ?? new Uint8Array(16);
    if (!key.iv) new DataView(iv.buffer).setBigUint64(8, BigInt(sequence));
    try {
      return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-CBC", iv: iv as BufferSource }, await secret, data as BufferSource));
    } catch {
      throw new HlsError("잠긴 영상 조각을 풀지 못했습니다.");
    }
  };
}

const isFragmentedMp4 = (b: Uint8Array) =>
  b.byteLength >= 8 && ["ftyp", "styp", "moof", "sidx", "moov"].includes(String.fromCharCode(...b.subarray(4, 8)));

/** 조각을 동시에 몇 개씩 받되 순서대로 이어 붙인다. 결과는 fMP4 조각들. */
async function fetchStream(
  segments: Segment[],
  referer: string,
  tick: () => void,
  budget: { bytes: number },
  signal?: AbortSignal,
): Promise<Uint8Array[]> {
  const decrypt = keyStore(referer, signal);
  const out: Uint8Array[] = [];
  const ready = new Map<number, Uint8Array>();
  let expected = 0;
  let next = 0;
  let kind: "fmp4" | "ts" | null = null;
  let transmux: ((b: Uint8Array) => Uint8Array[]) | null = null;
  let lastMap: Part | null = null;
  let failure: unknown = null;

  const push = (b: Uint8Array) => {
    budget.bytes += b.byteLength;
    if (budget.bytes > MAX_BYTES) throw new HlsError("영상이 너무 큽니다.");
    out.push(b);
  };

  // 받은 조각을 순서대로 처리한다 (TS 변환기는 한 줄로만 먹여야 시간이 이어진다)
  let draining = Promise.resolve();
  const drain = () =>
    (draining = draining.then(async () => {
      while (ready.has(expected)) {
        const data = ready.get(expected)!;
        ready.delete(expected);
        const seg = segments[expected];
        if (!kind) {
          kind = seg.map || isFragmentedMp4(data) ? "fmp4" : "ts";
          if (kind === "ts") transmux = await transmuxer();
        }
        if (kind === "fmp4") {
          if (seg.map && (lastMap?.url !== seg.map.url || lastMap?.range?.[0] !== seg.map.range?.[0])) {
            let init = await get(seg.map, referer, signal);
            if (seg.key && seg.mapEncrypted) init = await decrypt(init, seg.key, seg.sequence);
            push(init);
            lastMap = seg.map;
          }
          push(data);
        } else {
          transmux!(data).forEach(push);
        }
        expected++;
        tick();
      }
    }));

  const worker = async () => {
    while (next < segments.length && !failure && !signal?.aborted) {
      const index = next++;
      const seg = segments[index];
      try {
        let data = await get(seg.part, referer, signal);
        if (seg.key) data = await decrypt(data, seg.key, seg.sequence);
        ready.set(index, data);
        await drain();
      } catch (e) {
        failure ??= e;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, segments.length) }, worker));
  await draining.catch((e) => (failure ??= e));
  if (failure) throw failure;
  if (signal?.aborted) throw new HlsError("취소했습니다.");
  return out;
}

// ---------------------------------------------------------------- MPEG-TS → fMP4 (mux.js)

/**
 * mux.js 출력은 브라우저 재생(MSE)용이라 파일로 쓰려면 두 군데를 고친다 (iOS 앱과 같은 처리):
 *  - 초기화 상자의 길이가 0xFFFFFFFF(모름) → 0(조각에서 계산)
 *  - 영상·소리 조각 번호(mfhd)가 따로 1부터 → 나중에 파일 전체에서 차례대로 (renumber)
 */
async function transmuxer() {
  const { default: muxjs } = await import("mux.js");
  const tm = new muxjs.mp4.Transmuxer();
  let pending: Uint8Array[] = [];
  let wroteInit = false;
  tm.on("data", (segment) => {
    if (!wroteInit) {
      pending.push(clearDurations(segment.initSegment));
      wroteInit = true;
    }
    pending.push(segment.data);
  });
  return (bytes: Uint8Array) => {
    tm.push(bytes);
    tm.flush();
    const parts = pending;
    pending = [];
    return parts;
  };
}

// ---------------------------------------------------------------- mp4 상자 다루기

interface Box {
  type: string;
  start: number;
  size: number;
}

function boxes(b: Uint8Array, start = 0, end = b.byteLength): Box[] {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out: Box[] = [];
  let i = start;
  while (i + 8 <= end) {
    let size = v.getUint32(i);
    if (size === 1 && i + 16 <= end) size = Number(v.getBigUint64(i + 8));
    else if (size === 0) size = end - i;
    if (size < 8 || i + size > end) break;
    out.push({ type: String.fromCharCode(...b.subarray(i + 4, i + 8)), start: i, size });
    i += size;
  }
  return out;
}

const CONTAINERS = new Set(["moov", "trak", "mdia", "mvex", "moof", "traf"]);

/** 상자를 안쪽까지 훑으며 visit 를 부른다 */
function walk(b: Uint8Array, visit: (box: Box, v: DataView) => void, start = 0, end = b.byteLength) {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  for (const box of boxes(b, start, end)) {
    visit(box, v);
    if (CONTAINERS.has(box.type)) walk(b, visit, box.start + 8, box.start + box.size);
  }
}

function clearDurations(b: Uint8Array) {
  walk(b, (box) => {
    const ver = b[box.start + 8];
    const zero = (at: number, n: number) => b.fill(0, box.start + at, box.start + at + n);
    if (box.type === "mvhd" || box.type === "mdhd") zero(ver === 1 ? 32 : 24, ver === 1 ? 8 : 4);
    else if (box.type === "tkhd") zero(ver === 1 ? 36 : 28, ver === 1 ? 8 : 4);
    else if (box.type === "mehd") zero(12, ver === 1 ? 8 : 4);
  });
  return b;
}

/** 조각 번호(mfhd)를 파일 전체에서 1부터 차례대로 다시 매긴다 */
function renumber(parts: Uint8Array[]) {
  let sequence = 0;
  for (const p of parts) walk(p, (box, v) => box.type === "mfhd" && v.setUint32(box.start + 12, ++sequence));
}

const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.byteLength, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.byteLength;
  }
  return out;
};

function makeBox(type: string, children: Uint8Array[]) {
  const body = concat(children);
  const out = new Uint8Array(8 + body.byteLength);
  new DataView(out.buffer).setUint32(0, out.byteLength);
  out.set(new TextEncoder().encode(type), 4);
  out.set(body, 8);
  return out;
}

/** 이어 붙인 fMP4 를 초기화 부분(ftyp·moov)과 조각들(moof 부터 다음 moof 앞까지)로 나눈다 */
function splitFragments(file: Uint8Array) {
  const top = boxes(file);
  const firstMoof = top.findIndex((b) => b.type === "moof");
  const head = firstMoof < 0 ? top : top.slice(0, firstMoof);
  const fragments: Uint8Array[] = [];
  for (const box of top.slice(firstMoof < 0 ? top.length : firstMoof)) {
    const bytes = file.subarray(box.start, box.start + box.size);
    if (box.type === "moof" || fragments.length === 0) fragments.push(bytes);
    else fragments[fragments.length - 1] = concat([fragments[fragments.length - 1], bytes]);
  }
  return { head: head.map((b) => file.subarray(b.start, b.start + b.size)), fragments };
}

/**
 * 영상만 든 fMP4 와 소리만 든 fMP4 를 한 파일로 합친다.
 * 소리 트랙 번호를 영상 트랙 뒤로 옮기고(tkhd·trex·tfhd), moov 에 트랙을 더한 뒤 조각을 시간 순서대로 섞는다.
 */
function mergeAudio(videoParts: Uint8Array[], audioParts: Uint8Array[]): Uint8Array[] {
  const video = splitFragments(concat(videoParts));
  const audio = splitFragments(concat(audioParts));
  const vMoov = video.head.find((b) => boxes(b)[0]?.type === "moov");
  const aMoov = audio.head.find((b) => boxes(b)[0]?.type === "moov");
  if (!vMoov || !aMoov) throw new HlsError("영상과 소리를 합치지 못했습니다.");

  const children = (moov: Uint8Array) => boxes(moov, 8, moov.byteLength).map((b) => ({ ...b, bytes: moov.slice(b.start, b.start + b.size) }));
  const vKids = children(vMoov);
  const aKids = children(aMoov);
  const trackIds = vKids
    .filter((k) => k.type === "trak")
    .flatMap((k) => boxes(k.bytes, 8, k.bytes.byteLength).filter((b) => b.type === "tkhd").map((b) => ({ k, b })))
    .map(({ k, b }) => new DataView(k.bytes.buffer).getUint32(b.start + (k.bytes[b.start + 8] === 1 ? 28 : 20)));
  let nextId = Math.max(0, ...trackIds) + 1;
  const remap = new Map<number, number>();
  const setId = (bytes: Uint8Array, at: number) => {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const old = v.getUint32(at);
    if (!remap.has(old)) remap.set(old, nextId++);
    v.setUint32(at, remap.get(old)!);
  };

  const aTraks = aKids.filter((k) => k.type === "trak").map((k) => k.bytes);
  for (const t of aTraks) walk(t, (box) => box.type === "tkhd" && setId(t, box.start + (t[box.start + 8] === 1 ? 28 : 20)));
  const aMvex = aKids.find((k) => k.type === "mvex")?.bytes;
  const aTrex = aMvex ? boxes(aMvex, 8, aMvex.byteLength).filter((b) => b.type === "trex").map((b) => aMvex.slice(b.start, b.start + b.size)) : [];
  for (const t of aTrex) setId(t, 12);
  for (const f of audio.fragments) walk(f, (box) => box.type === "tfhd" && setId(f, box.start + 12));

  const vMvex = vKids.find((k) => k.type === "mvex")?.bytes;
  const vMvexKids = vMvex ? boxes(vMvex, 8, vMvex.byteLength).map((b) => vMvex.slice(b.start, b.start + b.size)) : [];
  // 두 파일의 시간 단위가 달라 남은 길이 값이 어긋나므로 길이는 조각에서 계산하게 비운다
  const moov = makeBox("moov", [
    ...vKids.filter((k) => k.type !== "mvex").map((k) => {
      if (k.type !== "mvhd") return k.bytes;
      // 다음 트랙 번호(mvhd 마지막 4바이트)
      new DataView(k.bytes.buffer).setUint32(k.bytes.byteLength - 4, nextId);
      return k.bytes;
    }),
    ...aTraks,
    makeBox("mvex", [...vMvexKids, ...aTrex]),
  ]);

  // 조각은 시간 비율대로 번갈아 놓는다
  const fragments: Uint8Array[] = [];
  let vi = 0;
  let ai = 0;
  while (vi < video.fragments.length || ai < audio.fragments.length) {
    const takeVideo =
      ai >= audio.fragments.length ||
      (vi < video.fragments.length && vi / video.fragments.length <= ai / audio.fragments.length);
    fragments.push(takeVideo ? video.fragments[vi++] : audio.fragments[ai++]);
  }
  const ftyp = video.head.filter((b) => boxes(b)[0]?.type === "ftyp");
  return [...ftyp, clearDurations(moov), ...fragments];
}

// ---------------------------------------------------------------- 전체

/**
 * 재생 목록 주소(이미 받은 내용 first)를 받아 mp4 Blob 을 만든다.
 * progress(끝낸 조각 수, 전체 조각 수) 는 조각을 받을 때마다 부른다.
 */
export async function downloadHls(
  url: string,
  first: string,
  referer: string,
  progress: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  let video = { url, text: first };
  let audio: { url: string; text: string } | null = null;
  if (first.includes("#EXT-X-STREAM-INF")) {
    const master = parseMaster(first, url);
    const best = master.variants.reduce<(typeof master.variants)[number] | null>(
      (a, v) => (!a || v.pixels > a.pixels || (v.pixels === a.pixels && v.bandwidth > a.bandwidth) ? v : a),
      null,
    );
    if (!best) throw new HlsError("재생 목록에 영상이 없습니다.");
    video = { url: best.url, text: await getText(best.url, referer, signal) };
    const rendition = master.audio
      .filter((r) => r.group === best.audio && r.url)
      .sort((a, b) => Number(b.isDefault) - Number(a.isDefault))[0];
    if (rendition?.url) audio = { url: rendition.url, text: await getText(rendition.url, referer, signal) };
  }
  const videoSegments = parseMedia(video.text, video.url);
  const audioSegments = audio ? parseMedia(audio.text, audio.url) : [];
  const total = videoSegments.length + audioSegments.length;
  if (total === 0) throw new HlsError("재생 목록에 영상 조각이 없습니다.");
  if (total > MAX_SEGMENTS) throw new HlsError("영상이 너무 깁니다.");

  let done = 0;
  progress(0, total);
  const tick = () => progress(++done, total);
  const budget = { bytes: 0 };
  let parts = await fetchStream(videoSegments, referer, tick, budget, signal);
  if (audioSegments.length > 0) {
    const audioParts = await fetchStream(audioSegments, referer, tick, budget, signal);
    // 영상 쪽에 소리가 이미 들어 있으면 따로 받은 소리는 넣지 않는다
    parts = hasAudio(parts) ? parts : mergeAudio(parts, audioParts);
  }
  renumber(parts);
  return new Blob(parts as BlobPart[], { type: "video/mp4" });
}

function hasAudio(parts: Uint8Array[]) {
  const head = parts.find((p) => boxes(p).some((b) => b.type === "moov"));
  if (!head) return false;
  let found = false;
  walk(head, (box) => {
    if (box.type === "hdlr" && String.fromCharCode(...head.subarray(box.start + 16, box.start + 20)) === "soun") found = true;
  });
  return found;
}
