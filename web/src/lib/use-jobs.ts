"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { collect, type CollectInput, type Job } from "@/lib/collect";

export type Mode = "kakao" | "general";

/** 화면 왼쪽 "최근 작업" 한 줄 */
export interface Entry {
  key: string;
  mode: Mode;
  /** 기록·결과 제목 (이모티콘 끝주소 또는 페이지 주소) */
  title: string;
  /** 카카오 작업은 `<끝주소>.zip` 이름으로 저장 */
  zipName: string;
  job: Job | null;
  startedAt: number;
}

const MAX_ENTRIES = 12;
let seq = 0;

/** 여러 작업을 동시에 돌리고 기록으로 남기는 훅 */
export function useJobs() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const controllers = useRef(new Map<string, AbortController>());

  // 화면을 떠나면 진행 중인 받기를 멈춘다
  useEffect(() => {
    const map = controllers.current;
    return () => map.forEach((c) => c.abort());
  }, []);

  const start = useCallback((input: CollectInput, meta: Pick<Entry, "mode" | "title" | "zipName">) => {
    const key = `${Date.now()}-${++seq}`;
    const controller = new AbortController();
    controllers.current.set(key, controller);
    setEntries((es) => {
      const next = [{ key, ...meta, job: null, startedAt: Date.now() }, ...es];
      // 오래된 기록이 밀려나면 그 파일들이 차지하던 메모리도 놓아 준다
      for (const old of next.slice(MAX_ENTRIES)) old.job?.images.forEach((f) => URL.revokeObjectURL(f.url));
      return next.slice(0, MAX_ENTRIES);
    });
    setSelectedKey(key);
    void collect(
      input,
      (job) => setEntries((es) => es.map((e) => (e.key === key ? { ...e, job } : e))),
      controller.signal,
    ).finally(() => controllers.current.delete(key));
  }, []);

  const selected = entries.find((e) => e.key === selectedKey) ?? null;
  return { entries, selected, select: setSelectedKey, start };
}

export const isRunning = (e: Entry) => e.job === null || e.job.status === "fetching" || e.job.status === "downloading";
