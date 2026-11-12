// "Toaster로 받기" 북마클릿. 인스타그램·스레드·X 처럼 웹 서버에는 내용을 보여 주지 않는 사이트를 위해,
// 사용자가 보고 있는 페이지에서(그 사람의 브라우저가 이미 받은 내용만) 사진·영상 주소를 모아 Toaster 웹으로 넘긴다.
// 로그인 정보·쿠키는 넘기지 않고, 사이트의 차단을 피해 가지 않는다. 넘긴 주소는 웹이 /api/file 로 받는다.
//
//   인스타그램·스레드 게시물: 페이지에 실린 게시물 데이터(script[type=application/json])에서 code 가 주소의 게시물 코드와
//                            같은 항목을 찾아, 여러 장이면 장마다 가장 큰 영상(video_versions) 또는 사진(image_versions2)
//   그 밖(X 등):              재생기가 받은 .m3u8 화질 목록, <video> 주소, 화면의 큰 그림(X 사진은 원본 크기 name=orig)
//
// 넘기는 모양: <Toaster 주소>/#import=<JSON {page, title, urls}> (주소 # 뒤라 서버로 가지 않는다)

/** 북마클릿 본문. 주석 없이 한 덩어리로 둔다 (javascript: 주소로 들어간다). */
const SOURCE = `(()=>{
const out=[];const add=u=>{if(u&&/^https?:/.test(u)&&!out.includes(u))out.push(u)};
const big=a=>a&&a.slice().sort((x,y)=>(y.width||0)*(y.height||0)-(x.width||0)*(x.height||0))[0];
const code=(location.pathname.match(/\\/(?:p|reels?|tv|post)\\/([A-Za-z0-9_-]+)/)||[])[1];
if(code){let item=null;const walk=(o,d)=>{if(item||!o||typeof o!=='object'||d>80)return;if(Array.isArray(o)){for(const x of o)walk(x,d+1);return}if(o.code===code&&(o.video_versions||o.image_versions2||o.carousel_media)){item=o;return}for(const k in o)walk(o[k],d+1)};
for(const s of document.querySelectorAll('script[type="application/json"]')){try{walk(JSON.parse(s.textContent),0)}catch(e){}if(item)break}
if(item){for(const m of item.carousel_media||[item]){const v=big(m.video_versions);add(v?v.url:(big(m.image_versions2&&m.image_versions2.candidates)||{}).url)}}}
if(!out.length){for(const e of performance.getEntriesByType('resource')){const n=e.name;if(/\\.m3u8(\\?|$)/.test(n)&&!/\\/(avc1|mp4a|hevc|hvc1|vp09)\\//.test(n))add(n)}
for(const v of document.querySelectorAll('video')){const s=v.currentSrc||v.src;if(s&&!s.startsWith('blob:'))add(s);for(const t of v.querySelectorAll('source'))add(t.src)}
for(const i of document.querySelectorAll('img')){if(i.naturalWidth>=200&&i.naturalHeight>=200){let u=i.currentSrc||i.src;if(/pbs\\.twimg\\.com\\/media\\//.test(u))u=u.replace(/([?&]name=)[^&]+/,'$1orig');add(u)}}}
if(!out.length){alert('이 페이지에서 받을 사진·영상을 찾지 못했습니다. 게시물 페이지를 새로고침한 뒤 다시 눌러 주세요.');return}
window.open(__ORIGIN__+'/#import='+encodeURIComponent(JSON.stringify({page:location.href,title:document.title,urls:out.slice(0,200)})),'_blank');
})()`;

/** 이 Toaster 주소(origin)로 넘기는 북마클릿 주소 */
export function bookmarkletHref(origin: string) {
  return "javascript:" + encodeURIComponent(SOURCE.replace("__ORIGIN__", JSON.stringify(origin)));
}

export interface ImportedPage {
  page: string;
  title: string;
  urls: string[];
}

/** 주소 # 뒤의 import=… 를 읽는다. 아니면 null. */
export function readImport(hash: string): ImportedPage | null {
  if (!hash.startsWith("#import=")) return null;
  try {
    const data = JSON.parse(decodeURIComponent(hash.slice(8)));
    const urls = Array.isArray(data?.urls)
      ? data.urls.filter((u: unknown): u is string => typeof u === "string" && /^https?:\/\//.test(u)).slice(0, 200)
      : [];
    const page = typeof data?.page === "string" && /^https?:\/\//.test(data.page) ? data.page : "";
    if (!page || urls.length === 0) return null;
    return { page, title: typeof data.title === "string" ? data.title.slice(0, 200) : "", urls };
  } catch {
    return null;
  }
}
