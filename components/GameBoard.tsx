"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  poolFor,
  seiyuuById,
  workTitle,
  DIFFICULTY_OPTIONS,
  GENDER_OPTIONS,
  WORKS_OPTIONS,
  type Difficulty,
  type GenderFilter,
  type SeiyuuWithDisplay,
  type WorksFilter,
} from "@/lib/data";
import { compare, type GuessResult } from "@/lib/game";
import GuessInput from "./GuessInput";
import GuessTable from "./GuessTable";

// v5：存档新增 works（作品范围）字段
const STORAGE_KEY = "seiyuu-game-v5";

type Status = "playing" | "won" | "lost" | "gaveUp";

interface SaveState {
  answerId: number;
  guesses: number[];
  difficulty: Difficulty;
  limit: number;
  gender: GenderFilter;
  works: WorksFilter;
  status: Status;
}

interface Props {
  difficulty: Difficulty;
  limit: number;
  gender: GenderFilter;
  works: WorksFilter;
}

export default function GameBoard({ difficulty, limit, gender, works }: Props) {
  const pool = useMemo(
    () => poolFor(difficulty, gender, works),
    [difficulty, gender, works]
  );
  const [state, setState] = useState<SaveState | null>(null);

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
      status: "playing",
    };
  }

  // 客户端初始化：存档与当前设置一致则恢复，否则开新局
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as SaveState;
        if (
          saved.difficulty === difficulty &&
          saved.limit === limit &&
          saved.gender === gender &&
          saved.works === works &&
          pool.some((s) => s.id === saved.answerId)
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
    setState(newGame());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [difficulty, limit, gender, works, pool]);

  useEffect(() => {
    if (state) localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const answer = state ? seiyuuById.get(state.answerId)! : null;

  const results: GuessResult[] = useMemo(() => {
    if (!state || !answer) return [];
    return state.guesses
      .map((id) => compare(seiyuuById.get(id)!, answer, works))
      .reverse(); // 最新猜测置顶
  }, [state, answer, works]);

  if (!state || !answer) {
    return <p className="text-center text-zinc-500">加载中…</p>;
  }

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
      <div className="flex flex-wrap items-center justify-center gap-3 text-sm text-zinc-400">
        <span className="rounded border border-zinc-700 px-2 py-1 text-xs">
          难度：{difficultyLabel}
          {gender !== "all" && ` · ${genderLabel}`}
          {works !== "all" && ` · ${worksLabel}`} · 答案池 {pool.length} 人
        </span>
        <span>
          已猜 {state.guesses.length} 次
          {remaining !== null && ` · 剩余 ${remaining} 次`}
        </span>
        {!over && (
          <button
            onClick={() => setState({ ...state, status: "gaveUp" })}
            className="rounded border border-zinc-700 px-3 py-1 hover:bg-zinc-800"
          >
            认输
          </button>
        )}
        <button
          onClick={() => setState(newGame())}
          className="rounded border border-zinc-700 px-3 py-1 hover:bg-zinc-800"
        >
          再来一局
        </button>
        <Link
          href="/"
          className="rounded border border-zinc-700 px-3 py-1 hover:bg-zinc-800"
        >
          返回主页
        </Link>
      </div>

      <GuessInput
        guessedIds={new Set(state.guesses)}
        disabled={over}
        gender={gender}
        onGuess={guess}
      />

      {!over && state.guesses.length === 0 && (
        <div className="mx-auto max-w-3xl text-zinc-300">
          <h2 className="mb-8 text-center text-2xl font-bold text-zinc-100">玩法规则</h2>
          <div className="grid gap-8 sm:grid-cols-2">
            <div>
              <h3 className="mb-3 text-sm font-medium tracking-wide text-zinc-500">
                对比线索
              </h3>
              <p className="text-base leading-7">
                每次猜测会与答案对比六类线索：性别、出生年份、出身地、血型、
                出道年份、出演作品。年份类线索不一致时会用 ▲▼ 提示答案的方向。
              </p>
            </div>
            <div>
              <h3 className="mb-3 text-sm font-medium tracking-wide text-zinc-500">
                颜色含义
              </h3>
              <ul className="space-y-2 text-base">
                <li className="flex items-center gap-2.5">
                  <span className="h-3.5 w-3.5 shrink-0 rounded-sm bg-emerald-500" />
                  绿色 = 完全一致
                </li>
                <li className="flex items-center gap-2.5">
                  <span className="h-3.5 w-3.5 shrink-0 rounded-sm bg-amber-400" />
                  黄色 = 接近（年份相差 ±2 / 同都道府县）
                </li>
                <li className="flex items-center gap-2.5">
                  <span className="h-3.5 w-3.5 shrink-0 rounded-sm bg-zinc-600" />
                  灰色 = 不匹配
                </li>
              </ul>
            </div>
          </div>
          <p className="mt-8 border-t border-zinc-800 pt-6 text-center text-sm text-zinc-400">
            「{works === "game" ? "热门游戏" : works === "anime" ? "热门动画" : "热门作品"}」列中，
            <span className="font-medium text-emerald-400">亮绿词条</span> = 与答案共同出演，
            {works !== "game" && (
              <>
                <span className="font-medium text-amber-300">亮黄词条</span> = 同系列作品，
              </>
            )}
            命中的词条会自动排到最前
            {works === "all" && (
              <>
                ；作品含动画与游戏，游戏词条带
                <span className="mx-0.5 rounded-sm bg-sky-500/25 px-0.5 text-[10px] leading-none text-sky-300">游</span>
                标记
              </>
            )}
            {works === "game" && "；本局仅游戏作品（无同系列提示）"}
          </p>
        </div>
      )}

      {over && (
        <div className="mx-auto max-w-md rounded-lg border border-zinc-700 bg-zinc-900 p-4 text-center">
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
        </div>
      )}

      <GuessTable results={results} works={works} />
    </div>
  );
}
