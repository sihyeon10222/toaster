// 스트리밍 영상(HLS, .m3u8) 주소 찾기. 서버(/api/scan, /api/elements)와 브라우저가 같이 쓴다. (iOS 앱은 HLS.swift)

/** "찾을 요소" 대신 쓰는 이름표: 페이지 속 스트리밍 영상(.m3u8) 또는 붙여 넣은 .m3u8 주소 자체 */
export const STREAM_TOKEN = ":stream-video";

/** 받은 내용이 HLS 재생 목록인가 */
export function isPlaylist(text: string) {
  return text.replace(/^﻿/, "").trimStart().startsWith("#EXTM3U");
}

/** 선택자에서 이름표를 떼어 낸다 */
export function splitStreamToken(selector: string) {
  const parts = selector.split(",").map((p) => p.trim());
  return { css: parts.filter((p) => p && p !== STREAM_TOKEN).join(", "), streams: parts.includes(STREAM_TOKEN) };
}

/** 페이지 HTML·스크립트 안에 적힌 .m3u8 주소들 (자바스크립트 플레이어가 쓰는 주소도 잡는다) */
export function streamUrlsInPage(html: string): string[] {
  const text = html.replaceAll("\\/", "/").replace(/\\u002F/gi, "/").replaceAll("&amp;", "&");
  const found = new Set<string>();
  for (const m of text.matchAll(/https?:\/\/[^\s"'<>\\()[\]{}]+?\.m3u8(?:\?[^\s"'<>\\()[\]{}]*)?/g)) {
    found.add(m[0]);
    if (found.size >= 20) break;
  }
  return [...found];
}

/** 페이지 속 스트리밍 영상 주소. 받은 것이 재생 목록 자체면 그 주소 하나. */
export function streamUrls(html: string, pageUrl: string): string[] {
  return isPlaylist(html.slice(0, 64)) ? [pageUrl] : streamUrlsInPage(html);
}
