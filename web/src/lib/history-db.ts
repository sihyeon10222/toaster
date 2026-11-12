// 최근 작업 기록을 브라우저(IndexedDB)에 남겨 새로고침하거나 창을 닫았다 열어도 그대로 보이게 한다.
// 받은 파일(Blob)도 같이 넣는다. 화면용 blob: 주소는 열 때마다 새로 만든다. (iOS 앱은 History.swift 가 같은 일)
import { loopForever } from "@/lib/animation";
import type { CollectedFile, Job } from "@/lib/collect";
import type { Entry } from "@/lib/use-jobs";

const DB_NAME = "toaster";
const STORE = "entries";

type StoredFile = Omit<CollectedFile, "url">;
interface StoredEntry extends Omit<Entry, "job"> {
  job: (Omit<Job, "images"> & { images: StoredFile[] }) | null;
}

let opening: Promise<IDBDatabase | null> | null = null;

/** 열 수 없으면(사생활 보호 모드 등) null. 그때는 기록을 남기지 않고 그냥 쓴다. */
function open(): Promise<IDBDatabase | null> {
  opening ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "key" });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opening;
}

async function run(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest | void) {
  const db = await open();
  if (!db) return undefined;
  return new Promise<unknown>((resolve) => {
    try {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = tx.onabort = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

const running = (job: Job | null) => job === null || job.status === "fetching" || job.status === "downloading";

/** 기록 하나를 남긴다. 받는 중인 작업은 파일 없이 "시작함"만 적는다. */
export function putEntry(entry: Entry) {
  const job = running(entry.job)
    ? null
    : { ...entry.job!, images: entry.job!.images.map((f) => ({ kind: f.kind, filename: f.filename, blob: f.blob, source_url: f.source_url, content_type: f.content_type, size: f.size })) };
  const record: StoredEntry = { ...entry, job };
  return run("readwrite", (s) => s.put(record));
}

export const deleteEntry = (key: string) => run("readwrite", (s) => s.delete(key));
export const clearEntries = () => run("readwrite", (s) => s.clear());

/** 남겨 둔 기록을 최근 것부터 읽는다. 받는 도중에 창을 닫은 작업은 실패로 보여 준다. */
export async function loadEntries(): Promise<Entry[]> {
  const records = ((await run("readonly", (s) => s.getAll())) as StoredEntry[] | undefined) ?? [];
  const entries = await Promise.all(
    records.map(async (r): Promise<Entry> => {
      if (!r.job) {
        return {
          ...r,
          job: {
            url: r.url,
            title: "",
            status: "failed",
            total: 0,
            processed: 0,
            images: [],
            errors: [],
            error: "받는 도중에 페이지를 닫아서 멈췄습니다. 다시 받아 주세요.",
          },
        };
      }
      const images = await Promise.all(
        r.job.images.map(async (f): Promise<CollectedFile> => {
          let display: Blob = f.blob;
          if (f.kind === "image") {
            const bytes = new Uint8Array(await f.blob.arrayBuffer());
            display = new Blob([loopForever(bytes, f.content_type) as BlobPart], { type: f.content_type });
          }
          return { ...f, url: URL.createObjectURL(display) };
        }),
      );
      return { ...r, job: { ...r.job, images } };
    }),
  );
  return entries.sort((a, b) => b.startedAt - a.startedAt);
}
