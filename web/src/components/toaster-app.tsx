"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { GeneralForm } from "@/components/general-form";
import { GearIcon, Spinner, TrashIcon, XIcon } from "@/components/icons";
import { KakaoForm } from "@/components/kakao-form";
import { EmptyPanel, ResultPanel, formatBytes } from "@/components/result-panel";
import { SettingsDialog } from "@/components/settings-dialog";
import { Segmented, glassIconButton, iconButton } from "@/components/ui";
import { makeZip } from "@/lib/collect";
import { saveBlob } from "@/lib/download";
import { KAKAO_EMOTICON_SELECTOR, kakaoEmoticonUrl } from "@/lib/kakao";
import { instagramCode } from "@/lib/instagram";
import { clearPreviewCache } from "@/lib/preview-cache";
import { convertToStickers, zipStickers, type StickerProgress } from "@/lib/telegram";
import { isRunning, useJobs, type Entry, type Mode, type SaveKind } from "@/lib/use-jobs";

const MODES: { value: Mode; label: string }[] = [
  { value: "general", label: "일반 페이지" },
  { value: "kakao", label: "카카오 이모티콘" },
];
const DEFAULT_MODE: Mode = "kakao";

/** 저장할 zip 이름: 끝주소·사이트 주소의 - 를 _ 로 (iOS 앱의 폴더 이름과 같은 규칙) */
const saveName = (name: string) => name.replaceAll("-", "_");

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
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  return `${Math.floor(s / 86400)}일 전`;
}

const REVEAL = 84; // 밀었을 때 드러나는 삭제 버튼 폭

/**
 * 최근 작업 한 줄. 손가락으로 왼쪽으로 밀면 삭제 버튼이 나오고 끝까지 밀면 바로 지운다 (iOS 앱과 같은 동작).
 * 마우스로는 줄에 올리면 오른쪽에 지우기 버튼이 보인다.
 */
