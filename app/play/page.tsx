import GameBoard from "@/components/GameBoard";
import type { Difficulty, GenderFilter, WorksFilter } from "@/lib/data";

const VALID_DIFFICULTY = new Set(["easy", "normal", "hard"]);
const VALID_LIMIT = new Set([5, 8, 12, 0]);
const VALID_GENDER = new Set(["all", "Male", "Female"]);
const VALID_WORKS = new Set(["all", "anime", "game"]);

export default async function PlayPage({
  searchParams,
}: {
  searchParams: Promise<{ d?: string; limit?: string; g?: string; w?: string }>;
}) {
  const { d, limit, g, w } = await searchParams;
  const difficulty = (
    VALID_DIFFICULTY.has(d ?? "") ? d : "easy"
  ) as Difficulty;
  const n = Number(limit);
  const guessLimit = VALID_LIMIT.has(n) ? n : 8;
  const gender = (VALID_GENDER.has(g ?? "") ? g : "all") as GenderFilter;
  const works = (VALID_WORKS.has(w ?? "") ? w : "all") as WorksFilter;

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <h1 className="mb-1 text-center text-3xl font-bold">声优猜谜</h1>
      <p className="mb-6 text-center text-sm text-zinc-400">
        输入声优名字开始猜测 · 绿色 = 命中，黄色 = 接近，箭头提示方向
      </p>
      {/* key 强制换难度/次数/性别/作品范围时重开一局 */}
      <GameBoard
        key={`${difficulty}-${guessLimit}-${gender}-${works}`}
        difficulty={difficulty}
        limit={guessLimit}
        gender={gender}
        works={works}
      />
    </main>
  );
}
