"use client";

import { useSyncExternalStore } from "react";
import { KakaoEmoticonForm } from "@/components/kakao-emoticon-form";
import { ToasterForm } from "@/components/toaster-form";

const TABS = [
  { id: "kakao", label: "카카오 이모티콘" },
  { id: "general", label: "일반 페이지" },
] as const;

type TabId = (typeof TABS)[number]["id"];
const DEFAULT_TAB: TabId = "kakao";

// 탭은 주소 해시(#kakao, #general)로 관리해서 링크로 바로 열 수 있게 한다
const subscribe = (onChange: () => void) => {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
};
const readHash = (): TabId => {
  const id = window.location.hash.slice(1);
  return TABS.some((t) => t.id === id) ? (id as TabId) : DEFAULT_TAB;
};

export function ToasterTabs() {
  const tab = useSyncExternalStore(subscribe, readHash, () => DEFAULT_TAB);

  return (
    <div className="flex flex-col gap-6">
      <div role="tablist" aria-label="받기 방식" className="flex gap-1 rounded-xl bg-black/5 p-1 dark:bg-white/10">
        {TABS.map((t) => (
          <a
            key={t.id}
            href={`#${t.id}`}
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            className={`flex-1 rounded-lg px-4 py-2 text-center text-sm font-medium transition ${
              tab === t.id ? "bg-white shadow-sm dark:bg-neutral-800" : "opacity-60 hover:opacity-100"
            }`}
          >
            {t.label}
          </a>
        ))}
      </div>
      {/* 탭을 바꿔도 진행 중인 작업이 사라지지 않게 둘 다 마운트해 두고 숨긴다 */}
      {TABS.map((t) => (
        <div key={t.id} role="tabpanel" id={`panel-${t.id}`} aria-labelledby={`tab-${t.id}`} hidden={tab !== t.id}>
          {t.id === "kakao" ? <KakaoEmoticonForm /> : <ToasterForm />}
        </div>
      ))}
    </div>
  );
}
