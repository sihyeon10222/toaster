// 인스타그램 게시물·릴스. 게시물 페이지는 로그인 창과 자바스크립트로 그려서 그대로는 사진·영상이 없다.
// 대신 누구나 볼 수 있는 "퍼가기(embed)" 페이지를 읽는다. iOS 앱의 Instagram.swift 와 같은 규칙이다. (연결은 post.ts)
//
//   여러 장·영상 게시물: <script> 안 contextJSON → gql_data.shortcode_media (video_url, display_url, 여러 장이면 children)
//   사진 한 장 게시물:   <img class="EmbeddedMediaImage" srcset="… 1440w"> 에서 가장 큰 것
import "server-only";
import * as cheerio from "cheerio";

import type { PostItem as InstagramItem } from "@/lib/server/post";

export const instagramEmbedUrl = (code: string) => `https://www.instagram.com/p/${code}/embed/captioned/`;

type Media = {
  __typename?: string;
  video_url?: string;
  display_url?: string;
  owner?: { username?: string };
  edge_sidecar_to_children?: { edges?: { node: Media }[] };
};

function shortcodeMedia(html: string): Media | null {
  const m = html.match(/"contextJSON":"((?:[^"\\]|\\.)*)"/);
  if (!m) return null;
  try {
    const context = JSON.parse(JSON.parse(`"${m[1]}"`));
    return context?.gql_data?.shortcode_media ?? null;
  } catch {
    return null;
  }
}

/** 퍼가기 페이지에서 게시물의 사진·영상을 순서대로 모은다. */
export function instagramItems(html: string): { items: InstagramItem[]; title: string } {
  const media = shortcodeMedia(html);
  if (media) {
    const nodes = media.edge_sidecar_to_children?.edges?.map((e) => e.node) ?? [media];
    const items = nodes.flatMap((n): InstagramItem[] => {
      if (n.video_url) return [{ url: n.video_url, isVideo: true, preview: n.display_url ?? "" }];
      return n.display_url ? [{ url: n.display_url, isVideo: false, preview: n.display_url }] : [];
    });
    const user = media.owner?.username;
    return { items, title: user ? `@${user}` : "" };
  }

  // 사진 한 장: srcset 후보 중 가장 큰 것
  const $ = cheerio.load(html);
  const img = $("img.EmbeddedMediaImage").first();
  let best = img.attr("src") ?? "";
  let bestWidth = 0;
  for (const part of (img.attr("srcset") ?? "").split(",")) {
    const [u, w] = part.trim().split(/\s+/);
    const width = parseInt(w ?? "", 10) || 0;
    if (u && width > bestWidth) {
      best = u;
      bestWidth = width;
    }
  }
  const user = $(".UsernameText").first().text().trim();
  return { items: best ? [{ url: best, isVideo: false, preview: best }] : [], title: user ? `@${user}` : "" };
}
