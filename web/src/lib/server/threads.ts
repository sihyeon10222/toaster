// 스레드(Threads) 게시물. 게시물 페이지는 로그인 없이 보면 사진·영상이 빠져 있다.
// 대신 누구나 볼 수 있는 "퍼가기(embed)" 페이지를 읽는다. iOS 앱의 Threads.swift 와 같은 규칙이다.
//
//   사진·영상 한 개:  .SoloMediaContainer 안의 <img> / <video><source>
//   여러 개:          .MediaScrollContainer 안의 <img> / <video><source> (게시물 순서대로)
import "server-only";
import * as cheerio from "cheerio";
import type { PostItem } from "@/lib/server/post";

export const threadsEmbedUrl = (code: string) => `https://www.threads.com/t/${code}/embed`;

/** 퍼가기 페이지에서 게시물의 사진·영상을 순서대로 모은다 */
export function threadsItems(html: string): { items: PostItem[]; title: string } {
  const $ = cheerio.load(html);
  const base = "https://www.threads.com/";
  const abs = (u: string | undefined) => {
    try {
      return u ? new URL(u, base).toString() : "";
    } catch {
      return "";
    }
  };
  const seen = new Set<string>();
  const items: PostItem[] = [];
  $(".SoloMediaContainer img, .SoloMediaContainer video, .MediaScrollContainer img, .MediaScrollContainer video").each(
    (_, el) => {
      const node = $(el);
      if (el.tagName === "video") {
        const url = abs(node.find("source[src]").first().attr("src") ?? node.attr("src"));
        if (!url || seen.has(url)) return;
        seen.add(url);
        items.push({ url, isVideo: true, preview: abs(node.attr("poster")) });
        return;
      }
      const url = abs(node.attr("src"));
      if (!url || seen.has(url)) return;
      seen.add(url);
      items.push({ url, isVideo: false, preview: url });
    },
  );
  const user = $(".HeaderLink span").first().text().trim();
  return { items, title: user ? `@${user}` : "" };
}
