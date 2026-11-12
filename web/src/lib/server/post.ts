// 인스타그램·X·스레드 게시물을 로그인 없이 볼 수 있는 퍼가기 데이터로 읽는다. iOS 앱의 Post.swift 와 같은 규칙이다.
// (각 플랫폼의 읽는 법은 instagram.ts, x.ts, threads.ts)
import "server-only";
import { POST_NAMES, postImagesToken, postVideosToken, type Post } from "@/lib/post";
import { instagramEmbedUrl, instagramItems } from "@/lib/server/instagram";
import { threadsEmbedUrl, threadsItems } from "@/lib/server/threads";
import { xDataUrl, xItems } from "@/lib/server/x";
import type { ElementGroup } from "@/lib/server/extract";

export { detectPost, type Post } from "@/lib/post";

export interface PostItem {
  url: string;
  isVideo: boolean;
  /** 미리보기 그림 (영상은 표지, 없으면 빈 문자열) */
  preview: string;
}

/**
 * X·스레드 퍼가기 데이터는 브라우저인 척하지 않고 이 이름으로 받는다. (iOS 앱의 Post.userAgent 와 같다)
 * 스레드는 데스크톱 브라우저에는 자바스크립트로만 그리는 빈 페이지를 주고, 그 밖에는 사진·영상이 든 HTML 을 준다.
 * 인스타그램은 예전 그대로 둔다.
 */
export const postUserAgent = (post: Post) => (post.kind === "instagram" ? undefined : "Toaster/1.0");

/** 실제로 읽는 공개 퍼가기 주소 */
export function postSource(post: Post): string {
  if (post.kind === "instagram") return instagramEmbedUrl(post.id);
  if (post.kind === "x") return xDataUrl(post.id);
  return threadsEmbedUrl(post.id);
}

/** 퍼가기 데이터에서 게시물의 사진·영상을 순서대로 모은다 */
export async function postItems(post: Post, text: string): Promise<{ items: PostItem[]; title: string }> {
  if (post.kind === "instagram") return instagramItems(text);
  if (post.kind === "x") return xItems(text);
  return threadsItems(text);
}

export function isPostToken(post: Post, selector: string) {
  return selector.includes(postImagesToken(post)) || selector.includes(postVideosToken(post));
}

/** 고른 이름표(사진·영상)에 맞는 주소만 */
export function pickPost(post: Post, items: PostItem[], selector: string) {
  const images = selector.includes(postImagesToken(post));
  const videos = selector.includes(postVideosToken(post));
  return items.filter((i) => (i.isVideo ? videos : images)).map((i) => i.url);
}

/** 게시물 안의 사진·영상을 두 묶음으로 */
export function postGroups(post: Post, items: PostItem[]): ElementGroup[] {
  const groups: ElementGroup[] = [];
  const photos = items.filter((i) => !i.isVideo);
  const videos = items.filter((i) => i.isVideo);
  if (photos.length > 0) {
    groups.push({
      selector: postImagesToken(post), isVideo: false, count: photos.length, isEverything: true,
      previews: photos.slice(0, 4).map((i) => i.preview), label: "게시물의 사진",
    });
  }
  if (videos.length > 0) {
    groups.push({
      selector: postVideosToken(post), isVideo: true, count: videos.length, isEverything: true,
      previews: videos.slice(0, 4).map((i) => i.preview).filter(Boolean), label: "게시물의 영상",
    });
  }
  return groups;
}

/**
 * 사진·영상을 하나도 찾지 못했을 때. 앱에서는 되는데 웹 서버(Vercel)만 막히는 경우가 있어 앱을 권한다.
 * (인스타그램은 웹 서버에 게시물 대신 빈 화면을 주는 일이 잦다)
 */
export function postEmptyMessage(post: Post) {
  if (post.kind === "instagram") {
    return "인스타그램이 웹 서버에는 이 게시물을 보여 주지 않았습니다. 아래 \"Toaster로 받기\" 북마크를 쓰거나 아이폰·아이패드·맥 앱에서 받아 주세요.";
  }
  return `${POST_NAMES[post.kind]} 게시물에서 사진·영상을 찾지 못했습니다. 사진·영상이 없거나 비공개·지워진 게시물일 수 있습니다. 웹 서버만 막혔을 수도 있으니 아래 "Toaster로 받기" 북마크나 아이폰·아이패드·맥 앱으로도 받아 보세요.`;
}

/** 퍼가기 데이터 요청을 플랫폼이 막았을 때 */
export function postBlockedMessage(post: Post) {
  const subject = { instagram: "인스타그램이", x: "X가", threads: "스레드가" }[post.kind];
  return `${subject} 웹 서버의 요청을 막았습니다. 아래 "Toaster로 받기" 북마크를 쓰거나 아이폰·아이패드·맥 앱에서 받아 주세요.`;
}
