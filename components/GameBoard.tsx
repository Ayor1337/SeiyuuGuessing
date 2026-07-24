"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  poolFor,
  seiyuuById,
  workTitle,
  DEFAULT_SETTINGS,
  DIFFICULTY_OPTIONS,
  GAME_STORAGE_KEY,
  GENDER_OPTIONS,
  SETTINGS_STORAGE_KEY,
  WORKS_OPTIONS,
  parseSettings,
  type GameSettings,
  type SeiyuuWithDisplay,
} from "@/lib/data";
import { compare, type GuessResult } from "@/lib/game";
import GuessInput from "./GuessInput";
import GuessTable from "./GuessTable";

type Status = "playing" | "won" | "lost" | "gaveUp";

// 玩法规则图例的示例格样式（与结果单元格同色系；灰色给个浅底让色块可见）
const demoCell = {
  green: "bg-emerald-500/15 text-emerald-400",
  yellow: "bg-amber-500/15 text-amber-300",
  gray: "bg-zinc-800 text-zinc-400",
};

/** 规则图例的一项：字段名 + 示例色块 + 说明（抽象色块，不用真实表格行，避免误认成对局记录） */
function RuleItem({
  label,
  demo,
  note,
  className = "w-28",
}: {
  label: string;
  demo: React.ReactNode;
  note: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="mt-1.5 flex justify-center">{demo}</div>
      <div className="mt-1 text-xs leading-5 text-zinc-500">{note}</div>
    </div>
  );
}

interface SaveState extends GameSettings {
  answerId: number;
  guesses: number[];
  status: Status;
}

