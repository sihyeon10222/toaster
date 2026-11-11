"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { GeneralForm } from "@/components/general-form";
import { Spinner } from "@/components/icons";
import { KakaoForm } from "@/components/kakao-form";
import { EmptyPanel, ResultPanel, formatBytes } from "@/components/result-panel";
import { Segmented } from "@/components/ui";
import { makeZip } from "@/lib/collect";
import { saveBlob } from "@/lib/download";
import { KAKAO_EMOTICON_SELECTOR, kakaoEmoticonUrl } from "@/lib/kakao";
import { convertToStickers, zipStickers, type StickerProgress } from "@/lib/telegram";
import { isRunning, useJobs, type Entry, type Mode } from "@/lib/use-jobs";

const MODES: { value: Mode; label: string }[] = [
  { value: "kakao", label: "카카오 이모티콘" },
  { value: "general", label: "일반 페이지" },
];
const DEFAULT_MODE: Mode = "kakao";

// 모드는 주소 해시(#kakao, #general)로 관리해서 링크로 바로 열 수 있게 한다
const subscribe = (onChange: () => void) => {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
};
const readHash = (): Mode => {
  const id = window.location.hash.slice(1);
  return MODES.some((m) => m.value === id) ? (id as Mode) : DEFAULT_MODE;
};

function timeAgo(ms: number) {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return "방금";
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  return `${Math.floor(s / 3600)}시간 전`;
}

