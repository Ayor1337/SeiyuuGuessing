import { genderZh, prefectureOf, workTitle } from "@/lib/data";
import type { FieldResult, GuessResult } from "@/lib/game";

// 表格单元格的状态样式：浅色底 + 彩色文字，不再是卡片
const td = {
  green: "bg-emerald-500/15 text-emerald-400",
  yellow: "bg-amber-500/15 text-amber-300",
  gray: "text-zinc-300",
};

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

export default function GuessTable({ results }: { results: GuessResult[] }) {
  if (results.length === 0) return null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-zinc-100">
        <thead>
          <tr className="border-b border-zinc-700 text-xs text-zinc-400">
            <th className="px-3 py-2 text-left font-medium">声优</th>
            <th className="px-3 py-2 font-medium">性别</th>
            <th className="px-3 py-2 font-medium">出生年份</th>
            <th className="px-3 py-2 font-medium">出身地</th>
            <th className="px-3 py-2 font-medium">血型</th>
            <th className="px-3 py-2 font-medium">出道年份</th>
            <th className="w-[38%] px-3 py-2 text-left font-medium">热门作品</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800">
          {results.map((r) => {
            const s = r.seiyuu;
            const sharedIds = new Set(r.sharedWorks.map((x) => x.id));
            const relatedIds = new Set(r.relatedWorks.map((x) => x.id));
            // 命中/同系列的词条提到最前，格内只保留词条级高亮
            const displayWorks = [...s.works].sort((a, b) => {
              const rank = (w: typeof a) =>
                sharedIds.has(w.id) ? 0 : relatedIds.has(w.id) ? 1 : 2;
              return rank(a) - rank(b);
            });
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
                    {displayWorks.slice(0, 8).map((w) => (
                      <span
                        key={w.id}
                        title={w.year ? `${w.year} 年` : undefined}
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
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