function HistoryItem({
  entry,
  selected,
  open,
  onOpenChange,
  onSelect,
  onDelete,
}: {
  entry: Entry;
  selected: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: () => void;
  onDelete: () => void;
}) {
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

  const rowRef = useRef<HTMLLIElement>(null);
  const drag = useRef<{ x: number; y: number; horizontal: boolean | null; moved: boolean } | null>(null);
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // 이만큼 넘게 밀었다가 놓으면 버튼을 누르지 않아도 지운다
  const fullSwipe = () => Math.max(REVEAL * 2, (rowRef.current?.offsetWidth ?? 320) * 0.55);
  const offset = (open ? -REVEAL : 0) + dx;
  const shown = offset > 0 ? offset / 4 : offset; // 오른쪽으로는 살짝만 끌려 온다

  const remove = () => {
    setDeleting(true);
    window.setTimeout(onDelete, 200);
  };

  return (
    <li
      ref={rowRef}
      className="group relative overflow-hidden border-line not-first:border-t-[0.5px]"
      onPointerDown={(e) => {
        if (e.pointerType !== "touch") return;
        drag.current = { x: e.clientX, y: e.clientY, horizontal: null, moved: false };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const mx = e.clientX - d.x, my = e.clientY - d.y;
        if (d.horizontal === null && Math.hypot(mx, my) > 10) {
          d.horizontal = Math.abs(mx) > Math.abs(my);
          if (d.horizontal) {
            setDragging(true);
            try {
              e.currentTarget.setPointerCapture(e.pointerId); // 줄 밖으로 손가락이 나가도 계속 따라오게
            } catch {}
          }
        }
        if (d.horizontal) {
          d.moved = true;
          setDx(mx);
        }
      }}
      onPointerUp={() => {
        const d = drag.current;
        drag.current = null;
        setDragging(false);
        if (!d?.horizontal) return;
        const end = (open ? -REVEAL : 0) + dx;
        setDx(0);
        if (end < -fullSwipe()) remove();
        else onOpenChange(end < -REVEAL / 2);
      }}
      onPointerCancel={() => {
        drag.current = null;
        setDragging(false);
        setDx(0);
      }}
    >
      {/* 밀면 드러나는 삭제 버튼 */}
      {(shown < -1 || deleting) && (
        <button
          type="button"
          onClick={remove}
          aria-hidden="true"
          tabIndex={-1}
          className="absolute inset-y-0 right-0 flex flex-col items-center justify-center gap-0.5 bg-danger text-xs font-semibold text-white"
          style={{ width: deleting ? "100%" : -shown }}
        >
          <TrashIcon className="size-4" />
          삭제
        </button>
      )}
      <div
        className={`relative flex items-center bg-surface ${dragging ? "" : "transition-transform duration-200"}`}
        style={{ transform: deleting ? "translateX(-100%)" : `translateX(${shown}px)`, touchAction: "pan-y" }}
      >
        <button
          type="button"
          onClick={() => (open ? onOpenChange(false) : onSelect())}
          aria-current={selected}
          className={`flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left transition ${
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
            <span className="truncate text-[17px] text-ink">{entry.title}</span>
            <span className={`truncate text-[15px] ${failed ? "text-danger" : "text-muted"}`}>{summary}</span>
          </span>
          <span className="shrink-0 text-[13px] text-muted group-hover:opacity-0 group-focus-within:opacity-0">
            {timeAgo(entry.startedAt)}
          </span>
        </button>
        {/* 마우스·키보드용 지우기 버튼 (올리거나 초점이 가면 보인다) */}
        <button
          type="button"
          onClick={remove}
          aria-label={`${entry.title} 기록 삭제`}
          title="삭제"
          className={`${iconButton} absolute right-1.5 size-8 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:hidden`}
        >
          <XIcon className="size-4" />
        </button>
      </div>
    </li>
  );
}

export function ToasterApp() {
  const mode = useSyncExternalStore(subscribe, readHash, () => DEFAULT_MODE);
  const { entries, selected, select, start, remove, removeAll, markSaved } = useJobs();
  const [settingsOpen, setSettingsOpen] = useState(false);
  // 최근 작업에서 밀어서 삭제 버튼이 열린 줄 (한 번에 하나만)
  const [swipedKey, setSwipedKey] = useState<string | null>(null);
  // 앱 초기화 때 바꿔서 입력 폼을 처음 상태로 다시 그린다
  const [formKey, setFormKey] = useState(0);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  // 이미 저장한 작업은 다시 누르면 한 번 더 저장할지 묻는다
  const confirmAgain = (entry: Entry, what: SaveKind) =>
    !entry.saved[what] || window.confirm("이미 저장했습니다. 한 번 더 저장할까요?");
  // 텔레그램 스티커 변환 진행 상황과 실패 목록 (작업별)
  const [stickerProgress, setStickerProgress] = useState<Record<string, StickerProgress>>({});
  const [stickerErrors, setStickerErrors] = useState<Record<string, string[]>>({});

  const setMode = (m: Mode) => {
    window.location.hash = m;
  };

  /** 앱 초기화: 기록·받아 둔 파일·캐시·입력을 모두 지우고 처음 화면으로 */
  const resetApp = async () => {
    removeAll();
    await clearPreviewCache();
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {}
    setStickerProgress({});
    setStickerErrors({});
    setSwipedKey(null);
    setFormKey((k) => k + 1);
    setSettingsOpen(false);
    setMode(DEFAULT_MODE);
  };

  const downloadZip = async (entry: Entry) => {
    if (entry.job?.status !== "done" || savingKey) return;
    if (!confirmAgain(entry, "zip")) return;
    setSavingKey(entry.key);
    try {
      saveBlob(await makeZip(entry.job.images), entry.zipName);
      markSaved(entry.key, "zip");
    } finally {
      setSavingKey(null);
    }
  };

  const downloadStickers = async (entry: Entry) => {
    const job = entry.job;
    if (job?.status !== "done" || stickerProgress[entry.key]) return;
    if (!confirmAgain(entry, "stickers")) return;
    const key = entry.key;
    setStickerErrors((m) => ({ ...m, [key]: [] }));
    try {
      const result = await convertToStickers(job.images, job.url, (p) =>
        setStickerProgress((m) => ({ ...m, [key]: p })),
      );
      setStickerErrors((m) => ({ ...m, [key]: result.errors }));
      if (result.files.length === 1) saveBlob(result.files[0].blob, result.files[0].filename);
      else if (result.files.length > 1) {
        saveBlob(await zipStickers(result.files), entry.zipName);
      }
      if (result.files.length > 0) markSaved(key, "stickers");
    } finally {
      setStickerProgress((m) => {
        const rest = { ...m };
        delete rest[key];
        return rest;
      });
    }
  };

  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <aside className="flex flex-col gap-7 border-b border-line bg-bg px-4 py-6 sm:px-6 lg:sticky lg:top-0 lg:h-dvh lg:w-[400px] lg:shrink-0 lg:overflow-y-auto lg:border-r lg:border-b-0">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-0.5 px-1 pt-9">
            <span className="text-[34px] leading-none font-bold tracking-[-0.02em]">toaster</span>
            <span className="text-[13px] text-muted">이모티콘·이미지·영상 수집기</span>
          </div>
          <button type="button" onClick={() => setSettingsOpen(true)} aria-label="설정" title="설정" className={glassIconButton}>
            <GearIcon className="size-5" />
          </button>
        </div>

        <section className="flex flex-col gap-6" aria-label="새 작업">
          <Segmented name="mode" value={mode} options={MODES} onChange={setMode} />
          {/* 모드를 바꿔도 입력한 내용이 남도록 둘 다 그려 두고 숨긴다 */}
          <div hidden={mode !== "kakao"}>
            <KakaoForm
              key={formKey}
              onSubmit={(slug) =>
                start(
                  { url: kakaoEmoticonUrl(slug), selector: KAKAO_EMOTICON_SELECTOR, media: "image" },
                  { mode: "kakao", title: slug, zipName: `${saveName(slug)}.zip` },
                )
              }
            />
          </div>
          <div hidden={mode !== "general"}>
            <GeneralForm
              key={formKey}
              onSubmit={(input) => {
                let title = input.url;
                let zipName = "toaster.zip";
                try {
                  const u = new URL(input.url);
                  title = u.hostname + (u.pathname === "/" ? "" : u.pathname);
                  const code = instagramCode(input.url);
                  zipName = `${saveName(code ? `instagram_${code}` : u.hostname)}.zip`;
                } catch {}
                start(input, { mode: "general", title, zipName });
              }}
            />
          </div>
        </section>

        <section className="flex flex-col gap-2" aria-label="최근 작업">
          <h2 className="px-4 text-[13px] text-muted">최근 작업</h2>
          {entries.length === 0 ? (
            <p className="rounded-[14px] bg-surface px-4 py-3 text-[15px] text-muted">아직 작업이 없습니다. 위에서 링크를 넣고 받기를 눌러 보세요.</p>
          ) : (
            <>
              <ul className="flex flex-col overflow-hidden rounded-[14px] bg-surface">
                {entries.map((e) => (
                  <HistoryItem
                    key={e.key}
                    entry={e}
                    selected={selected?.key === e.key}
                    open={swipedKey === e.key}
                    onOpenChange={(o) => setSwipedKey(o ? e.key : null)}
                    onSelect={() => {
                      setSwipedKey(null);
                      select(e.key);
                    }}
                    onDelete={() => remove(e.key)}
                  />
                ))}
              </ul>
              <p className="px-4 text-[13px] text-muted pointer-fine:hidden">왼쪽으로 밀면 지울 수 있습니다.</p>
            </>
          )}
        </section>

      </aside>

      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        entryCount={entries.length}
        downloadedBytes={entries.reduce((s, e) => s + (e.job?.images.reduce((t, f) => t + f.size, 0) ?? 0), 0)}
        onClearCache={clearPreviewCache}
        onClearData={() => {
          removeAll();
          setSwipedKey(null);
        }}
        onReset={resetApp}
      />

      <main className="min-w-0 flex-1">
        {selected ? (
          <ResultPanel
            key={selected.key}
            entry={selected}
            saving={savingKey === selected.key}
            zipSaved={!!selected.saved.zip}
            stickersSaved={!!selected.saved.stickers}
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
