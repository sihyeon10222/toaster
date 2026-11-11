// HTML 에서 CSS 선택자로 이미지·영상 주소를 모은다. (예전 toaster-server scraper.extract_media_urls 를 옮긴 것)
import "server-only";
import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";

// 이미지·영상 주소가 들어 있을 수 있는 속성들 (lazy-load 라이브러리 포함)
const SRC_ATTRS = ["src", "data-src", "data-original", "data-lazy-src", "data-url", "data-video-src", "href", "poster"];
const SRCSET_ATTRS = ["srcset", "data-srcset"];
// 선택자가 감싸는 요소를 가리킬 때 안쪽에서 찾을 미디어 요소
const INNER_MEDIA = "img, picture source, video, video source";
const BG_URL_RE = /url\(\s*['"]?([^'")]+)['"]?\s*\)/g;

export const MAX_URLS = 500;

/** srcset 에서 가장 큰 후보 ('1x', '640w' 같은 서술자 비교) */
function bestFromSrcset(value: string): string | null {
  let best: string | null = null;
  let bestScore = -1;
  for (const candidate of value.split(",")) {
    const bits = candidate.trim().split(/\s+/);
    if (!bits[0]) continue;
    const score = bits[1] ? parseFloat(bits[1]) || 1 : 1;
    if (score > bestScore) {
      best = bits[0];
      bestScore = score;
    }
  }
  return best;
}

function urlsFromTag($el: cheerio.Cheerio<AnyNode>): string[] {
  const urls: string[] = [];
  for (const attr of SRCSET_ATTRS) {
    const v = $el.attr(attr);
    const best = v && bestFromSrcset(v);
    if (best) urls.push(best);
  }
  for (const attr of SRC_ATTRS) {
    const v = $el.attr(attr);
    if (v) urls.push(v);
  }
  const style = $el.attr("style");
  if (style) for (const m of style.matchAll(BG_URL_RE)) urls.push(m[1]);
  return urls;
}

export class SelectorError extends Error {}

export function extractMedia(html: string, pageUrl: string, selector: string) {
  const $ = cheerio.load(html);
  let base = pageUrl;
  const baseHref = $("base[href]").attr("href");
  if (baseHref) {
    try {
      base = new URL(baseHref, pageUrl).toString();
    } catch {}
  }

  let matched: cheerio.Cheerio<AnyNode>;
  try {
    matched = $(selector);
  } catch (e) {
    throw new SelectorError(`잘못된 선택자입니다: ${selector} (${(e as Error).message})`);
  }

  const seen = new Set<string>();
  const urls: string[] = [];
  for (const el of matched.toArray()) {
    const $el = $(el);
    const candidates = urlsFromTag($el);
    // <div class="thumb">, <video> 처럼 감싸는 요소라면 안쪽 미디어도 본다
    const tag = "tagName" in el ? el.tagName : "";
    if (tag !== "img" && tag !== "source") {
      $el.find(INNER_MEDIA).each((_, inner) => {
        candidates.push(...urlsFromTag($(inner)));
      });
    }
    for (const raw of candidates) {
      const v = raw.trim();
      if (!v || /^(data:|javascript:|#)/i.test(v)) continue;
      let absolute: string;
      try {
        absolute = new URL(v, base).toString();
      } catch {
        continue;
      }
      if (!/^https?:/i.test(absolute) || seen.has(absolute)) continue;
      seen.add(absolute);
      urls.push(absolute);
      if (urls.length >= MAX_URLS) break;
    }
    if (urls.length >= MAX_URLS) break;
  }

  // "카카오프렌즈 클래식 | 카카오 이모티콘샵" → "카카오프렌즈 클래식"
  const title = $("meta[property='og:title']").attr("content") || $("title").first().text() || "";
  return { urls, title: title.split(" | ")[0].trim() };
}
