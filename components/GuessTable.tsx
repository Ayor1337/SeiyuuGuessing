import { useCallback, useEffect, useRef, useState } from "react";
import { genderZh, prefectureOf, workTitle, type WorksFilter } from "@/lib/data";
import type { FieldResult, GuessResult } from "@/lib/game";

// 表格单元格的状态样式：浅色底 + 彩色文字，不再是卡片
const td = {
  green: "bg-emerald-500/15 text-emerald-400",
  yellow: "bg-amber-500/15 text-amber-300",
  gray: "text-zinc-300",
};

/** 悬浮提示文本：首行年份（游戏带「· 游戏」），有角色数据时追加一行「饰：…」；都没内容则 null */
function chipTipText(
  year: number | null,
  characters: string[] | undefined,
  isGame = false
): string | null {
  const lines: string[] = [];
  if (year) lines.push(isGame ? `${year} 年 · 游戏` : `${year} 年`);
  else if (isGame) lines.push("游戏");
  if (characters?.length) lines.push(`饰：${characters.join("、")}`);
  return lines.length ? lines.join("\n") : null;
}

function Cell({
  result,
  children,
}: {
  result: FieldResult;
  children: React.ReactNode;
}) {
  return (
    <td className={`px-3 py-2.5 text-center text-sm ${td[result.status]}`}>
      {children}
      {result.arrow === "up" && <span title="答案更大"> ▲</span>}
      {result.arrow === "down" && <span title="答案更小"> ▼</span>}
    </td>
  );
}

