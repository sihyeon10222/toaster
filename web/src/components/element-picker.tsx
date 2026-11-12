"use client";

// 일반 페이지의 "찾을 요소": 페이지를 먼저 훑어 이미지·영상 묶음을 보여 주고 거기서 고르게 한다.
// CSS 선택자를 모르는 사람도 미리보기를 보고 고를 수 있다. 아는 사람은 직접 입력해도 된다. (iOS 앱 ElementPicker.swift 와 같은 화면)
import { useCallback, useEffect, useRef, useState } from "react";
import { CheckIcon, ImageIcon, PlayIcon, SearchIcon, Spinner } from "@/components/icons";
import { ErrorBox, buttonSecondaryLg, hintText, inputBox, labelText } from "@/components/ui";
import type { Media } from "@/lib/collect";
import { loadPreview } from "@/lib/preview-cache";

export interface ElementGroup {
  selector: string;
  isVideo: boolean;
  count: number;
  previews: string[];
  isEverything: boolean;
  label?: string;
}

type Phase = { kind: "idle" } | { kind: "loading" } | { kind: "loaded" } | { kind: "failed"; message: string };

const visible = (groups: ElementGroup[], media: Media) =>
  groups.filter((g) => media === "all" || g.isVideo === (media === "video"));

/** 받을 종류에 안 맞는 묶음은 빼고, 아무것도 안 골랐으면 가장 그럴듯한 묶음(가장 많이 반복되는 것)을 고른다 */
function fitSelection(selected: Set<string>, groups: ElementGroup[], media: Media) {
  const list = visible(groups, media);
  const next = new Set([...selected].filter((id) => list.some((g) => g.selector === id)));
  if (next.size === 0) {
    const best = list.find((g) => !g.isEverything && g.count > 1) ?? list[0];
    if (best) next.add(best.selector);
  }
  return next;
}

