"use client";

// 설정: 캐시 삭제, 데이터 삭제, 앱 초기화 (iOS 앱 SettingsView 의 "저장 공간"과 같은 내용)
// 웹은 받은 파일을 브라우저가 내려받기 폴더에 저장하므로 저장 폴더 설정은 없다.
import { useEffect, useRef, useState } from "react";
import { CheckIcon, ResetIcon, SparkleIcon, TrayIcon, XIcon } from "@/components/icons";
import { formatBytes } from "@/components/result-panel";
import { buttonSecondary, hintText, iconButton, labelText } from "@/components/ui";
import { previewCacheBytes } from "@/lib/preview-cache";

type Action = "cache" | "data" | "reset";

const CONFIRM: Record<Action, { title: string; message: string; button: string }> = {
  cache: {
    title: "캐시를 지울까요?",
    message: "페이지 미리보기 그림을 지웁니다. 최근 작업은 그대로 남습니다.",
    button: "캐시 삭제",
  },
  data: {
    title: "데이터를 지울까요?",
    message: "최근 작업 기록과 받아 둔 파일을 모두 지웁니다. 받는 중인 작업은 멈춥니다. 되돌릴 수 없습니다.",
    button: "데이터 삭제",
  },
  reset: {
    title: "앱을 초기화할까요?",
    message: "최근 작업, 받아 둔 파일, 캐시, 입력한 내용을 모두 지우고 처음 화면으로 돌아갑니다. 되돌릴 수 없습니다.",
    button: "초기화",
  },
};

export function SettingsDialog({
  open,
  onClose,
  entryCount,
  downloadedBytes,
  onClearCache,
  onClearData,
  onReset,
}: {
  open: boolean;
  onClose: () => void;
  entryCount: number;
  downloadedBytes: number;
  onClearCache: () => Promise<void>;
  onClearData: () => void;
  onReset: () => Promise<void>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [cacheBytes, setCacheBytes] = useState<number | null>(null);
  const [asking, setAsking] = useState<Action | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const measure = () => void previewCacheBytes().then(setCacheBytes, () => setCacheBytes(null));

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      setAsking(null);
      setNotice(null);
      measure();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const perform = async (action: Action) => {
    setAsking(null);
    if (action === "cache") {
      await onClearCache();
      setNotice("캐시를 지웠습니다.");
    } else if (action === "data") {
      onClearData();
      setNotice("최근 작업과 받아 둔 파일을 지웠습니다.");
    } else {
      await onReset();
      return;
    }
    measure();
  };

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose(); // 바깥 어두운 곳을 누르면 닫는다
      }}
      className="m-auto w-[min(440px,calc(100vw-32px))] rounded-2xl border border-line bg-bg p-0 text-ink shadow-card backdrop:bg-black/40"
    >
      <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
        <h2 className="text-[15px] font-semibold">설정</h2>
        <button type="button" onClick={onClose} aria-label="닫기" className={iconButton}>
          <XIcon className="size-4" />
        </button>
      </div>

      <div className="flex flex-col gap-2 p-5">
        <span className={labelText}>저장 공간</span>
        {asking ? (
          <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
            <span className="text-[15px] font-semibold">{CONFIRM[asking].title}</span>
            <span className={hintText}>{CONFIRM[asking].message}</span>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setAsking(null)} className={buttonSecondary}>
                취소
              </button>
              <button
                type="button"
                onClick={() => void perform(asking)}
                className="inline-flex h-10 items-center justify-center rounded-lg bg-danger px-3.5 text-sm font-semibold text-white transition hover:brightness-95"
              >
                {CONFIRM[asking].button}
              </button>
            </div>
          </div>
        ) : (
          <ul className="flex flex-col overflow-hidden rounded-2xl border border-line bg-surface p-1">
            <ManageRow
              icon={<SparkleIcon className="size-[18px]" />}
              title="캐시 삭제"
              detail="페이지 미리보기 그림"
              value={cacheBytes === null ? undefined : formatBytes(cacheBytes)}
              onClick={() => setAsking("cache")}
            />
            <ManageRow
              icon={<TrayIcon className="size-[18px]" />}
              title="데이터 삭제"
              detail={`최근 작업 ${entryCount}개와 받아 둔 파일`}
              value={entryCount === 0 ? undefined : formatBytes(downloadedBytes)}
              disabled={entryCount === 0}
              onClick={() => setAsking("data")}
            />
            <ManageRow
              icon={<ResetIcon className="size-[18px]" />}
              title="앱 초기화"
              detail="모든 기록·캐시·입력을 지우고 처음 상태로"
              destructive
              onClick={() => setAsking("reset")}
            />
          </ul>
        )}
        {notice && (
          <span className="flex items-center gap-1.5 text-[13px] font-medium text-ok">
            <CheckIcon className="size-4" />
            {notice}
          </span>
        )}
        <span className={hintText}>내려받은 zip·파일은 지우지 않습니다.</span>
      </div>
    </dialog>
  );
}

/** 저장 공간 한 줄: 아이콘 · 제목/설명 · 크기 */
function ManageRow({
  icon,
  title,
  detail,
  value,
  destructive = false,
  disabled = false,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
  value?: string;
  destructive?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <li className="border-line not-first:border-t">
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent"
      >
        <span className={`flex w-7 justify-center ${destructive ? "text-danger" : "text-ink"}`}>{icon}</span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className={`text-[15px] font-medium ${destructive ? "text-danger" : "text-ink"}`}>{title}</span>
          <span className="truncate text-[13px] text-muted">{detail}</span>
        </span>
        {value && <span className="shrink-0 text-[13px] text-muted tabular-nums">{value}</span>}
      </button>
    </li>
  );
}
