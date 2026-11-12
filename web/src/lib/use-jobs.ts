"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { collect, type CollectInput, type Job } from "@/lib/collect";
import { clearEntries, deleteEntry, loadEntries, putEntry } from "@/lib/history-db";

export type Mode = "kakao" | "general";

/** 화면 왼쪽 "최근 작업" 한 줄 */
export interface Entry {
  key: string;
  mode: Mode;
  /** 기록·결과 제목 (이모티콘 끝주소 또는 페이지 주소) */
  title: string;
  /** 카카오 작업은 `<끝주소>.zip` 이름으로 저장 */
  zipName: string;
  /** 받을 페이지 주소 */
  url: string;
  job: Job | null;
  startedAt: number;
  /** 이미 저장한 것 (다시 누르면 한 번 더 저장할지 묻는다) */
  saved: { zip?: boolean; stickers?: boolean };
}

export type SaveKind = keyof Entry["saved"];

const MAX_ENTRIES = 12;
let seq = 0;

/** 여러 작업을 동시에 돌리고 기록으로 남기는 훅 */
export function useJobs() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const controllers = useRef(new Map<string, AbortController>());
  // 기록을 브라우저에 남긴다. 키마다 마지막으로 남긴 상태를 기억해 바뀐 것만 다시 쓴다.
  const [loaded, setLoaded] = useState(false);
  const stored = useRef(new Map<string, string>());

  // 처음 열 때 지난 기록을 불러온다
  useEffect(() => {
    let alive = true;
    void loadEntries().then((old) => {
      if (!alive) {
        old.forEach((e) => e.job?.images.forEach((f) => URL.revokeObjectURL(f.url)));
        return;
      }
      setEntries((es) => {
        const merged = [...es, ...old.filter((o) => !es.some((e) => e.key === o.key))];
        for (const extra of merged.slice(MAX_ENTRIES)) extra.job?.images.forEach((f) => URL.revokeObjectURL(f.url));
        return merged.slice(0, MAX_ENTRIES);
      });
      old.forEach((e) => stored.current.set(e.key, signature(e)));
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const keys = new Set(entries.map((e) => e.key));
    for (const key of [...stored.current.keys()]) {
      if (!keys.has(key)) {
        stored.current.delete(key);
        void deleteEntry(key);
      }
    }
    for (const e of entries) {
      const sig = signature(e);
      if (stored.current.get(e.key) === sig) continue;
      stored.current.set(e.key, sig);
      void putEntry(e);
    }
  }, [entries, loaded]);

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
      const next: Entry[] = [{ key, ...meta, url: input.url, job: null, startedAt: Date.now(), saved: {} }, ...es];
      // 오래된 기록이 밀려나면 그 파일들이 차지하던 메모리도 놓아 준다
      for (const old of next.slice(MAX_ENTRIES)) {
        controllers.current.get(old.key)?.abort();
        controllers.current.delete(old.key);
        old.job?.images.forEach((f) => URL.revokeObjectURL(f.url));
      }
      return next.slice(0, MAX_ENTRIES);
    });
    setSelectedKey(key);
    void collect(
      input,
      (job) =>
        setEntries((es) => {
          // 이미 지운 기록에 늦게 도착한 파일은 바로 놓아 준다
          if (!es.some((e) => e.key === key)) {
            job.images.forEach((f) => URL.revokeObjectURL(f.url));
            return es;
          }
          return es.map((e) => (e.key === key ? { ...e, job } : e));
        }),
      controller.signal,
    ).finally(() => controllers.current.delete(key));
  }, []);

  /** 기록 하나를 지운다. 받는 중이면 멈추고, 받아 둔 파일(blob)이 차지하던 메모리도 놓아 준다. */
  const remove = useCallback((key: string) => {
    controllers.current.get(key)?.abort();
    controllers.current.delete(key);
    setEntries((es) => {
      es.find((e) => e.key === key)?.job?.images.forEach((f) => URL.revokeObjectURL(f.url));
      return es.filter((e) => e.key !== key);
    });
    setSelectedKey((k) => (k === key ? null : k));
  }, []);

  const removeAll = useCallback(() => {
    controllers.current.forEach((c) => c.abort());
    controllers.current.clear();
    setEntries((es) => {
      es.forEach((e) => e.job?.images.forEach((f) => URL.revokeObjectURL(f.url)));
      return [];
    });
    stored.current.clear();
    void clearEntries();
    setSelectedKey(null);
  }, []);

  const markSaved = useCallback((key: string, what: SaveKind) => {
    setEntries((es) => es.map((e) => (e.key === key ? { ...e, saved: { ...e.saved, [what]: true } } : e)));
  }, []);

  const selected = entries.find((e) => e.key === selectedKey) ?? null;
  return { entries, selected, select: setSelectedKey, start, remove, removeAll, markSaved };
}

/** 남길 내용이 바뀌었는지 가리는 값. 받는 중에는 진행 숫자가 바뀌어도 다시 쓰지 않는다. */
const signature = (e: Entry) =>
  `${isRunning(e) ? "running" : e.job!.status}|${e.saved.zip ? 1 : 0}${e.saved.stickers ? 1 : 0}`;

export const isRunning = (e: Entry) => e.job === null || e.job.status === "fetching" || e.job.status === "downloading";
