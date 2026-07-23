import { readFile, rename, writeFile } from "fs/promises";
import path from "path";

export const runtime = "nodejs";

const DATA_PATH = path.join(process.cwd(), "data", "web-seiyuu.json");

type Kind = "anime" | "game";
const KIND_FIELD: Record<Kind, "works" | "game_works"> = {
  anime: "works",
  game: "game_works",
};

interface WebSeiyuu {
  id: number;
  works?: Record<string, unknown>[];
  game_works?: Record<string, unknown>[];
  [key: string]: unknown;
}

interface WebData {
  seiyuu: WebSeiyuu[];
  [key: string]: unknown;
}

/** 纯本地工具：仅允许本机访问，防止误部署到公网后暴露写文件能力 */
function isLocal(req: Request): boolean {
  const host = (req.headers.get("host") ?? "").split(":")[0];
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

const err = (msg: string, status = 400) =>
  Response.json({ error: msg }, { status });

/** 原子写回：先写临时文件再重命名，防止中断留下半个 JSON */
async function save(data: WebData) {
  await writeFile(DATA_PATH + ".tmp", JSON.stringify(data), "utf-8");
  await rename(DATA_PATH + ".tmp", DATA_PATH);
}

/**
 * 读取数据文件。dev 模式下写盘会触发热更新，重编译窗口内可能读到瞬时
 * 异常内容（实测偶发），失败时稍候重读
 */
async function loadData(retries = 3): Promise<WebData> {
  for (let i = 0; ; i++) {
    try {
      return JSON.parse(await readFile(DATA_PATH, "utf-8")) as WebData;
    } catch (e) {
      if (i >= retries - 1) throw e;
      await new Promise((r) => setTimeout(r, 150));
    }
  }
}

function worksOf(s: WebSeiyuu, kind: Kind): Record<string, unknown>[] {
  const field = KIND_FIELD[kind];
  return (s[field] as Record<string, unknown>[]) ?? [];
}

export async function POST(req: Request) {
  if (!isLocal(req)) return err("仅允许本机访问", 403);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return err("请求体不是合法 JSON");
  }

  let data: WebData;
  try {
    data = await loadData();
  } catch {
    return err("数据文件读取失败（可能正在热更新），请重试", 503);
  }
  const byId = new Map(data.seiyuu.map((s) => [s.id, s]));

  // ---- 批量/单行删除 ----
  if (body.action === "delete") {
    const items = body.items;
    if (!Array.isArray(items)) return err("items 必须是数组");
    let affected = 0;
    for (const it of items as Record<string, unknown>[]) {
      const s = byId.get(Number(it?.seiyuu_id));
      const field = KIND_FIELD[it?.kind as Kind];
      if (!s || !field) continue;
      const list = worksOf(s, it.kind as Kind);
      const next = list.filter((w) => w.id !== Number(it.work_id));
      if (next.length !== list.length) {
        (s as Record<string, unknown>)[field] = next;
        affected++;
      }
    }
    if (affected > 0) await save(data);
    return Response.json({ ok: true, affected });
  }

  // ---- 编辑词条（白名单三字段） ----
  if (body.action === "update") {
    const it = body.item as Record<string, unknown> | undefined;
    const s = byId.get(Number(it?.seiyuu_id));
    const kind = it?.kind as Kind;
    if (!s || !KIND_FIELD[kind] || typeof it?.patch !== "object" || it.patch === null)
      return err("参数不完整或声优不存在", 404);
    const w = worksOf(s, kind).find((x) => x.id === Number(it.work_id));
    if (!w) return err("词条不存在", 404);
    const patch = it.patch as Record<string, unknown>;
    for (const key of ["title_zh", "title_native", "year"] as const) {
      if (key in patch) {
        const v = patch[key];
        if (v !== null && typeof v !== "string" && typeof v !== "number")
          return err(`字段 ${key} 类型非法`);
        w[key] = v;
      }
    }
    await save(data);
    return Response.json({ ok: true, work: w });
  }

  // ---- 添加词条（series_id 默认自身 id，插入后按人气降序保持 rank 语义） ----
  if (body.action === "add") {
    const it = body.item as Record<string, unknown> | undefined;
    const s = byId.get(Number(it?.seiyuu_id));
    const kind = it?.kind as Kind;
    const work = it?.work as Record<string, unknown> | undefined;
    if (!s || !KIND_FIELD[kind] || typeof work !== "object" || work === null)
      return err("参数不完整或声优不存在", 404);
    if (!Number.isInteger(work.id) || Number(work.id) <= 0)
      return err("作品 id 必须是正整数");
    const list = worksOf(s, kind);
    if (list.some((w) => w.id === work.id))
      return err("该作品已在此声优名下", 409);

    // 字段顺序与 export_web_data.py 的输出保持一致，diff 更整洁
    const entry: Record<string, unknown> = { id: work.id };
    entry.title_native = work.title_native ?? null;
    if (kind === "anime") entry.title_romaji = work.title_romaji ?? null;
    entry.title_zh = work.title_zh ?? null;
    entry.year = work.year ?? null;
    if (kind === "anime") entry.format = work.format ?? null;
    entry.popularity = work.popularity ?? 0;
    entry.series_id = work.id; // 系列归属由 collect_series 聚类，手动添加默认无系列

    list.push(entry);
    list.sort(
      (a, b) => (Number(b.popularity) || 0) - (Number(a.popularity) || 0)
    );
    (s as Record<string, unknown>)[KIND_FIELD[kind]] = list;
    await save(data);
    return Response.json({ ok: true, work: entry });
  }

  return err("未知 action");
}
