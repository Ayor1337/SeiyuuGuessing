"use client";

import { useState } from "react";
import Link from "next/link";
import {
  DIFFICULTY_OPTIONS,
  GENDER_OPTIONS,
  WORKS_OPTIONS,
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

export default function Home() {
  const [difficulty, setDifficulty] = useState<Difficulty>("normal");
  const [limit, setLimit] = useState(8);
  const [gender, setGender] = useState<GenderFilter>("all");
  const [works, setWorks] = useState<WorksFilter>("all");

  return (
    <main className="mx-auto flex min-h-[85vh] max-w-2xl flex-col items-center justify-center px-4 py-10">
      <h1 className="mb-2 text-4xl font-bold">声优猜谜</h1>
      <p className="mb-10 text-center text-sm text-zinc-400">
        根据线索猜出神秘声优 —— 性别、出身、年份，以及 TA 配过的热门作品
      </p>

      <fieldset className="mb-6 w-full">
        <legend className="mb-3 text-sm font-medium text-zinc-300">选择难度</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          {DIFFICULTY_OPTIONS.map((o) => {
            const active = difficulty === o.key;
            return (
              <label key={o.key} className="cursor-pointer">
                <input
                  type="radio"
                  name="difficulty"
                  value={o.key}
                  checked={active}
                  onChange={() => setDifficulty(o.key)}
                  className="peer sr-only"
                />
                <div
                  className={`h-full rounded-lg border p-4 transition-colors ${focusRing} ${
                    active
                      ? "border-emerald-500 bg-emerald-600/20"
                      : "border-zinc-700 bg-zinc-900 hover:border-zinc-500"
                  }`}
                >
                  <div className={`font-bold ${active ? "text-emerald-400" : ""}`}>
                    {o.label}
                  </div>
                  <div className="mt-1 text-xs text-zinc-400">{o.desc}</div>
                  <div className="mt-2 text-xs text-zinc-500">
                    答案池 {poolFor(o.key, gender, works).length} 人
                  </div>
                </div>
              </label>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="mb-6 w-full">
        <legend className="mb-3 text-sm font-medium text-zinc-300">作品范围</legend>
        <div className="flex gap-2">
          {WORKS_OPTIONS.map((o) => {
            const active = works === o.key;
            return (
              <label key={o.key} className="flex-1 cursor-pointer">
                <input
                  type="radio"
                  name="works"
                  value={o.key}
                  checked={active}
                  onChange={() => setWorks(o.key)}
                  className="peer sr-only"
                />
                <div
                  className={`rounded-lg border px-3 py-2 text-center text-sm transition-colors ${focusRing} ${
                    active
                      ? "border-emerald-500 bg-emerald-600/20 text-emerald-400"
                      : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500"
                  }`}
                >
                  {o.label}
                </div>
              </label>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="mb-6 w-full">
        <legend className="mb-3 text-sm font-medium text-zinc-300">性别范围</legend>
        <div className="flex gap-2">
          {GENDER_OPTIONS.map((o) => {
            const active = gender === o.key;
            return (
              <label key={o.key} className="flex-1 cursor-pointer">
                <input
                  type="radio"
                  name="gender"
                  value={o.key}
                  checked={active}
                  onChange={() => setGender(o.key)}
                  className="peer sr-only"
                />
                <div
                  className={`rounded-lg border px-3 py-2 text-center text-sm transition-colors ${focusRing} ${
                    active
                      ? "border-emerald-500 bg-emerald-600/20 text-emerald-400"
                      : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500"
                  }`}
                >
                  {o.label}
                </div>
              </label>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="mb-10 w-full">
        <legend className="mb-3 text-sm font-medium text-zinc-300">猜测次数</legend>
        <div className="flex gap-2">
          {LIMIT_OPTIONS.map((o) => {
            const active = limit === o.value;
            return (
              <label key={o.value} className="flex-1 cursor-pointer">
                <input
                  type="radio"
                  name="limit"
                  value={o.value}
                  checked={active}
                  onChange={() => setLimit(o.value)}
                  className="peer sr-only"
                />
                <div
                  className={`rounded-lg border px-3 py-2 text-center text-sm transition-colors ${focusRing} ${
                    active
                      ? "border-emerald-500 bg-emerald-600/20 text-emerald-400"
                      : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500"
                  }`}
                >
                  {o.label}
                </div>
              </label>
            );
          })}
        </div>
      </fieldset>

      <Link
        href={`/play?d=${difficulty}&limit=${limit}&g=${gender}&w=${works}`}
        className="w-full rounded-lg bg-emerald-600 py-3 text-center text-lg font-bold text-white transition-colors hover:bg-emerald-500 focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 focus-visible:outline-none"
      >
        开始游戏
      </Link>
      <p className="mt-4 text-xs text-zinc-500">
        键盘操作：Tab 移动焦点，← → 切换选项，Enter 确认
      </p>
    </main>
  );
}