export default function GameBoard() {
  const [settings, setSettings] = useState<GameSettings | null>(null);
  const [state, setState] = useState<SaveState | null>(null);

  const pool = useMemo(
    () =>
      settings ? poolFor(settings.difficulty, settings.gender, settings.works) : [],
    [settings]
  );

  // 客户端初始化：读设置（主页「开始游戏」写入；直接访问 /play 用上次设置或默认），
  // 存档设置一致则恢复，否则开新局。设置只在主页变更，故只需挂载时读一次
  useEffect(() => {
    let s = DEFAULT_SETTINGS;
    try {
      const rawSettings = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (rawSettings) s = parseSettings(JSON.parse(rawSettings));
    } catch {
      /* 设置损坏用默认 */
    }
    setSettings(s);
    const pool = poolFor(s.difficulty, s.gender, s.works);
    const newGame: SaveState = {
      answerId: pool[Math.floor(Math.random() * pool.length)].id,
      guesses: [],
      ...s,
      status: "playing",
    };
    try {
      const raw = localStorage.getItem(GAME_STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as SaveState;
        if (
          saved.difficulty === s.difficulty &&
          saved.limit === s.limit &&
          saved.gender === s.gender &&
          saved.works === s.works &&
          pool.some((p) => p.id === saved.answerId)
        ) {
          setState({
            ...saved,
            guesses: saved.guesses.filter((id) => seiyuuById.has(id)),
          });
          return;
        }
      }
    } catch {
      /* 存档损坏则开新局 */
    }
    setState(newGame);
  }, []);

  useEffect(() => {
    if (state) localStorage.setItem(GAME_STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  if (!settings || !state) {
    return <p className="text-center text-zinc-500">加载中…</p>;
  }

  const { difficulty, limit, gender, works, showCharacters } = settings;
  const answer = seiyuuById.get(state.answerId)!;

  const difficultyLabel = DIFFICULTY_OPTIONS.find((o) => o.key === difficulty)?.label;
  const genderLabel = GENDER_OPTIONS.find((o) => o.key === gender)?.label;
  const worksLabel = WORKS_OPTIONS.find((o) => o.key === works)?.label;

  function newGame(): SaveState {
    return {
      answerId: pool[Math.floor(Math.random() * pool.length)].id,
      guesses: [],
      difficulty,
      limit,
      gender,
      works,
      showCharacters,
      status: "playing",
    };
  }

  // 最新猜测置顶
  const results: GuessResult[] = state.guesses
    .map((id) => compare(seiyuuById.get(id)!, answer, works))
    .reverse();

  const over = state.status !== "playing";
  const remaining = state.limit > 0 ? state.limit - state.guesses.length : null;

  function guess(s: SeiyuuWithDisplay) {
    setState((prev) => {
      if (!prev || prev.status !== "playing" || prev.guesses.includes(s.id)) return prev;
      const guesses = [...prev.guesses, s.id];
      let status: Status = "playing";
      if (s.id === prev.answerId) status = "won";
      else if (prev.limit > 0 && guesses.length >= prev.limit) status = "lost";
      return { ...prev, guesses, status };
    });
  }

  return (
    <div className="space-y-6">
      {/* 顶栏：左返回 / 中品牌 / 右操作，纯文字样式避免信息过载 */}
      <div className="flex items-center text-sm">
        <div className="flex-1">
          <Link
            href="/"
            className="text-zinc-400 transition-colors hover:text-zinc-100"
          >
            ← 返回主页
          </Link>
        </div>
        <span className="text-lg font-black tracking-widest">
          声優<span className="text-emerald-400">クイズ</span>
        </span>
        <div className="flex flex-1 justify-end gap-4">
          {!over && (
            <button
              onClick={() => setState({ ...state, status: "gaveUp" })}
              className="text-zinc-400 transition-colors hover:text-red-400"
            >
              认输
            </button>
          )}
          <button
            onClick={() => setState(newGame())}
            className="text-zinc-400 transition-colors hover:text-zinc-100"
          >
            再来一局
          </button>
        </div>
      </div>

      <GuessInput
        guessedIds={new Set(state.guesses)}
        disabled={over}
        gender={gender}
        onGuess={guess}
      />

      {/* 对局信息：设置摘要小字 + 猜测进度圆点（限次模式） */}
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-zinc-500">
        <span>
          {difficultyLabel}
          {gender !== "all" && ` · ${genderLabel}`}
          {works !== "all" && ` · ${worksLabel}`} · 答案池 {pool.length} 人
        </span>
        <span className="text-zinc-700">|</span>
        {remaining !== null ? (
          <span
            className="flex items-center gap-1.5"
            title={`已猜 ${state.guesses.length} / ${state.limit} 次`}
          >
            {Array.from({ length: state.limit }, (_, i) => (
              <span
                key={i}
                className={`h-1.5 w-1.5 rounded-full ${
                  i < state.guesses.length ? "bg-emerald-400" : "bg-zinc-700"
                }`}
              />
            ))}
            <span className="ml-1">
              {state.guesses.length}/{state.limit}
            </span>
          </span>
        ) : (
          <span>已猜 {state.guesses.length} 次</span>
        )}
      </div>

      {!over && state.guesses.length === 0 && (
        <div className="space-y-4 pt-2 text-center">
          <div>
            <h2 className="text-lg font-bold text-zinc-100">玩法规则</h2>
            <p className="mt-1 text-sm text-zinc-500">
              每次猜测会与答案对比六类线索，颜色提示接近程度
            </p>
          </div>
          <div className="flex flex-wrap items-start justify-center gap-x-6 gap-y-4">
            <RuleItem
              label="性别"
              note="完全一致为绿色"
              demo={
                <span className={`rounded px-2.5 py-1 text-sm ${demoCell.green}`}>女</span>
              }
            />
            <RuleItem
              label="出生年份"
              note="相差 ±2 为黄色，▲▼ 提示方向"
              demo={
                <span className={`rounded px-2.5 py-1 text-sm ${demoCell.yellow}`}>1989 ▼</span>
              }
            />
            <RuleItem
              label="出身地"
              note="同都道府县为黄色"
              demo={
                <span className={`rounded px-2.5 py-1 text-sm ${demoCell.yellow}`}>Osaka</span>
              }
            />
            <RuleItem
              label="血型"
              note="不匹配为灰色"
              demo={
                <span className={`rounded px-2.5 py-1 text-sm ${demoCell.gray}`}>AB</span>
              }
            />
            <RuleItem
              label="出道年份"
              note="完全一致为绿色"
              demo={
                <span className={`rounded px-2.5 py-1 text-sm ${demoCell.green}`}>2003</span>
              }
            />
            <RuleItem
              label="作品词条"
              note={
                works === "game"
                  ? "亮绿 = 共同出演，无同系列"
                  : "亮绿 = 共同出演，亮黄 = 同系列"
              }
              className="w-52"
              demo={
                <span className="flex gap-1 whitespace-nowrap">
                  <span className="rounded bg-emerald-400 px-1.5 py-0.5 text-xs font-medium text-emerald-950">
                    共同出演
                  </span>
                  {works !== "game" && (
                    <span className="rounded bg-amber-300 px-1.5 py-0.5 text-xs font-medium text-amber-950">
                      同系列
                    </span>
                  )}
                  {works !== "anime" && (
                    <span className="rounded bg-zinc-700 px-1.5 py-0.5 text-xs text-zinc-300">
                      <span className="mr-0.5 rounded-sm bg-sky-500/25 px-0.5 text-[10px] leading-none text-sky-300">游</span>
                      游戏
                    </span>
                  )}
                </span>
              }
            />
          </div>
          <p className="text-xs text-zinc-600">
            命中的作品词条会自动排到最前，次数用完后揭晓答案
          </p>
        </div>
      )}

      {over && (
        <div className="mx-auto max-w-lg rounded-lg border border-zinc-700 bg-zinc-900 p-5 text-center">
          {state.status === "won" ? (
            <p className="text-lg font-bold text-emerald-400">
              猜对了！答案就是 {answer.display}
            </p>
          ) : (
            <p className="text-lg font-bold text-red-400">
              {state.status === "lost" ? "次数用完，" : ""}答案是 {answer.display}
            </p>
          )}
          <div className="mt-3 flex items-center justify-center gap-3 text-sm text-zinc-400">
            {answer.image && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={answer.image} alt={answer.display} className="h-16 w-16 rounded object-cover" />
            )}
            <div className="text-left">
              <div>{answer.name_native}</div>
              <div>{answer.name_romaji}</div>
              <div className="mt-1 text-xs text-zinc-500">
                {[
                  ...(works === "game" ? [] : answer.works.map((w) => workTitle(w))),
                  ...(works === "anime"
                    ? []
                    : answer.game_works.map((g) =>
                        works === "game" ? workTitle(g) : `${workTitle(g)}（游）`
                      )),
                ]
                  .slice(0, 3)
                  .join("、")}
              </div>
              {answer.url && (
                <a
                  href={answer.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-emerald-400 underline"
                >
                  AniList 页面
                </a>
              )}
            </div>
          </div>
          {/* 结束后的快捷操作：沿用当前设置重开，或回主页调整设置 */}
          <div className="mt-4 flex justify-center gap-3">
            <button
              onClick={() => setState(newGame())}
              className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-emerald-950 transition-colors hover:bg-emerald-400"
            >
              再来一局
            </button>
            <Link
              href="/"
              className="rounded-md border border-zinc-600 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-400 hover:text-zinc-100"
            >
              回到主菜单
            </Link>
          </div>
        </div>
      )}

      <GuessTable results={results} works={works} showCharacters={showCharacters} />
    </div>
  );
}