/** 페이지 훑어보기 상태. GeneralForm 이 들고 있어 모드를 바꿔도 남는다. */
export function usePageScan() {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [groups, setGroups] = useState<ElementGroup[]>([]);
  const [pageUrl, setPageUrl] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [manual, setManual] = useState(false);
  const [manualSelector, setManualSelector] = useState("");
  const [scannedUrl, setScannedUrl] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);

  /** onMedia: 고른 받을 종류에 맞는 게 하나도 없으면(예: 릴스인데 "이미지") "둘 다" 로 바꿔 달라고 알린다 */
  const scan = useCallback(async (url: string, media: Media, onMedia?: (m: Media) => void) => {
    controller.current?.abort();
    const c = new AbortController();
    controller.current = c;
    setScannedUrl(url.trim());
    setPhase({ kind: "loading" });
    setGroups([]);
    setSelected(new Set());
    try {
      const res = await fetch(`/api/elements?${new URLSearchParams({ url: url.trim() })}`, { signal: c.signal });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(typeof body?.error === "string" ? body.error : `HTTP ${res.status}`);
      const found: ElementGroup[] = body.groups;
      setGroups(found);
      setPageUrl(body.url);
      const fitted = visible(found, media).length === 0 && found.length > 0 ? "all" : media;
      if (fitted !== media) onMedia?.(fitted);
      // 인스타그램 게시물은 사진·영상을 모두 골라 둔다 (게시물 하나를 통째로 받는 경우가 대부분)
      const all = found.every((g) => g.label);
      setSelected(all ? new Set(visible(found, fitted).map((g) => g.selector)) : fitSelection(new Set(), found, fitted));
      setPhase(
        found.length > 0
          ? { kind: "loaded" }
          : {
              kind: "failed",
              message: "이미지·영상을 찾지 못했습니다. 자바스크립트로 그리는 페이지라면 iOS 앱에서 받아 주세요.",
            },
      );
    } catch (e) {
      if (c.signal.aborted) return;
      setPhase({ kind: "failed", message: (e as Error).message || "페이지를 읽지 못했습니다." });
    }
  }, []);

  return {
    phase,
    groups,
    pageUrl,
    selected,
    manual,
    manualSelector,
    scan,
    setManual,
    setManualSelector,
    needsScan: (url: string) => scannedUrl !== url.trim(),
    toggle: (id: string) =>
      setSelected((s) => {
        const next = new Set(s);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    fit: (media: Media) => setSelected((s) => fitSelection(s, groups, media)),
    /** 받기에 넘길 선택자. 여러 묶음을 고르면 쉼표로 잇는다. */
    selectorFor: (media: Media) =>
      manual
        ? manualSelector.trim()
        : visible(groups, media)
            .filter((g) => selected.has(g.selector))
            .map((g) => g.selector)
            .join(", "),
  };
}

export type PageScan = ReturnType<typeof usePageScan>;

const COLLAPSED = 5;

export function ElementPicker({
  scan,
  media,
  canScan,
  onScan,
  url,
}: {
  scan: PageScan;
  media: Media;
  canScan: boolean;
  url: string;
  onScan: () => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const needsScan = scan.needsScan(url);

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <span className={labelText}>찾을 요소</span>
        <button
          type="button"
          onClick={() => scan.setManual(!scan.manual)}
          className="px-4 text-[13px] font-semibold text-ink transition hover:opacity-70"
        >
          {scan.manual ? "목록에서 고르기" : "직접 입력"}
        </button>
      </div>

      {scan.manual ? (
        <>
          <input
            spellCheck={false}
            placeholder="img.emoticon, div.thumb img"
            value={scan.manualSelector}
            onChange={(e) => scan.setManualSelector(e.target.value)}
            className={`${inputBox} font-mono text-sm`}
          />
          <span className={hintText}>CSS 선택자입니다. 감싸는 요소를 고르면 안쪽 이미지·영상까지 찾습니다.</span>
        </>
      ) : !canScan ? (
        <span className={hintText}>
          페이지 주소를 넣으면 그 페이지에 있는 이미지·영상을 묶음으로 보여 줍니다. 받을 묶음을 고르세요.
        </span>
      ) : needsScan ? (
        <>
          <button type="button" onClick={onScan} className={`${buttonSecondaryLg} w-full`}>
            <SearchIcon className="size-4" />
            페이지 살펴보기
          </button>
          <span className={hintText}>페이지에 어떤 이미지·영상이 있는지 먼저 보여 드립니다.</span>
        </>
      ) : scan.phase.kind === "loading" || scan.phase.kind === "idle" ? (
        <div className="flex h-16 items-center justify-center gap-2.5 rounded-[14px] bg-surface text-[15px] text-muted">
          <Spinner className="size-4 text-ink" />
          페이지를 살펴보는 중
        </div>
      ) : scan.phase.kind === "failed" ? (
        <>
          <ErrorBox message={scan.phase.message} />
          <button type="button" onClick={onScan} className={`${buttonSecondaryLg} w-full`}>
            다시 살펴보기
          </button>
        </>
      ) : (
        <GroupList
          groups={visible(scan.groups, media)}
          media={media}
          scan={scan}
          showAll={showAll}
          onShowAll={() => setShowAll((v) => !v)}
        />
      )}
    </div>
  );
}

function GroupList({
  groups,
  media,
  scan,
  showAll,
  onShowAll,
}: {
  groups: ElementGroup[];
  media: Media;
  scan: PageScan;
  showAll: boolean;
  onShowAll: () => void;
}) {
  if (groups.length === 0) {
    return (
      <span className={hintText}>{media === "video" ? "이 페이지에는 영상이 없습니다." : "이 페이지에는 이미지가 없습니다."}</span>
    );
  }
  const shown = showAll ? groups : groups.slice(0, COLLAPSED);
  return (
    <>
      <ul className="flex flex-col gap-2">
        {shown.map((g) => (
          <li key={g.selector}>
            <GroupRow
              group={g}
              referer={scan.pageUrl}
              selected={scan.selected.has(g.selector)}
              onToggle={() => scan.toggle(g.selector)}
            />
          </li>
        ))}
      </ul>
      {groups.length > COLLAPSED && (
        <button type="button" onClick={onShowAll} className="py-1 text-[13px] font-medium text-ink hover:underline">
          {showAll ? "접기" : `묶음 ${groups.length - COLLAPSED}개 더 보기`}
        </button>
      )}
      <span className={hintText}>여러 개를 고를 수 있습니다. 같은 파일은 한 번만 받습니다.</span>
    </>
  );
}

/** 묶음 한 줄: 고름 표시 · 이름 · 미리보기 몇 장 */
function GroupRow({
  group,
  referer,
  selected,
  onToggle,
}: {
  group: ElementGroup;
  referer: string;
  selected: boolean;
  onToggle: () => void;
}) {
  const kind = group.isVideo ? "영상" : "이미지";
  const title = group.label ?? (group.isEverything ? `페이지의 모든 ${kind}` : `${kind} 묶음`);
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      aria-label={`${title} ${group.count}개`}
      onClick={onToggle}
      className={`flex w-full items-start gap-3 rounded-[14px] bg-surface p-3.5 text-left transition focus-visible:outline-2 focus-visible:outline-ink ${
        selected ? "ring-2 ring-accent" : "hover:brightness-[.98]"
      }`}
    >
      <span
        className={`mt-px flex size-[22px] shrink-0 items-center justify-center rounded-full border-[1.5px] ${
          selected ? "border-transparent bg-accent text-accent-ink" : "border-line-strong"
        }`}
      >
        {selected && <CheckIcon className="size-3" />}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-2">
        <span className="flex items-baseline gap-1.5">
          <span className="text-[15px] font-semibold text-ink">{title}</span>
          <span className="text-sm text-muted tabular-nums">{group.count}개</span>
        </span>
        <span className="flex gap-1.5">
          {group.previews.length === 0 ? (
            <PreviewTile url={null} referer={referer} isVideo={group.isVideo} />
          ) : (
            group.previews.map((u) => <PreviewTile key={u} url={u} referer={referer} isVideo={group.isVideo} />)
          )}
        </span>
        {/* 이름이 붙은 묶음(스트리밍 영상 등)은 이름표라서 선택자를 보여 주지 않는다 */}
        {!group.isEverything && !group.label && (
          <span className="truncate font-mono text-xs text-muted">{group.selector}</span>
        )}
      </span>
    </button>
  );
}