export default function GuessTable({
  results,
  works,
  showCharacters,
}: {
  results: GuessResult[];
  works: WorksFilter;
  /** 主页开关：悬停作品词条时显示配音角色（关闭后词条无任何悬浮提示） */
  showCharacters: boolean;
}) {
  // 自定义悬浮框：fixed 定位 + 词条视口坐标，避开表格 overflow-x-auto 对绝对定位气泡的裁切
  const [tip, setTip] = useState<{
    text: string;
    x: number;
    y: number;
    locked: boolean;
    rect: { left: number; top: number; right: number; bottom: number };
  } | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  // CK3 式悬浮框：持续悬停一段时间后「锁定」，边框光剑式点亮，此时可移入框内选中复制
  const lockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelLock = () => {
    if (lockTimer.current) {
      clearTimeout(lockTimer.current);
      lockTimer.current = null;
    }
  };
  // 未锁定阶段的延迟关闭：指针离开词条宽限片刻，避免快速划过时闪烁
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- 只操作 ref 与 state setter，保持引用稳定供事件监听复用
  const closeTip = useCallback(() => {
    cancelClose();
    cancelLock();
    setTip(null);
  }, []);
  const scheduleClose = () => {
    if (tip?.locked) return; // 锁定后改由下方的区域判定接管
    cancelClose();
    cancelLock();
    closeTimer.current = setTimeout(() => setTip(null), 300);
  };
  useEffect(() => closeTip, [closeTip]);
  // 锁定后的区域判定（CK3 机制）：指针在「词条 + 悬浮框」的联合区域（外扩 16px）内就保持打开，
  // 跨行移向悬浮框时即使途经上一排词条也不会被顶掉；驶出区域或页面滚动才关闭
  useEffect(() => {
    if (!tip?.locked) return;
    const box = tipRef.current?.getBoundingClientRect();
    if (!box) return;
    const M = 16;
    const chip = tip.rect;
    const region = {
      left: Math.min(chip.left, box.left) - M,
      top: Math.min(chip.top, box.top) - M,
      right: Math.max(chip.right, box.right) + M,
      bottom: Math.max(chip.bottom, box.bottom) + M,
    };
    const onMove = (e: MouseEvent) => {
      if (
        e.clientX < region.left ||
        e.clientX > region.right ||
        e.clientY < region.top ||
        e.clientY > region.bottom
      ) {
        closeTip();
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("scroll", closeTip, true);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("scroll", closeTip, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅在锁定状态变化时重建区域
  }, [tip?.locked, closeTip]);
  function openTip(e: React.MouseEvent<HTMLElement>, text: string | null) {
    if (!showCharacters || !text) return;
    if (tip?.locked) return; // 已有锁定悬浮框：忽略途经的其他词条，移出区域才会关闭
    cancelClose();
    cancelLock();
    const r = e.currentTarget.getBoundingClientRect();
    setTip({
      text,
      x: r.left + r.width / 2,
      y: r.top,
      locked: false,
      rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
    });
    // 持续悬停 0.2 秒后锁定并播放边框点亮动画（中途离开词条由 scheduleClose 取消计时）
    lockTimer.current = setTimeout(() => setTip((t) => (t ? { ...t, locked: true } : t)), 200);
  }
  if (results.length === 0) return null;
  // 作品范围：仅动画不渲染游戏段，仅游戏不渲染动画段
  const showAnime = works !== "game";
  const showGames = works !== "anime";
  const worksHeader =
    works === "game" ? "热门游戏" : works === "anime" ? "热门动画" : "热门作品";
  return (
    <div className="overflow-x-auto" onScroll={closeTip}>
      <table className="w-full border-collapse text-zinc-100">
        <thead>
          <tr className="border-b border-zinc-700 text-xs text-zinc-400">
            <th className="px-3 py-2 text-left font-medium">声优</th>
            <th className="px-3 py-2 font-medium">性别</th>
            <th className="px-3 py-2 font-medium">出生年份</th>
            <th className="px-3 py-2 font-medium">出身地</th>
            <th className="px-3 py-2 font-medium">血型</th>
            <th className="px-3 py-2 font-medium">出道年份</th>
            <th className="w-[38%] px-3 py-2 text-left font-medium">{worksHeader}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800">
          {results.map((r) => {
            const s = r.seiyuu;
            const sharedIds = new Set(r.sharedWorks.map((x) => x.id));
            const relatedIds = new Set(r.relatedWorks.map((x) => x.id));
            const sharedGameIds = new Set(r.sharedGameWorks.map((x) => x.id));
            // 命中/同系列的词条提到最前，格内只保留词条级高亮
            const displayWorks = [...s.works].sort((a, b) => {
              const rank = (w: typeof a) =>
                sharedIds.has(w.id) ? 0 : relatedIds.has(w.id) ? 1 : 2;
              return rank(a) - rank(b);
            });
            // 游戏词条（bgm.tv）排在动画之后，命中的提到最前；游戏暂无同系列提示
            const displayGames = [...s.game_works].sort(
              (a, b) => Number(sharedGameIds.has(b.id)) - Number(sharedGameIds.has(a.id))
            );
            return (
              <tr key={s.id}>
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    {s.image && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={s.image}
                        alt={s.display}
                        className="h-10 w-10 shrink-0 rounded object-cover"
                      />
                    )}
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{s.display}</div>
                      <div className="truncate text-xs text-zinc-500">{s.name_romaji}</div>
                    </div>
                  </div>
                </td>
                <Cell result={r.gender}>{genderZh(s.gender)}</Cell>
                <Cell result={r.birthYear}>{s.birth_year ?? "?"}</Cell>
                <Cell result={r.homeTown}>{prefectureOf(s.home_town) ?? "?"}</Cell>
                <Cell result={r.bloodType}>{s.blood_type ?? "?"}</Cell>
                <Cell result={r.debutYear}>{s.debut_year ?? "?"}</Cell>
                <td className="px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-1">
                    {showAnime &&
                      displayWorks.slice(0, 8).map((w) => (
                        <span
                          key={w.id}
                          onMouseEnter={(e) => openTip(e, chipTipText(w.year, w.characters))}
                          onMouseLeave={scheduleClose}
                          className={`rounded px-1.5 py-0.5 text-xs ${
                            sharedIds.has(w.id)
                              ? "bg-emerald-400 font-medium text-emerald-950"
                              : relatedIds.has(w.id)
                                ? "bg-amber-300 font-medium text-amber-950"
                                : "bg-zinc-700 text-zinc-300"
                          }`}
                        >
                          {workTitle(w)}
                        </span>
                      ))}
                    {showGames &&
                      displayGames.slice(0, 8).map((g) => {
                        const hit = sharedGameIds.has(g.id);
                        return (
                          <span
                            key={`g-${g.id}`}
                            onMouseEnter={(e) => openTip(e, chipTipText(g.year, g.characters, true))}
                            onMouseLeave={scheduleClose}
                            className={`rounded px-1.5 py-0.5 text-xs ${
                              hit
                                ? "bg-emerald-400 font-medium text-emerald-950"
                                : "bg-zinc-700 text-zinc-300"
                            }`}
                          >
                            <span
                              className={`mr-0.5 rounded-sm px-0.5 text-[10px] leading-none ${
                                hit
                                  ? "bg-emerald-950/20 text-emerald-950"
                                  : "bg-sky-500/25 text-sky-300"
                              }`}
                            >
                              游
                            </span>
                            {workTitle(g)}
                          </span>
                        );
                      })}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {tip && (
        <div
          ref={tipRef}
          role="tooltip"
          className={`fixed z-50 max-w-xs -translate-x-1/2 -translate-y-full rounded-md bg-zinc-800 px-2.5 py-1.5 text-center text-xs leading-relaxed whitespace-pre-line text-zinc-100 shadow-lg ${
            tip.locked
              ? "tooltip-ignite cursor-text select-text"
              : "pointer-events-none ring-1 ring-zinc-600"
          }`}
          style={{ left: tip.x, top: tip.y - 6 }}
        >
          {tip.text}
        </div>
      )}
    </div>
  );
}
