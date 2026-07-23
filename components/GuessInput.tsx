"use client";

import { useMemo, useState } from "react";
import { seiyuuList, type GenderFilter, type SeiyuuWithDisplay } from "@/lib/data";

function normalize(s: string) {
  return s.toLowerCase().replace(/\s+/g, "");
}

interface Props {
  guessedIds: Set<number>;
  disabled: boolean;
  /** 本局的性别过滤：限定男/女时，候选里不再出现相反性别的声优 */
  gender: GenderFilter;
  onGuess: (s: SeiyuuWithDisplay) => void;
}

export default function GuessInput({ guessedIds, disabled, gender, onGuess }: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const candidates = useMemo(() => {
    const q = normalize(query.trim());
    if (!q) return [];
    return seiyuuList
      .filter((s) => !guessedIds.has(s.id))
      .filter((s) => gender === "all" || s.gender === gender)
      .filter((s) =>
        [s.display, s.name_native, s.name_romaji]
          .filter(Boolean)
          .some((n) => normalize(n as string).includes(q))
      )
      .slice(0, 8);
  }, [query, guessedIds, gender]);

  function pick(s: SeiyuuWithDisplay) {
    onGuess(s);
    setQuery("");
    setOpen(false);
    setActiveIndex(0);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (candidates.length === 0) return;
      setOpen(true);
      setActiveIndex((i) => {
        const next = e.key === "ArrowDown" ? i + 1 : i - 1;
        // 循环滚动
        return (next + candidates.length) % candidates.length;
      });
    } else if (e.key === "Enter" && candidates.length > 0) {
      pick(candidates[Math.min(activeIndex, candidates.length - 1)]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="relative mx-auto w-full max-w-md">
      <input
        type="text"
        value={query}
        disabled={disabled}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActiveIndex(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={handleKeyDown}
        placeholder={disabled ? "本局已结束" : "输入声优名（中文 / 日文 / 罗马音）"}
        className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm outline-none placeholder:text-zinc-500 focus:border-emerald-500 disabled:opacity-50"
      />
      {open && candidates.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl">
          {candidates.map((s, i) => (
            <li key={s.id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => pick(s)}
                className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm ${
                  i === activeIndex ? "bg-zinc-800 text-emerald-400" : ""
                }`}
              >
                {s.image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={s.image} alt="" className="h-8 w-8 rounded object-cover" />
                )}
                <span>{s.display}</span>
                <span className="text-xs text-zinc-500">{s.name_romaji}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
