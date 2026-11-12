"use client";

import { useEffect, useRef, useState } from "react";
import { buttonSecondary, hintText, labelText } from "@/components/ui";
import { bookmarkletHref } from "@/lib/bookmarklet";

/**
 * "Toaster로 받기" 북마클릿 설치 안내. 북마크바로 끌어다 놓으면 인스타그램·스레드·X 게시물을 연 채로 눌러 받는다.
 * React 는 javascript: 주소를 href 로 넣지 못하게 막아서 그려진 뒤에 직접 넣는다.
 */
export function BookmarkletCard() {
  const link = useRef<HTMLAnchorElement>(null);
  const [href, setHref] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const value = bookmarkletHref(window.location.origin);
    link.current?.setAttribute("href", value);
    // 처음 그릴 때 한 번만 주소를 만든다 (서버에서 그릴 때는 window 가 없다)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHref(value);
  }, []);

  return (
    <div className="flex flex-col gap-2">
      <span className={labelText}>인스타그램·스레드·X</span>
      <div className="flex flex-col gap-3 rounded-[14px] bg-surface px-4 py-3">
        <p className="text-[15px] leading-relaxed text-ink">
          아래 버튼을 북마크바로 끌어다 놓으세요. 게시물을 연 채로 그 북마크를 누르면 지금 보고 있는 사진·영상을 여기서
          받습니다.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <a
            ref={link}
            onClick={(e) => e.preventDefault()}
            draggable
            className={`${buttonSecondary} cursor-grab active:cursor-grabbing`}
            title="북마크바로 끌어다 놓으세요"
          >
            Toaster로 받기
          </a>
          <button
            type="button"
            disabled={!href}
            className={buttonSecondary}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(href);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              } catch {}
            }}
          >
            {copied ? "복사했습니다" : "주소 복사"}
          </button>
        </div>
      </div>
      <span className={hintText}>
        끌어다 놓을 수 없으면 아무 페이지나 북마크한 뒤, 북마크 주소를 &ldquo;주소 복사&rdquo;로 복사한 내용으로 바꿔 주세요.
        로그인 정보는 넘기지 않고, 브라우저가 이미 보여 준 사진·영상 주소만 넘깁니다.
      </span>
    </div>
  );
}
