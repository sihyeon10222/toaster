// HTML 에서 CSS 선택자로 이미지·영상 주소를 모은다. (없어진 파이썬 서버의 scraper.extract_media_urls 를 옮긴 것)
// iOS 앱의 Collector.swift 와 같은 규칙이다. 한쪽을 고치면 다른 쪽도 같이 고친다.
import "server-only";
import * as cheerio from "cheerio";
import type { AnyNode, Element } from "domhandler";

// 한 요소의 "본 그림" 주소가 들어 있을 수 있는 속성. 같은 그림의 크기별 주소라서 이 중 가장 큰 것 하나만 받는다.
// srcset 이 있으면 그중 가장 큰 후보, 없으면 이 순서로 처음 나오는 것 (lazy-load 원본이 src 보다 크다)
const MAIN_ATTRS = ["data-original", "data-lazy-src", "data-src", "data-url", "src"];
const SRCSET_ATTRS = ["srcset", "data-srcset"];
// 본 그림과 다른 파일을 가리키는 속성 (링크한 원본, 영상, 영상 포스터)
const EXTRA_ATTRS = ["href", "data-video-src", "poster"];
// 선택자가 감싸는 요소를 가리킬 때 안쪽에서 찾을 미디어 요소
const INNER_MEDIA = "img, picture source, video, video source";
const BG_URL_RE = /url\(\s*['"]?([^'")]+)['"]?\s*\)/g;

export const MAX_URLS = 500;
const MAX_GROUPS = 16;

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
  // 같은 그림의 크기별 주소(srcset 후보, src, data-src …) 중에서는 가장 큰 것 하나만
  const srcset = SRCSET_ATTRS.map((a) => $el.attr(a))
    .filter(Boolean)
    .join(",");
  const best = bestFromSrcset(srcset);
  const main = best ?? MAIN_ATTRS.map((a) => $el.attr(a)).find(Boolean);
  if (main) urls.push(main);
  for (const attr of EXTRA_ATTRS) {
    const v = $el.attr(attr);
    if (v) urls.push(v);
  }
  const style = $el.attr("style");
  if (style) for (const m of style.matchAll(BG_URL_RE)) urls.push(m[1]);
  return urls;
}

const tagOf = (el: AnyNode) => ("tagName" in el ? el.tagName : "");

/** <picture> 안의 <source> 는 같은 그림의 다른 형식·크기라서, 안에 <img> 가 있으면 그 <img> 하나만 본다 */
function isPictureAlternative(el: AnyNode) {
  const parent = el.parent;
  if (tagOf(el) !== "source" || !parent || tagOf(parent) !== "picture") return false;
  return (parent as Element).children.some((c) => tagOf(c) === "img");
}

function resolve(raw: string, base: string): string | null {
  const v = raw.trim();
  if (!v || /^(data:|javascript:|#)/i.test(v)) return null;
  try {
    const absolute = new URL(v, base).toString();
    return /^https?:/i.test(absolute) ? absolute : null;
  } catch {
    return null;
  }
}

function load(html: string, pageUrl: string) {
  const $ = cheerio.load(html);
  let base = pageUrl;
  const baseHref = $("base[href]").attr("href");
  if (baseHref) {
    try {
      base = new URL(baseHref, pageUrl).toString();
    } catch {}
  }
  return { $, base };
}

export class SelectorError extends Error {}

function select($: cheerio.CheerioAPI, selector: string) {
  try {
    return $(selector);
  } catch (e) {
    throw new SelectorError(`잘못된 선택자입니다: ${selector} (${(e as Error).message})`);
  }
}

/** 선택자에 맞는 요소들(과 그 안쪽 미디어)에서 이미지·영상 주소를 페이지 순서대로 모은다. */
function mediaUrls($: cheerio.CheerioAPI, base: string, selector: string): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const el of select($, selector).toArray()) {
    const $el = $(el);
    const candidates = urlsFromTag($el);
    // <div class="thumb">, <video> 처럼 감싸는 요소라면 안쪽 미디어도 본다
    const tag = tagOf(el);
    if (tag !== "img" && tag !== "source") {
      $el.find(INNER_MEDIA).each((_, inner) => {
        if (!isPictureAlternative(inner)) candidates.push(...urlsFromTag($(inner)));
      });
    }
    for (const raw of candidates) {
      const url = resolve(raw, base);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      urls.push(url);
      if (urls.length >= MAX_URLS) return urls;
    }
  }
  return urls;
}

export function extractMedia(html: string, pageUrl: string, selector: string) {
  const { $, base } = load(html, pageUrl);
  const urls = mediaUrls($, base, selector);
  // "카카오프렌즈 클래식 | 카카오 이모티콘샵" → "카카오프렌즈 클래식"
  const title = $("meta[property='og:title']").attr("content") || $("title").first().text() || "";
  return { urls, title: title.split(" | ")[0].trim() };
}

// ---------------------------------------------------------------- 페이지에 있는 요소 묶음 ("찾을 요소" 고르기)

