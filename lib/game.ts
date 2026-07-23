import { prefectureOf, type GameWork, type SeiyuuWithDisplay as Seiyuu, type Work, type WorksFilter } from "./data";

export type CellStatus = "green" | "yellow" | "gray";

export interface FieldResult {
  status: CellStatus;
  /** 'up' 表示答案的值更大（应往上猜），'down' 表示更小 */
  arrow?: "up" | "down";
}

export interface GuessResult {
  seiyuu: Seiyuu;
  gender: FieldResult;
  birthYear: FieldResult;
  homeTown: FieldResult;
  bloodType: FieldResult;
  debutYear: FieldResult;
  /** 与答案共同出演的动画（按 anime_id 求交集），绿色 */
  sharedWorks: Work[];
  /** 与答案同系列但不同作品（series_id 相同、anime_id 不同），黄色 */
  relatedWorks: Work[];
  /** 与答案共同出演的游戏（bgm id 空间，与动画分开比对），绿色 */
  sharedGameWorks: GameWork[];
}

function exact(a: string | null, b: string | null): FieldResult {
  if (!a || !b) return { status: "gray" };
  return { status: a.toLowerCase() === b.toLowerCase() ? "green" : "gray" };
}

function year(a: number | null, b: number | null): FieldResult {
  if (a == null || b == null) return { status: "gray" };
  if (a === b) return { status: "green" };
  const arrow = b > a ? ("up" as const) : ("down" as const);
  return Math.abs(a - b) <= 2 ? { status: "yellow", arrow } : { status: "gray", arrow };
}

function homeTown(a: string | null, b: string | null): FieldResult {
  if (!a || !b) return { status: "gray" };
  if (a.toLowerCase() === b.toLowerCase()) return { status: "green" };
  const pa = prefectureOf(a)?.toLowerCase();
  const pb = prefectureOf(b)?.toLowerCase();
  return pa && pa === pb ? { status: "yellow" } : { status: "gray" };
}

export function compare(
  guess: Seiyuu,
  answer: Seiyuu,
  works: WorksFilter = "all"
): GuessResult {
  const answerWorkIds = new Set(answer.works.map((w) => w.id));
  const answerSeriesIds = new Set(answer.works.map((w) => w.series_id));
  const sharedWorks = guess.works.filter((w) => answerWorkIds.has(w.id));
  const sharedIds = new Set(sharedWorks.map((w) => w.id));
  // 游戏与动画是两个 id 空间（bgm.tv / AniList），各自独立求交集
  const answerGameIds = new Set(answer.game_works.map((w) => w.id));
  return {
    seiyuu: guess,
    gender: exact(guess.gender, answer.gender),
    birthYear: year(guess.birth_year, answer.birth_year),
    homeTown: homeTown(guess.home_town, answer.home_town),
    bloodType: exact(guess.blood_type, answer.blood_type),
    debutYear: year(guess.debut_year, answer.debut_year),
    // 作品范围只提示对应类型：仅动画屏蔽游戏命中，仅游戏屏蔽动画命中与同系列
    sharedWorks: works === "game" ? [] : sharedWorks,
    relatedWorks:
      works === "game"
        ? []
        : guess.works.filter(
            (w) => !sharedIds.has(w.id) && answerSeriesIds.has(w.series_id)
          ),
    sharedGameWorks:
      works === "anime"
        ? []
        : guess.game_works.filter((w) => answerGameIds.has(w.id)),
  };
}
