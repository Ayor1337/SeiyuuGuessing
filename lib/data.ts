import webRaw from "../data/web-seiyuu.json";

export interface Work {
  id: number;
  title_native: string | null;
  title_romaji: string | null;
  title_zh: string | null;
  year: number | null;
  format: string | null;
  popularity: number | null;
  /** 系列簇 id，同系列作品相同（无系列时等于自身 id） */
  series_id: number;
}

export interface Seiyuu {
  id: number;
  name_romaji: string | null;
  name_native: string | null;
  name_zh: string | null;
  gender: string | null;
  birth_year: number | null;
  home_town: string | null;
  blood_type: string | null;
  debut_year: number | null;
  favourites: number;
  image: string | null;
  url: string | null;
  /** 热门作品，按人气降序 */
  works: Work[];
}

interface WebData {
  generated_at: string;
  seiyuu: Seiyuu[];
}

const raw = (webRaw as unknown as WebData).seiyuu;

export interface SeiyuuWithDisplay extends Seiyuu {
  /** 展示名：优先简体中文，其次日文原名，最后罗马音 */
  display: string;
}

export const seiyuuList: SeiyuuWithDisplay[] = raw.map((s) => ({
  ...s,
  display: s.name_zh ?? s.name_native ?? s.name_romaji ?? `#${s.id}`,
}));

export const seiyuuById = new Map(seiyuuList.map((s) => [s.id, s]));

/** 答案池：作品数过少或关键属性缺失的声优不适合出题（按人气降序） */
export const answerPool = seiyuuList.filter(
  (s) => s.works.length >= 3 && s.gender && s.birth_year
);

export type Difficulty = "easy" | "normal" | "hard";

export interface DifficultyOption {
  key: Difficulty;
  label: string;
  desc: string;
  /** 取人气前 N 名作为答案池，Infinity 表示全池 */
  size: number;
}

export const DIFFICULTY_OPTIONS: DifficultyOption[] = [
  { key: "easy", label: "简单", desc: "人气前 100，都是熟面孔", size: 100 },
  { key: "normal", label: "普通", desc: "人气前 250，需要点阅历", size: 250 },
  { key: "hard", label: "困难", desc: "全题库，冷门声优出没", size: Infinity },
];

export type GenderFilter = "all" | "Male" | "Female";

export interface GenderOption {
  key: GenderFilter;
  label: string;
}

export const GENDER_OPTIONS: GenderOption[] = [
  { key: "all", label: "不限" },
  { key: "Male", label: "只看男性" },
  { key: "Female", label: "只看女性" },
];

export function poolFor(
  difficulty: Difficulty,
  gender: GenderFilter = "all"
): SeiyuuWithDisplay[] {
  const opt = DIFFICULTY_OPTIONS.find((o) => o.key === difficulty)!;
  const pool = answerPool.slice(0, opt.size);
  return gender === "all" ? pool : pool.filter((s) => s.gender === gender);
}

/** 作品展示名：优先简体中文，其次日文原名，最后罗马音 */
export function workTitle(w: Work): string {
  return w.title_zh ?? w.title_native ?? w.title_romaji ?? "";
}

/** 性别中文化 */
export function genderZh(gender: string | null): string {
  if (gender === "Male") return "男";
  if (gender === "Female") return "女";
  return gender ?? "?";
}

/**
 * home_town 形如 "Sakai, Osaka Prefecture, Japan"，
 * 取倒数第二段（都道府县）并去掉 " Prefecture" 后缀，用于紧凑展示与比对
 */
export function prefectureOf(homeTown: string | null): string | null {
  if (!homeTown) return null;
  const parts = homeTown.split(",").map((p) => p.trim());
  const seg = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
  return seg.replace(/\s+Prefecture$/i, "");
}
