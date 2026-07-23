"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  seiyuuList,
  workTitle,
  type GameWork,
  type SeiyuuWithDisplay,
  type Work,
} from "@/lib/data";

type Kind = "anime" | "game";
type AnyWork = Work | GameWork;

interface Row {
  seiyuu: SeiyuuWithDisplay;
  kind: Kind;
  work: AnyWork;
}

const PAGE_SIZE = 50;
const inputCls =
  "rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm outline-none placeholder:text-zinc-500 focus:border-emerald-500";

function normalize(s: string) {
  return s.toLowerCase().replace(/\s+/g, "");
}

function rowKey(r: Row): string {
  return `${r.seiyuu.id}:${r.kind}:${r.work.id}`;
}

interface EditForm {
  title_zh: string;
  title_native: string;
  year: string;
}

interface AddForm {
  kind: Kind;
  id: string;
  title_zh: string;
  title_native: string;
  year: string;
  popularity: string;
}

const EMPTY_ADD: AddForm = {
  kind: "anime",
  id: "",
  title_zh: "",
  title_native: "",
  year: "",
  popularity: "",
};

export default function AdminPage() {
  const [rows, setRows] = useState<Row[]>(() =>
    seiyuuList.flatMap((s) => [
      ...s.works.map((w) => ({ seiyuu: s, kind: "anime" as const, work: w })),
      ...s.game_works.map((w) => ({ seiyuu: s, kind: "game" as const, work: w })),
    ])
  );
  const [qSeiyuu, setQSeiyuu] = useState("");
  const [qWork, setQWork] = useState("");
  const [kind, setKind] = useState<"all" | Kind>("all");
  const [page, setPage] = useState(1);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({ title_zh: "", title_native: "", year: "" });
  const [addOpen, setAddOpen] = useState(false);
  const [addQuery, setAddQuery] = useState("");
  const [addSeiyuu, setAddSeiyuu] = useState<SeiyuuWithDisplay | null>(null);
  const [addForm, setAddForm] = useState<AddForm>(EMPTY_ADD);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  // ---- 过滤 + 分页 ----
  const filtered = useMemo(() => {
    const qs = normalize(qSeiyuu.trim());
    const qw = normalize(qWork.trim());
    return rows.filter((r) => {
      if (kind !== "all" && r.kind !== kind) return false;
      if (
        qs &&
        ![r.seiyuu.display, r.seiyuu.name_native, r.seiyuu.name_romaji]
          .filter(Boolean)
          .some((n) => normalize(n as string).includes(qs))
      )
        return false;
      if (
        qw &&
        ![r.work.title_zh, r.work.title_native, (r.work as Work).title_romaji]
          .filter(Boolean)
          .some((n) => normalize(n as string).includes(qw))
      )
        return false;
      return true;
    });
  }, [rows, qSeiyuu, qWork, kind]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const pageKeys = pageRows.map(rowKey);
  const allPageChecked = pageKeys.length > 0 && pageKeys.every((k) => checked.has(k));

  // ---- 添加词条的声优候选 ----
  const addCandidates = useMemo(() => {
    const q = normalize(addQuery.trim());
    if (!q) return [];
    return seiyuuList
      .filter((s) =>
        [s.display, s.name_native, s.name_romaji]
          .filter(Boolean)
          .some((n) => normalize(n as string).includes(q))
      )
      .slice(0, 8);
  }, [addQuery]);

  async function callApi(body: unknown): Promise<{ ok: boolean; text?: string; data?: Record<string, unknown> }> {
    const res = await fetch("/api/admin/works", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    return res.ok
      ? { ok: true, data: json }
      : { ok: false, text: (json as { error?: string }).error ?? `HTTP ${res.status}` };
  }

  // ---- 删除（单行与批量共用） ----
  async function deleteRows(targets: Row[]) {
    if (targets.length === 0) return;
    if (!window.confirm(`确认删除 ${targets.length} 条词条？（写入 web-seiyuu.json）`)) return;
    const r = await callApi({
      action: "delete",
      items: targets.map((t) => ({
        seiyuu_id: t.seiyuu.id,
        kind: t.kind,
        work_id: t.work.id,
      })),
    });
    if (r.ok) {
      const keys = new Set(targets.map(rowKey));
      setRows((rs) => rs.filter((x) => !keys.has(rowKey(x))));
      setChecked((c) => {
        const n = new Set(c);
        keys.forEach((k) => n.delete(k));
        return n;
      });
      setMessage({ ok: true, text: `已删除 ${targets.length} 条` });
    } else {
      setMessage({ ok: false, text: `删除失败：${r.text}` });
    }
  }

  // ---- 行内编辑 ----
  function startEdit(r: Row) {
    setEditing(rowKey(r));
    setEditForm({
      title_zh: r.work.title_zh ?? "",
      title_native: r.work.title_native ?? "",
      year: r.work.year?.toString() ?? "",
    });
  }

  async function saveEdit(r: Row) {
    const y = editForm.year.trim();
    const yearNum = y ? Number(y) : null;
    if (y && !Number.isInteger(yearNum)) {
      setMessage({ ok: false, text: "年份必须是整数或留空" });
      return;
    }
    const patch = {
      title_zh: editForm.title_zh.trim() || null,
      title_native: editForm.title_native.trim() || null,
      year: yearNum,
    };
    const res = await callApi({
      action: "update",
      item: { seiyuu_id: r.seiyuu.id, kind: r.kind, work_id: r.work.id, patch },
    });
    if (res.ok) {
      const key = rowKey(r);
      setRows((rs) =>
        rs.map((x) => (rowKey(x) === key ? { ...x, work: { ...x.work, ...patch } } : x))
      );
      setEditing(null);
      setMessage({ ok: true, text: "已保存" });
    } else {
      setMessage({ ok: false, text: `保存失败：${res.text}` });
    }
  }

  // ---- 添加词条 ----
  async function saveAdd() {
    if (!addSeiyuu) {
      setMessage({ ok: false, text: "请先搜索并选择声优" });
      return;
    }
    const id = Number(addForm.id);
    if (!Number.isInteger(id) || id <= 0) {
      setMessage({ ok: false, text: "作品 id 必须是正整数（动画填 AniList id，游戏填 bgm.tv id）" });
      return;
    }
    const y = addForm.year.trim();
    const p = addForm.popularity.trim();
    const work = {
      id,
      title_zh: addForm.title_zh.trim() || null,
      title_native: addForm.title_native.trim() || null,
      year: y ? Number(y) : null,
      popularity: p ? Number(p) : 0,
    };
    if ((y && !Number.isInteger(work.year)) || (p && !Number.isInteger(work.popularity))) {
      setMessage({ ok: false, text: "年份/人气必须是整数或留空" });
      return;
    }
    const res = await callApi({
      action: "add",
      item: { seiyuu_id: addSeiyuu.id, kind: addForm.kind, work },
    });
    if (res.ok) {
      const saved = (res.data as { work: AnyWork }).work;
      setRows((rs) => {
        const next = [...rs];
        const pop = saved.popularity ?? 0;
        // 插到同声优同类型区块内、按人气降序的位置（保持与导出顺序一致）
        let idx = next.findIndex(
          (x) =>
            x.seiyuu.id === addSeiyuu.id &&
            x.kind === addForm.kind &&
            (x.work.popularity ?? 0) < pop
        );
        if (idx === -1) {
          let last = -1;
          next.forEach((x, i) => {
            if (x.seiyuu.id === addSeiyuu.id && x.kind === addForm.kind) last = i;
          });
          idx = last === -1 ? next.length : last + 1;
        }
        next.splice(idx, 0, { seiyuu: addSeiyuu, kind: addForm.kind, work: saved });
        return next;
      });
      setMessage({ ok: true, text: `已添加「${workTitle(saved)}」到 ${addSeiyuu.display}` });
      setAddForm(EMPTY_ADD);
    } else {
      setMessage({ ok: false, text: `添加失败：${res.text}` });
    }
  }

  function toggleCheck(key: string) {
    setChecked((c) => {
      const n = new Set(c);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  }

  function toggleCheckPage() {
    setChecked((c) => {
      const n = new Set(c);
      if (allPageChecked) pageKeys.forEach((k) => n.delete(k));
      else pageKeys.forEach((k) => n.add(k));
      return n;
    });
  }

  const checkedRows = rows.filter((r) => checked.has(rowKey(r)));

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-black tracking-widest">数据管理</h1>
        <Link href="/" className="text-sm text-zinc-400 transition-colors hover:text-zinc-100">
          ← 返回主页
        </Link>
      </div>
      <p className="mt-3 rounded border border-amber-700/50 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-200/90">
        所有操作立即写入 data/web-seiyuu.json（重跑数据管线会覆盖手动修改）；游戏页刷新后生效。
      </p>

      {/* 过滤行 */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <input
          value={qSeiyuu}
          onChange={(e) => {
            setQSeiyuu(e.target.value);
            setPage(1);
          }}
          placeholder="声优名（中文 / 日文 / 罗马音）"
          className={`${inputCls} w-56`}
        />
        <input
          value={qWork}
          onChange={(e) => {
            setQWork(e.target.value);
            setPage(1);
          }}
          placeholder="作品名 / tag（如 明日方舟）"
          className={`${inputCls} w-56`}
        />
        <select
          value={kind}
          onChange={(e) => {
            setKind(e.target.value as "all" | Kind);
            setPage(1);
          }}
          className={inputCls}
        >
          <option value="all">全部类型</option>
          <option value="anime">仅动画</option>
          <option value="game">仅游戏</option>
        </select>
        <span className="text-sm text-zinc-500">
          共 {filtered.length} 条（全库 {rows.length} 条）
        </span>
        <div className="ml-auto flex items-center gap-3">
          {checked.size > 0 && (
            <button
              onClick={() => deleteRows(checkedRows)}
              className="rounded-full border border-red-800 px-4 py-2 text-sm text-red-400 transition-colors hover:bg-red-950"
            >
              删除选中 {checked.size} 条
            </button>
          )}
          <button
            onClick={() => setAddOpen((v) => !v)}
            className="rounded-full border border-emerald-700 px-4 py-2 text-sm text-emerald-400 transition-colors hover:bg-emerald-950"
          >
            {addOpen ? "收起添加" : "+ 添加词条"}
          </button>
        </div>
      </div>

      {/* 添加词条表单 */}
      {addOpen && (
        <div className="mt-4 space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative">
              <input
                value={addQuery}
                onChange={(e) => setAddQuery(e.target.value)}
                placeholder="搜索声优…"
                className={`${inputCls} w-56`}
              />
              {addCandidates.length > 0 && (
                <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl">
                  {addCandidates.map((s) => (
                    <li key={s.id}>
                      <button
                        onClick={() => {
                          setAddSeiyuu(s);
                          setAddQuery("");
                        }}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-zinc-800"
                      >
                        <span>{s.display}</span>
                        <span className="text-xs text-zinc-500">{s.name_romaji}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {addSeiyuu && (
              <span className="rounded bg-emerald-500/15 px-2 py-1 text-xs text-emerald-300">
                {addSeiyuu.display}（#{addSeiyuu.id}）
              </span>
            )}
            <select
              value={addForm.kind}
              onChange={(e) => setAddForm({ ...addForm, kind: e.target.value as Kind })}
              className={inputCls}
            >
              <option value="anime">动画</option>
              <option value="game">游戏</option>
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <input
              value={addForm.id}
              onChange={(e) => setAddForm({ ...addForm, id: e.target.value })}
              placeholder="作品 id（必填）"
              inputMode="numeric"
              className={`${inputCls} w-36`}
            />
            <input
              value={addForm.title_zh}
              onChange={(e) => setAddForm({ ...addForm, title_zh: e.target.value })}
              placeholder="中文标题"
              className={`${inputCls} w-48`}
            />
            <input
              value={addForm.title_native}
              onChange={(e) => setAddForm({ ...addForm, title_native: e.target.value })}
              placeholder="日文/原名"
              className={`${inputCls} w-48`}
            />
            <input
              value={addForm.year}
              onChange={(e) => setAddForm({ ...addForm, year: e.target.value })}
              placeholder="年份"
              inputMode="numeric"
              className={`${inputCls} w-24`}
            />
            <input
              value={addForm.popularity}
              onChange={(e) => setAddForm({ ...addForm, popularity: e.target.value })}
              placeholder="人气（默认 0）"
              inputMode="numeric"
              className={`${inputCls} w-32`}
            />
            <button
              onClick={saveAdd}
              className="rounded-full bg-emerald-500 px-5 py-2 text-sm font-bold text-zinc-950 transition hover:bg-emerald-400"
            >
              提交添加
            </button>
          </div>
          <p className="text-xs text-zinc-600">
            动画填 AniList 作品 id，游戏填 bgm.tv subject id；id 可从对应网站的作品页 URL 获取。
          </p>
        </div>
      )}

      {message && (
        <p className={`mt-4 text-sm ${message.ok ? "text-emerald-400" : "text-red-400"}`}>
          {message.text}
        </p>
      )}

      {/* 词条表格 */}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full border-collapse text-sm text-zinc-200">
          <thead>
            <tr className="border-b border-zinc-700 text-xs text-zinc-500">
              <th className="w-8 px-2 py-2">
                <input
                  type="checkbox"
                  checked={allPageChecked}
                  onChange={toggleCheckPage}
                  className="accent-emerald-500"
                />
              </th>
              <th className="px-3 py-2 text-left font-medium">声优</th>
              <th className="px-3 py-2 text-center font-medium">类型</th>
              <th className="px-3 py-2 text-left font-medium">作品</th>
              <th className="px-3 py-2 text-center font-medium">年份</th>
              <th className="px-3 py-2 text-right font-medium">人气</th>
              <th className="px-3 py-2 text-right font-medium">id</th>
              <th className="px-3 py-2 text-center font-medium">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/60">
            {pageRows.map((r) => {
              const key = rowKey(r);
              const isEditing = editing === key;
              return (
                <tr key={key} className="transition-colors hover:bg-zinc-900/60">
                  <td className="px-2 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={checked.has(key)}
                      onChange={() => toggleCheck(key)}
                      className="accent-emerald-500"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      {r.seiyuu.image && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={r.seiyuu.image}
                          alt=""
                          className="h-7 w-7 rounded object-cover"
                        />
                      )}
                      <span className="whitespace-nowrap">{r.seiyuu.display}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-center">
                    {r.kind === "game" ? (
                      <span className="rounded-sm bg-sky-500/25 px-1 text-[10px] leading-none text-sky-300">
                        游
                      </span>
                    ) : (
                      <span className="text-zinc-500">动画</span>
                    )}
                  </td>
                  {isEditing ? (
                    <>
                      <td className="px-3 py-2">
                        <div className="flex gap-2">
                          <input
                            value={editForm.title_zh}
                            onChange={(e) =>
                              setEditForm({ ...editForm, title_zh: e.target.value })
                            }
                            placeholder="中文标题"
                            className={`${inputCls} w-40 px-2 py-1`}
                          />
                          <input
                            value={editForm.title_native}
                            onChange={(e) =>
                              setEditForm({ ...editForm, title_native: e.target.value })
                            }
                            placeholder="日文/原名"
                            className={`${inputCls} w-40 px-2 py-1`}
                          />
                        </div>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <input
                          value={editForm.year}
                          onChange={(e) => setEditForm({ ...editForm, year: e.target.value })}
                          inputMode="numeric"
                          className={`${inputCls} w-20 px-2 py-1 text-center`}
                        />
                      </td>
                      <td className="px-3 py-2 text-right text-zinc-500">
                        {r.work.popularity ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-right text-zinc-500">{r.work.id}</td>
                      <td className="px-3 py-2 text-center">
                        <button
                          onClick={() => saveEdit(r)}
                          className="mr-2 text-emerald-400 hover:text-emerald-300"
                        >
                          保存
                        </button>
                        <button
                          onClick={() => setEditing(null)}
                          className="text-zinc-500 hover:text-zinc-300"
                        >
                          取消
                        </button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-3 py-2">
                        <span>{workTitle(r.work)}</span>
                        {r.work.title_zh && r.work.title_native && (
                          <span className="ml-2 text-xs text-zinc-500">
                            {r.work.title_native}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center text-zinc-400">
                        {r.work.year ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-right text-zinc-500">
                        {r.work.popularity ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-right text-zinc-500">{r.work.id}</td>
                      <td className="px-3 py-2 text-center">
                        <button
                          onClick={() => startEdit(r)}
                          className="mr-2 text-zinc-400 transition-colors hover:text-emerald-400"
                        >
                          编辑
                        </button>
                        <button
                          onClick={() => deleteRows([r])}
                          className="text-zinc-400 transition-colors hover:text-red-400"
                        >
                          删除
                        </button>
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        {pageRows.length === 0 && (
          <p className="py-8 text-center text-sm text-zinc-600">没有匹配的词条</p>
        )}
      </div>

      {/* 分页 */}
      <div className="mt-4 flex items-center justify-center gap-4 text-sm text-zinc-400">
        <button
          onClick={() => setPage(safePage - 1)}
          disabled={safePage <= 1}
          className="rounded border border-zinc-700 px-3 py-1 transition-colors hover:bg-zinc-800 disabled:opacity-40"
        >
          上一页
        </button>
        <span>
          {safePage} / {pageCount} 页
        </span>
        <button
          onClick={() => setPage(safePage + 1)}
          disabled={safePage >= pageCount}
          className="rounded border border-zinc-700 px-3 py-1 transition-colors hover:bg-zinc-800 disabled:opacity-40"
        >
          下一页
        </button>
      </div>
    </main>
  );
}
