"use client";

import { useRef, useState } from "react";
import { saveFromUrl } from "@/lib/download";
import { formatTime, parseTime } from "@/lib/time";
import type { ToasterImage } from "@/lib/toaster";

const MIN_LENGTH = 0.1;

const buttonClass =
  "rounded-lg border border-black/15 px-3 py-1.5 text-sm hover:bg-black/5 disabled:opacity-50 dark:border-white/20 dark:hover:bg-white/10";

/** 시간 입력칸: 입력 중엔 글자를 그대로 두고, 포커스가 빠질 때 확정한다 */
function TimeField({ label, value, onCommit }: { label: string; value: number; onCommit: (seconds: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const invalid = draft !== null && parseTime(draft) === null;
  const commit = () => {
    if (draft !== null) {
      const parsed = parseTime(draft);
      if (parsed !== null) onCommit(parsed);
    }
    setDraft(null);
  };
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="opacity-60">{label}</span>
      <input
        value={draft ?? formatTime(value)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.currentTarget.blur(), e.preventDefault())}
        inputMode="decimal"
        aria-invalid={invalid}
        className={`w-28 rounded-lg border bg-transparent px-2.5 py-1.5 font-mono text-sm outline-none ${
          invalid ? "border-red-500" : "border-black/15 focus:border-amber-500 dark:border-white/20"
        }`}
      />
    </label>
  );
}

