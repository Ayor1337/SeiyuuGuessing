"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  answerPool,
  DEFAULT_SETTINGS,
  DIFFICULTY_OPTIONS,
  GAME_STORAGE_KEY,
  GENDER_OPTIONS,
  SETTINGS_STORAGE_KEY,
  WORKS_OPTIONS,
  parseSettings,
  poolFor,
  type Difficulty,
  type GenderFilter,
  type WorksFilter,
} from "@/lib/data";

const LIMIT_OPTIONS = [
  { label: "5 次", value: 5 },
  { label: "8 次", value: 8 },
  { label: "12 次", value: 12 },
  { label: "不限", value: 0 },
];

// 原生 radio 组：Tab 进入、方向键切换、焦点框可见
const focusRing =
  "peer-focus-visible:ring-2 peer-focus-visible:ring-emerald-400 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-zinc-950";

// 门面头像墙：人气前 18 名声优（纯装饰，熟面孔营造氛围；固定取前 18 避免 hydration 不一致）
const heroAvatars = answerPool.filter((s) => s.image).slice(0, 18);

/** 作品范围/性别/次数通用的分段药丸控件：选中项实心，未选无框（去卡片化） */
function Segmented<T extends string | number>({
  legend,
  name,
  options,
  value,
  onChange,
}: {
  legend: string;
  name: string;
  options: { label: string; value: T }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <fieldset>
      <legend className="mx-auto mb-2 px-2 text-xs text-zinc-500">{legend}</legend>
      <div className="flex rounded-full border border-zinc-800 bg-zinc-900/60 p-1">
        {options.map((o) => {
          const active = value === o.value;
          return (
            <label key={o.value} className="flex-1 cursor-pointer">
              <input
                type="radio"
                name={name}
                value={o.value}
                checked={active}
                onChange={() => onChange(o.value)}
                className="peer sr-only"
              />
              <div
                className={`rounded-full py-1.5 text-center text-sm whitespace-nowrap transition-colors ${focusRing} ${
                  active
                    ? "bg-emerald-600 font-medium text-white"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {o.label}
              </div>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export default function Home() {
  const router = useRouter();
  const [difficulty, setDifficulty] = useState<Difficulty>(DEFAULT_SETTINGS.difficulty);
  const [limit, setLimit] = useState(DEFAULT_SETTINGS.limit);
  const [gender, setGender] = useState<GenderFilter>(DEFAULT_SETTINGS.gender);
  const [works, setWorks] = useState<WorksFilter>(DEFAULT_SETTINGS.works);

  // 挂载时回填上次选择（「开始游戏」写入 localStorage 的设置）
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (raw) {
        const s = parseSettings(JSON.parse(raw));
        setDifficulty(s.difficulty);
        setLimit(s.limit);
        setGender(s.gender);
        setWorks(s.works);
      }
    } catch {
      /* 损坏则用默认 */
    }
  }, []);

  // 设置经 localStorage 传递（/play 的 URL 保持干净）；清掉旧存档保证开新局
  function startGame() {
    localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ difficulty, limit, gender, works })
    );
    localStorage.removeItem(GAME_STORAGE_KEY);
    router.push("/play");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col items-center justify-center px-4 py-16">
      {/* 头像墙：错位两排，两端渐隐裁切 */}
      <div
        aria-hidden
        className="mb-10 w-full max-w-3xl space-y-3 overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_15%,black_85%,transparent)]"
      >
        <div className="flex justify-center">
          <div className="flex w-max gap-3">
            {heroAvatars.slice(0, 9).map((s) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={s.id}
                src={s.image!}
                alt=""
                loading="lazy"
                className="h-14 w-14 rounded-full object-cover opacity-75 grayscale-[35%]"
              />
            ))}
          </div>
        </div>
        <div className="flex justify-center">
          <div className="flex w-max gap-3 pl-16">
            {heroAvatars.slice(9, 18).map((s) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={s.id}
                src={s.image!}
                alt=""
                loading="lazy"
                className="h-14 w-14 rounded-full object-cover opacity-75 grayscale-[35%]"
              />
            ))}
          </div>
        </div>
      </div>

      <h1 className="mb-3 text-6xl font-black tracking-widest md:text-7xl">
        声優
        <span className="bg-gradient-to-br from-emerald-300 to-sky-400 bg-clip-text text-transparent">
          クイズ
        </span>
      </h1>
      <p className="mb-12 text-center text-sm text-zinc-400 md:text-base">
        根据线索猜出神秘声优 —— 性别、出身、年份，以及 TA 配过的热门作品
      </p>

      {/* 难度：tab 式文字按钮（去卡片），选中项高亮 + 底部指示条 */}
      <fieldset className="mb-10">
        <legend className="mx-auto mb-3 px-2 text-xs text-zinc-500">选择难度</legend>
        <div className="flex justify-center gap-2 sm:gap-6">
          {DIFFICULTY_OPTIONS.map((o) => {
            const active = difficulty === o.key;
            return (
              <label key={o.key} className="group cursor-pointer">
                <input
                  type="radio"
                  name="difficulty"
                  value={o.key}
                  checked={active}
                  onChange={() => setDifficulty(o.key)}
                  className="peer sr-only"
                />
                <div
                  className={`rounded-lg px-4 py-2 text-center transition-colors sm:px-6 ${focusRing} ${
                    active
                      ? "text-emerald-400"
                      : "text-zinc-500 group-hover:bg-zinc-900 group-hover:text-zinc-200"
                  }`}
                >
                  <div className="text-2xl font-black tracking-wide">{o.label}</div>
                  <div className="mt-1 text-xs">{o.desc}</div>
                  <div className="mt-0.5 text-xs opacity-70">
                    答案池 {poolFor(o.key, gender, works).length} 人
                  </div>
                </div>
                <div
                  className={`mx-4 mt-1.5 h-0.5 rounded-full transition-colors ${
                    active ? "bg-emerald-400" : "bg-transparent group-hover:bg-zinc-700"
                  }`}
                />
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="mb-12 grid w-full max-w-3xl gap-x-8 gap-y-6 md:grid-cols-3">
        <Segmented
          legend="作品范围"
          name="works"
          options={WORKS_OPTIONS.map((o) => ({ label: o.label, value: o.key }))}
          value={works}
          onChange={setWorks}
        />
        <Segmented
          legend="性别范围"
          name="gender"
          options={GENDER_OPTIONS.map((o) => ({ label: o.label, value: o.key }))}
          value={gender}
          onChange={setGender}
        />
        <Segmented
          legend="猜测次数"
          name="limit"
          options={LIMIT_OPTIONS.map((o) => ({ label: o.label, value: o.value }))}
          value={limit}
          onChange={setLimit}
        />
      </div>

      <button
        onClick={startGame}
        className="w-full max-w-md cursor-pointer rounded-full bg-emerald-500 py-4 text-center text-lg font-black tracking-widest text-zinc-950 shadow-lg shadow-emerald-500/25 transition hover:bg-emerald-400 hover:shadow-emerald-400/40 focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 focus-visible:outline-none"
      >
        开始游戏
      </button>
      <p className="mt-5 text-xs text-zinc-500">
        键盘操作：Tab 移动焦点，← → 切换选项，Enter 确认
      </p>
      <p className="mt-2 text-xs text-zinc-600">
        题库 500 名声优 · 数据来自 AniList 与 bgm.tv
      </p>
    </main>
  );
}
