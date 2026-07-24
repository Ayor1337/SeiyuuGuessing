import { useState } from "react";
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
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  const closeTip = () => setTip(null);
  function openTip(e: React.MouseEvent<HTMLElement>, text: string | null) {
    if (!showCharacters || !text) return;
    const r = e.currentTarget.getBoundingClientRect();
    setTip({ text, x: r.left + r.width / 2, y: r.top });
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
                          onMouseLeave={closeTip}
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
                            onMouseLeave={closeTip}
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
          role="tooltip"
          className="pointer-events-none fixed z-50 max-w-xs -translate-x-1/2 -translate-y-full rounded-md bg-zinc-800 px-2.5 py-1.5 text-center text-xs leading-relaxed whitespace-pre-line text-zinc-100 shadow-lg ring-1 ring-zinc-600"
          style={{ left: tip.x, top: tip.y - 6 }}
        >
          {tip.text}
        </div>
      )}
    </div>
  );
}