/** 미리보기 한 장. 사이트가 다른 곳에서 보는 걸 막는 경우가 있어 서버가 페이지 주소를 Referer 로 붙여 받는다. */
function PreviewTile({ url, referer, isVideo }: { url: string | null; referer: string; isVideo: boolean }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!url) return;
    const c = new AbortController();
    let objectUrl: string | null = null;
    void loadPreview(url, referer, c.signal).then((u) => {
      if (c.signal.aborted) {
        if (u) URL.revokeObjectURL(u);
        return;
      }
      objectUrl = u;
      setSrc(u);
      setFailed(!u);
    });
    return () => {
      c.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url, referer]);

  return (
    <span
      className={`relative flex size-[52px] shrink-0 items-center justify-center overflow-hidden rounded-[10px] ${
        isVideo && !src ? "bg-black" : "checker"
      }`}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- 다른 사이트의 임의 이미지(blob)라 next/image 대상이 아님
        <img src={src} alt="" className="h-full w-full object-contain p-[3px]" />
      ) : isVideo ? null : url && !failed ? (
        <Spinner className="size-3.5 text-muted" />
      ) : (
        <ImageIcon className="size-4 text-muted" />
      )}
      {isVideo && (
        <span className="absolute flex size-5 items-center justify-center rounded-full bg-white/90 text-black">
          <PlayIcon className="size-2.5" />
        </span>
      )}
    </span>
  );
}
