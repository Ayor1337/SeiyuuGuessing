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
  /** 该声优在本作配音的角色名（已解析展示名，最多 3 个；无数据时缺省） */
  characters?: string[];
}

/**
 * 游戏作品（bgm.tv 数据源）。与动画分开存放：id 是 bgm.tv subject id，
 * 与 Work.id（AniList media id）属不同 id 空间，不可混用比对。
 * popularity 是 bgm 评分人数；series_id 预留（暂无游戏系列聚类，等于自身 id）
 */
export interface GameWork {
  id: number;
  title_native: string | null;
  title_zh: string | null;
  year: number | null;
  popularity: number | null;
  series_id: number;
  /** 该声优在本作配音的角色名（bgm 原名多为日文，最多 3 个；无数据时缺省） */
  characters?: string[];
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
  /** 热门动画作品，按人气降序 */
  works: Work[];
  /** 热门游戏作品（bgm.tv），按 bgm 评分人数降序 */
  game_works: GameWork[];
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

/** 作品范围（开局可选）：不限（动画+游戏）/ 仅动画 / 仅游戏 */
export type WorksFilter = "all" | "anime" | "game";

export interface WorksOption {
  key: WorksFilter;
  label: string;
}

export const WORKS_OPTIONS: WorksOption[] = [
  { key: "all", label: "全部" },
  { key: "anime", label: "仅动画" },
  { key: "game", label: "仅游戏" },
];

/** 作品数门槛：保证出题质量（仅动画看动画、仅游戏看游戏、不限看合计） */
function hasEnoughWorks(s: SeiyuuWithDisplay, works: WorksFilter): boolean {
  if (works === "anime") return s.works.length >= 3;
  if (works === "game") return s.game_works.length >= 3;
  return s.works.length + s.game_works.length >= 3;
}

/** 不限模式下的全量答案池（按人气降序） */
export const answerPool = seiyuuList.filter(
  (s) => hasEnoughWorks(s, "all") && s.gender && s.birth_year
);

/** 开局设置：主页选择后经 localStorage 传给 /play（URL 保持干净不带参数） */
export interface GameSettings {
  difficulty: Difficulty;
  limit: number;
  gender: GenderFilter;
  works: WorksFilter;
  /** 悬浮作品词条时显示该声优配音的角色（仅展示，不影响对局逻辑） */
  showCharacters: boolean;
}

export const DEFAULT_SETTINGS: GameSettings = {
  difficulty: "normal",
  limit: 8,
  gender: "all",
  works: "all",
  showCharacters: true,
};

/** localStorage 键：开局设置（主页「开始游戏」写入，/play 读取；也用于主页记住上次选择） */
export const SETTINGS_STORAGE_KEY = "seiyuu-settings-v1";
/** localStorage 键：对局存档（GameBoard 读写；结构变更时递增版本号） */
export const GAME_STORAGE_KEY = "seiyuu-game-v5";

const VALID_DIFFICULTY = new Set<string>(["easy", "normal", "hard"]);
const VALID_LIMIT = new Set<number>([5, 8, 12, 0]);
const VALID_GENDER = new Set<string>(["all", "Male", "Female"]);
const VALID_WORKS = new Set<string>(["all", "anime", "game"]);

/** 把未知来源的数据（localStorage JSON）清洗为合法开局设置，非法字段回退默认 */
export function parseSettings(raw: unknown): GameSettings {
  const p = (raw ?? {}) as Partial<GameSettings>;
  return {
    difficulty: VALID_DIFFICULTY.has(p.difficulty as string)
      ? (p.difficulty as Difficulty)
      : DEFAULT_SETTINGS.difficulty,
    limit: VALID_LIMIT.has(p.limit as number)
      ? (p.limit as number)
      : DEFAULT_SETTINGS.limit,
    gender: VALID_GENDER.has(p.gender as string)
      ? (p.gender as GenderFilter)
      : DEFAULT_SETTINGS.gender,
    works: VALID_WORKS.has(p.works as string)
      ? (p.works as WorksFilter)
      : DEFAULT_SETTINGS.works,
    showCharacters:
      typeof p.showCharacters === "boolean"
        ? p.showCharacters
        : DEFAULT_SETTINGS.showCharacters,
  };
}

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
  gender: GenderFilter = "all",
  works: WorksFilter = "all"
): SeiyuuWithDisplay[] {
  const opt = DIFFICULTY_OPTIONS.find((o) => o.key === difficulty)!;
  // 先按作品范围过滤（seiyuuList 按人气降序），再截难度名额，保证各模式人数达标
  const eligible = seiyuuList.filter(
    (s) => hasEnoughWorks(s, works) && s.gender && s.birth_year
  );
  const pool = eligible.slice(0, opt.size);
  return gender === "all" ? pool : pool.filter((s) => s.gender === gender);
}

/** 作品展示名：优先简体中文，其次日文原名，最后罗马音（动画/游戏通用） */
export function workTitle(w: {
  title_zh: string | null;
  title_native: string | null;
  title_romaji?: string | null;
}): string {
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