/** 페이지에서 같은 모양으로 반복되는 이미지·영상 묶음 하나. selector 로 그대로 받을 수 있다. */
export interface ElementGroup {
  selector: string;
  isVideo: boolean;
  /** 이 묶음으로 받게 될 파일 수 (영상은 영상 요소 수) */
  count: number;
  /** 미리보기용 주소 몇 개 (영상은 포스터 이미지) */
  previews: string[];
  /** "페이지의 모든 이미지/영상" */
  isEverything: boolean;
}

// 상태에 따라 붙었다 떨어지는 클래스는 묶음 이름에 쓰지 않는다
const UNSTABLE_CLASSES = new Set([
  "lazy", "lazyload", "lazyloaded", "lazyloading", "loaded", "loading", "active", "on", "selected",
  "show", "hide", "hidden", "visible", "current", "is-active", "is-loaded",
]);
const USABLE_CLASS = /^-?[A-Za-z_][A-Za-z0-9_-]*$/;

function part(el: Element) {
  const classes = (el.attribs.class ?? "")
    .split(/\s+/)
    .filter((c) => c && c.length <= 40 && USABLE_CLASS.test(c) && !UNSTABLE_CLASSES.has(c.toLowerCase()))
    .sort()
    .slice(0, 2);
  return el.tagName + classes.map((c) => `.${c}`).join("");
}

/** "img.emoticon", 클래스가 없으면 클래스가 있는 조상을 붙여 "div.thumb img" */
function signature(el: Element) {
  const own = part(el);
  if (own.includes(".")) return own;
  let ancestor = el.parent;
  for (let depth = 0; ancestor && depth < 3; depth++) {
    const tag = tagOf(ancestor);
    if (!tag || tag === "body" || tag === "html") break;
    const p = part(ancestor as Element);
    if (p.includes(".")) return `${p} ${own}`;
    ancestor = ancestor.parent;
  }
  return own;
}

/** 1x1 추적 픽셀 같은 것 */
function isPixel(el: Element) {
  const w = parseInt(el.attribs.width ?? "", 10);
  const h = parseInt(el.attribs.height ?? "", 10);
  return w <= 2 || h <= 2;
}

/**
 * 페이지 안의 이미지·영상을 "태그.클래스" 모양이 같은 것끼리 묶는다.
 * 묶음마다 만든 선택자를 실제 받기와 같은 규칙(mediaUrls)으로 다시 돌려 개수·미리보기를 정확히 맞춘다.
 */
export function scanElements(html: string, pageUrl: string) {
  const { $, base } = load(html, pageUrl);
  const signatures: string[] = [];
  const kinds = new Map<string, boolean>();
  $("img, video, [style*=url]").each((_, node) => {
    const el = node as Element;
    const tag = el.tagName;
    if (tag === "img" && isPixel(el)) return;
    if (tag !== "img" && tag !== "video" && urlsFromTag($(el)).length === 0) return;
    const sig = signature(el);
    if (!kinds.has(sig)) {
      signatures.push(sig);
      kinds.set(sig, tag === "video");
    }
  });

  const group = (selector: string, isVideo: boolean, isEverything: boolean) => {
    let urls: string[];
    try {
      urls = mediaUrls($, base, selector);
    } catch {
      return null;
    }
    if (urls.length === 0) return null;
    const elements = $(selector).toArray();
    let count: number;
    const previews: string[] = [];
    if (isVideo) {
      count = elements.length;
      for (const el of elements) {
        const poster = resolve($(el).attr("poster") ?? "", base);
        if (poster && previews.length < 4) previews.push(poster);
      }
    } else {
      count = urls.length;
      // 미리보기는 요소마다 한 장만
      for (const el of elements) {
        const nodes = [el, ...$(el).find(INNER_MEDIA).toArray()];
        const first = nodes.flatMap((n) => urlsFromTag($(n))).map((u) => resolve(u, base)).find(Boolean);
        if (first && !previews.includes(first)) previews.push(first);
        if (previews.length >= 4) break;
      }
    }
    const g: ElementGroup = { selector, isVideo, count, previews, isEverything };
    return { g, key: [...urls].sort().join("\n") };
  };

  const result: ElementGroup[] = [];
  const seen = new Set<string>();
  for (const [selector, isVideo] of [["img", false], ["video", true]] as const) {
    const found = group(selector, isVideo, true);
    if (found) {
      result.push(found.g);
      seen.add(found.key);
    }
  }
  const specific: ElementGroup[] = [];
  for (const sig of signatures) {
    if (sig === "img" || sig === "video") continue;
    const found = group(sig, kinds.get(sig) ?? false, false);
    if (!found || seen.has(found.key)) continue;
    seen.add(found.key);
    specific.push(found.g);
  }
  // 많이 나오는 묶음이 위로 (같으면 페이지 순서; sort 는 안정 정렬)
  specific.sort((a, b) => b.count - a.count);
  return [...result, ...specific.slice(0, MAX_GROUPS)];
}