function HistoryItem({ entry, selected, onSelect }: { entry: Entry; selected: boolean; onSelect: () => void }) {
  const job = entry.job;
  const running = isRunning(entry);
  const failed = job?.status === "failed";
  const summary = !job
    ? "시작 중"
    : job.status === "failed"
      ? job.error ?? "실패"
      : running
        ? job.total > 0
          ? `받는 중 ${job.processed}/${job.total}`
          : "페이지 분석 중"
        : `${job.images.length}개 · ${formatBytes(job.images.reduce((s, f) => s + f.size, 0))}`;

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected}
        className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${
          selected ? "bg-surface-2" : "hover:bg-surface-2/60"
        }`}
      >
        <span className="flex size-5 shrink-0 items-center justify-center">
          {running ? (
            <Spinner className="size-3.5 text-ink" />
          ) : (
            <span className={`size-2 rounded-full ${failed ? "bg-danger" : "bg-ok"}`} />
          )}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium text-ink">{entry.title}</span>
          <span className={`truncate text-xs ${failed ? "text-danger" : "text-muted"}`}>{summary}</span>
        </span>
        <span className="shrink-0 text-xs text-muted">{timeAgo(entry.startedAt)}</span>
      </button>
    </li>
  );
}

export function ToasterApp() {
  const mode = useSyncExternalStore(subscribe, readHash, () => DEFAULT_MODE);
  const { entries, selected, select, start } = useJobs();
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const savedJobs = useRef(new Set<string>());
  // 텔레그램 스티커 변환 진행 상황과 실패 목록 (작업별)
  const [stickerProgress, setStickerProgress] = useState<Record<string, StickerProgress>>({});
  const [stickerErrors, setStickerErrors] = useState<Record<string, string[]>>({});

  const setMode = (m: Mode) => {
    window.location.hash = m;
  };

  const downloadZip = async (entry: Entry) => {
    if (entry.job?.status !== "done") return;
    setSavingKey(entry.key);
    try {
      saveBlob(await makeZip(entry.job.images), entry.zipName);
    } finally {
      setSavingKey(null);
    }
  };

  const downloadStickers = async (entry: Entry) => {
    const job = entry.job;
    if (job?.status !== "done" || stickerProgress[entry.key]) return;
    const key = entry.key;
    setStickerErrors((m) => ({ ...m, [key]: [] }));
    try {
      const result = await convertToStickers(job.images, job.url, (p) =>
        setStickerProgress((m) => ({ ...m, [key]: p })),
      );
      setStickerErrors((m) => ({ ...m, [key]: result.errors }));
      if (result.files.length === 1) saveBlob(result.files[0].blob, result.files[0].filename);
      else if (result.files.length > 1) {
        saveBlob(await zipStickers(result.files), entry.zipName.replace(/\.zip$/, "") + "_telegram.zip");
      }
    } finally {
      setStickerProgress((m) => {
        const rest = { ...m };
        delete rest[key];
        return rest;
      });
    }
  };

  // 카카오 작업이 끝나면 <끝주소>.zip 을 한 번 자동으로 저장
  useEffect(() => {
    for (const e of entries) {
      if (e.mode === "kakao" && e.job?.status === "done" && !savedJobs.current.has(e.key)) {
        savedJobs.current.add(e.key);
        void downloadZip(e);
      }
    }
  });

  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <aside className="flex flex-col gap-8 border-b border-line bg-surface px-5 py-7 sm:px-8 lg:sticky lg:top-0 lg:h-dvh lg:w-[400px] lg:shrink-0 lg:overflow-y-auto lg:border-r lg:border-b-0">
        <div className="flex flex-col gap-1">
          <div className="flex items-end gap-1">
            <span className="text-[30px] leading-none font-extrabold tracking-[-0.045em]">toaster</span>
            <span className="mb-[5px] size-2.5 rounded-full bg-accent ring-1 ring-ink/10" />
          </div>
          <span className="text-[13px] text-muted">이모티콘·이미지·영상 수집기</span>
        </div>

        <section className="flex flex-col gap-6" aria-label="새 작업">
          <Segmented name="mode" value={mode} options={MODES} onChange={setMode} />
          {/* 모드를 바꿔도 입력한 내용이 남도록 둘 다 그려 두고 숨긴다 */}
          <div hidden={mode !== "kakao"}>
            <KakaoForm
              onSubmit={(slug) =>
                start(
                  { url: kakaoEmoticonUrl(slug), selector: KAKAO_EMOTICON_SELECTOR, media: "image" },
                  { mode: "kakao", title: slug, zipName: `${slug}.zip` },
                )
              }
            />
          </div>
          <div hidden={mode !== "general"}>
            <GeneralForm
              onSubmit={(input) => {
                let title = input.url;
                let zipName = "toaster.zip";
                try {
                  const u = new URL(input.url);
                  title = u.hostname + (u.pathname === "/" ? "" : u.pathname);
                  zipName = `${u.hostname}.zip`;
                } catch {}
                start(input, { mode: "general", title, zipName });
              }}
            />
          </div>
        </section>

        <section className="flex flex-col gap-2" aria-label="최근 작업">
          <h2 className="px-1 text-[13px] font-semibold text-muted">최근 작업</h2>
          {entries.length === 0 ? (
            <p className="px-1 text-[13px] text-muted/80">아직 작업이 없습니다.</p>
          ) : (
            <ul className="-mx-2 flex flex-col">
              {entries.map((e) => (
                <HistoryItem key={e.key} entry={e} selected={selected?.key === e.key} onSelect={() => select(e.key)} />
              ))}
            </ul>
          )}
        </section>

        <p className="mt-auto text-xs leading-relaxed text-muted">
          받은 파일은 저작권자의 권리를 지켜 개인 용도로만 사용해 주세요.
        </p>
      </aside>

      <main className="min-w-0 flex-1">
        {selected ? (
          <ResultPanel
            key={selected.key}
            entry={selected}
            saving={savingKey === selected.key}
            onDownloadZip={() => downloadZip(selected)}
            stickerProgress={stickerProgress[selected.key] ?? null}
            stickerErrors={stickerErrors[selected.key] ?? []}
            onDownloadStickers={() => downloadStickers(selected)}
          />
        ) : (
          <EmptyPanel mode={mode} />
        )}
      </main>
    </div>
  );
}