/** 영상 하나의 구간을 골라 서버에서 잘라 받는다. 다른 영상을 고르면 key 로 새로 그린다. */
export function VideoClipper({ file, onClose }: { file: ToasterImage; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [duration, setDuration] = useState(0);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [fast, setFast] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const previewEnd = useRef<number | null>(null);

  const onLoaded = () => {
    const d = videoRef.current?.duration ?? 0;
    setDuration(d);
    setStart(0);
    setEnd(d);
  };

  const clampStart = (v: number) => Math.min(Math.max(0, v), Math.max(0, end - MIN_LENGTH));
  const clampEnd = (v: number) => Math.max(Math.min(duration, v), start + MIN_LENGTH);

  const seek = (t: number) => {
    if (videoRef.current) videoRef.current.currentTime = t;
  };
  const current = () => videoRef.current?.currentTime ?? 0;

  const preview = () => {
    const v = videoRef.current;
    if (!v) return;
    previewEnd.current = end;
    v.currentTime = start;
    void v.play();
  };

  const onTimeUpdate = () => {
    const v = videoRef.current;
    if (v && previewEnd.current !== null && v.currentTime >= previewEnd.current) {
      v.pause();
      previewEnd.current = null;
    }
  };

  const download = async () => {
    setBusy(true);
    setMessage(null);
    const params = new URLSearchParams({ start: start.toFixed(3), end: end.toFixed(3), exact: String(!fast) });
    const stem = file.filename.replace(/\.[^.]+$/, "");
    const ext = fast ? file.filename.slice(file.filename.lastIndexOf(".")) : ".mp4";
    try {
      const name = await saveFromUrl(`${file.url}/clip?${params}`, `${stem}_clip${ext}`);
      setMessage({ ok: true, text: `${name} 저장을 시작했어요.` });
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const ready = duration > 0;
  const length = Math.max(0, end - start);

  return (
    <section
      aria-label={`${file.filename} 구간 자르기`}
      className="flex flex-col gap-4 rounded-2xl border border-amber-500/40 bg-amber-500/5 p-4 sm:p-6"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">
          ✂️ 구간 자르기 <span className="font-mono text-sm font-normal opacity-60">{file.filename}</span>
        </h2>
        <button type="button" onClick={onClose} className="text-sm opacity-60 hover:opacity-100" aria-label="구간 자르기 닫기">
          닫기 ✕
        </button>
      </div>

      <video
        ref={videoRef}
        src={file.url}
        controls
        playsInline
        preload="metadata"
        onLoadedMetadata={onLoaded}
        onTimeUpdate={onTimeUpdate}
        className="max-h-[50vh] w-full rounded-xl bg-black object-contain"
      />
      {file.content_type === "video/ogg" && (
        <p className="text-xs opacity-60">
          Chrome·Safari는 Ogg(Theora) 영상을 재생하지 못해 화면이 안 보일 수 있어요. 시간은 그대로 고를 수 있고, 정확
          모드로 자르면 어디서나 재생되는 mp4로 저장돼요.
        </p>
      )}

      {!ready ? (
        <p className="text-sm opacity-60">영상 길이를 읽는 중…</p>
      ) : (
        <>
          {/* 구간 표시 막대 + 시작/끝 슬라이더 */}
          <div className="flex flex-col gap-2">
            <div className="relative h-2 rounded-full bg-black/10 dark:bg-white/10">
              <div
                className="absolute inset-y-0 rounded-full bg-amber-500"
                style={{ left: `${(start / duration) * 100}%`, width: `${(length / duration) * 100}%` }}
              />
            </div>
            <label className="flex items-center gap-3 text-xs">
              <span className="w-6 opacity-60">시작</span>
              <input
                type="range"
                min={0}
                max={duration}
                step={0.1}
                value={start}
                onChange={(e) => {
                  const v = clampStart(Number(e.target.value));
                  setStart(v);
                  seek(v);
                }}
                className="flex-1 accent-amber-500"
                aria-label="시작 시각"
              />
            </label>
            <label className="flex items-center gap-3 text-xs">
              <span className="w-6 opacity-60">끝</span>
              <input
                type="range"
                min={0}
                max={duration}
                step={0.1}
                value={end}
                onChange={(e) => {
                  const v = clampEnd(Number(e.target.value));
                  setEnd(v);
                  seek(v);
                }}
                className="flex-1 accent-amber-500"
                aria-label="끝 시각"
              />
            </label>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <TimeField label="시작 (분:초)" value={start} onCommit={(v) => setStart(clampStart(v))} />
            <TimeField label="끝 (분:초)" value={end} onCommit={(v) => setEnd(clampEnd(v))} />
            <div className="pb-2 text-xs opacity-60">
              길이 {formatTime(length)} / 전체 {formatTime(duration)}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button type="button" className={buttonClass} onClick={() => setStart(clampStart(current()))}>
              ⏮ 지금 위치를 시작으로
            </button>
            <button type="button" className={buttonClass} onClick={() => setEnd(clampEnd(current()))}>
              지금 위치를 끝으로 ⏭
            </button>
            <button type="button" className={buttonClass} onClick={preview}>
              ▶ 구간 미리보기
            </button>
          </div>

          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={fast} onChange={(e) => setFast(e.target.checked)} className="mt-1" />
            <span>
              빠르게 자르기 (부정확)
              <span className="block text-xs opacity-60">
                {fast
                  ? "다시 인코딩하지 않아 빠르고 원본 형식 그대로지만, 시작이 앞쪽 키프레임으로 당겨져 몇 초 더 앞부터 담길 수 있어요."
                  : "기본은 프레임 단위로 정확하게 잘라 mp4로 저장해요. 영상이 길면 시간이 좀 걸려요."}
              </span>
            </span>
          </label>

          <button
            type="button"
            onClick={download}
            disabled={busy || length < MIN_LENGTH}
            className="rounded-lg bg-amber-500 px-4 py-2.5 font-semibold text-black transition hover:bg-amber-400 disabled:opacity-50"
          >
            {busy ? "자르는 중…" : `${formatTime(start)} ~ ${formatTime(end)} 구간 다운로드`}
          </button>

          {message && (
            <p
              role={message.ok ? "status" : "alert"}
              className={`text-sm ${message.ok ? "opacity-70" : "text-red-600 dark:text-red-400"}`}
            >
              {message.text}
            </p>
          )}
        </>
      )}
    </section>
  );
}
