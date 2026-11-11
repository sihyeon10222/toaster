// 파일 형식을 헤더가 아니라 실제 바이트로 판별한다. 브라우저(lib/collect.ts)와 서버(lib/server/telegram.ts)가 같이 쓴다.

export const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
  "image/avif": ".avif",
  "image/bmp": ".bmp",
  "image/x-icon": ".ico",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "video/webm": ".webm",
  "video/x-matroska": ".mkv",
  "video/x-msvideo": ".avi",
  "video/ogg": ".ogv",
};

const MP4_BRANDS = new Set([
  "isom", "iso2", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1",
  "M4V ", "M4VP", "dash", "MSNV", "f4v ", "3gp4", "3gp5", "3g2a",
]);

const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
const startsWith = (b: Uint8Array, bytes: number[]) => bytes.every((v, i) => b[i] === v);

/** 헤더를 믿지 않고 실제 바이트로 이미지·영상 형식을 판별한다. 모르면 null. */
export function sniffType(b: Uint8Array): string | null {
  if (startsWith(b, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (ascii(b, 0, 6) === "GIF87a" || ascii(b, 0, 6) === "GIF89a") return "image/gif";
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP") return "image/webp";
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "AVI ") return "video/x-msvideo";
  if (ascii(b, 4, 8) === "ftyp") {
    const brand = ascii(b, 8, 12);
    if (brand === "avif" || brand === "avis") return "image/avif";
    if (brand === "qt  ") return "video/quicktime";
    return MP4_BRANDS.has(brand) ? "video/mp4" : null;
  }
  if (ascii(b, 0, 4) === "OggS") return ascii(b, 0, 512).includes("\x80theora") ? "video/ogg" : null;
  if (startsWith(b, [0x1a, 0x45, 0xdf, 0xa3])) return ascii(b, 0, 64).includes("webm") ? "video/webm" : "video/x-matroska";
  if (ascii(b, 0, 2) === "BM") return "image/bmp";
  if (startsWith(b, [0x00, 0x00, 0x01, 0x00])) return "image/x-icon";
  const text = new TextDecoder().decode(b.subarray(0, 2048)).replace(/^﻿/, "").trimStart().toLowerCase();
  if ((text.startsWith("<svg") || text.startsWith("<?xml")) && text.includes("<svg")) return "image/svg+xml";
  return null;
}
