"""从 bgm.tv API 采集声优的游戏出演作品，落地 data/games.json。

为什么需要本脚本：AniList 只有 ANIME/MANGA 类目，没有游戏；bgm.tv 是日系
游戏覆盖最全的公开数据库，且 collect_translations.py 已为 474/500 声优
采得 bangumi_id 映射（data/i18n.json），游戏中文名可直接取 bgm name_cn，
无需再走翻译管线。

注意出演关系的取法：/v0/persons/{id}/subjects 只含 staff 类职位（原作、
主题歌演出等），不含配音出演；配音出演必须走 /v0/persons/{id}/characters
（角色×作品展开），过滤 subject_type == 4（游戏）。同一声优在同一游戏
配多个角色（一人多役）会产生多条记录，合并去重并保留最佳戏份。

游戏与动漫分开存放：本脚本产物只含 bgm.tv subject id（与 AniList media id
是不同的 id 空间，可能撞号），build_db / export 均走独立的表与数组。

用法:
    python scripts/collect_games.py [--interval 0.4] [--limit N]

输出:
    data/games.json        {"games": {bgm_id: 作品信息}, "seiyuu_games": {anilist_id: [bgm_id 按人气降序]},
                            "seiyuu_game_roles": {anilist_id: {bgm_id: [角色名（截前 3）]}}}
    data/games.cache.json  API 响应缓存，中断后重跑自动续传
"""

import argparse
import json
import ssl
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SEIYUU_PATH = ROOT / "data" / "seiyuu.json"
I18N_PATH = ROOT / "data" / "i18n.json"
CACHE_PATH = ROOT / "data" / "games.cache.json"
OUT_PATH = ROOT / "data" / "games.json"

API_BASE = "https://api.bgm.tv"
HEADERS = {
    "Accept": "application/json",
    "User-Agent": "seiyuu-guessing/0.1 (personal project, data collection)",
}

GAME_TYPE = 4  # bgm.tv subject type: 游戏
# 每个声优保留的热门游戏上限（按 bgm 评分人数降序截）。games 会进前端 bundle，
# 15 部约增加 1MB，与动画 WORKS_CAP=30 同理是体积与覆盖的折中
GAME_WORKS_CAP = 15
# 每部游戏保留的角色名上限（一人多役时按 API 顺序截断，控制 bundle 体积）
ROLES_PER_GAME_CAP = 3
# 一人多役合并时取最佳戏份（bgm staff 值为 主角/配角/客串）
STAFF_RANK = {"主角": 3, "配角": 2, "客串": 1}

# Windows 系统证书库对 bgm.tv 的证书校验失败，优先用 certifi（同 collect_translations.py）
try:
    import certifi

    SSL_CTX = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    SSL_CTX = ssl.create_default_context()


def http_get(path: str, max_retries: int = 5) -> object:
    for attempt in range(max_retries):
        req = urllib.request.Request(API_BASE + path, headers=HEADERS)
        try:
            with urllib.request.urlopen(req, timeout=30, context=SSL_CTX) as resp:
                return json.loads(resp.read())
        except urllib.error.HTTPError as e:
            if e.code == 429:
                wait = min(int(e.headers.get("Retry-After", 30)), 120)
                print(f"  触发限速，等待 {wait}s ({attempt + 1}/{max_retries})")
                time.sleep(wait)
                continue
            if e.code == 404:
                return None
            if 500 <= e.code < 600 and attempt < max_retries - 1:
                time.sleep(2 ** attempt * 5)
                continue
            raise
        except (urllib.error.URLError, TimeoutError):
            if attempt < max_retries - 1:
                time.sleep(2 ** attempt * 5)
                continue
            raise
    raise RuntimeError(f"重试耗尽: {path}")


class Cache:
    """两节缓存：person_characters（人物出演角色表）、game_subjects（游戏详情）。"""

    def __init__(self, path: Path):
        self.path = path
        if path.exists():
            self.data = json.loads(path.read_text(encoding="utf-8"))
        else:
            self.data = {"person_characters": {}, "game_subjects": {}}

    def save(self) -> None:
        self.path.write_text(
            json.dumps(self.data, ensure_ascii=False), encoding="utf-8"
        )


def year_of(date: str | None) -> int | None:
    """bgm date 形如 "2009-10-15" / "2009" / 空串，取发行年份。"""
    if date and len(date) >= 4 and date[:4].isdigit():
        return int(date[:4])
    return None


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--interval", type=float, default=0.4, help="请求间隔秒数")
    parser.add_argument("--limit", type=int, default=0, help="只处理前 N 名声优（测试用）")
    args = parser.parse_args()

    seiyuu_list = json.loads(SEIYUU_PATH.read_text(encoding="utf-8"))
    i18n = json.loads(I18N_PATH.read_text(encoding="utf-8"))
    if args.limit:
        seiyuu_list = seiyuu_list[: args.limit]

    # 只有拿到 bangumi_id 的声优才能采游戏（约 474/500，无映射者跳过）
    persons: list[tuple[int, int]] = []  # (anilist_id, bangumi_person_id)
    for s in seiyuu_list:
        pid = (i18n.get("seiyuu", {}).get(str(s["id"])) or {}).get("bangumi_id")
        if pid:
            persons.append((s["id"], pid))
    print(f"声优 {len(seiyuu_list)} 人，有 bangumi_id 的 {len(persons)} 人")

    cache = Cache(CACHE_PATH)

    # ---- 阶段 1: 抓取人物出演角色表（缓存精简字段） ----
    todo = [pid for _, pid in persons if str(pid) not in cache.data["person_characters"]]
    print(f"阶段1: 需抓取人物角色表 {len(todo)} 人（已缓存 {len(cache.data['person_characters'])}）")
    for i, pid in enumerate(todo, 1):
        raw = http_get(f"/v0/persons/{pid}/characters") or []
        cache.data["person_characters"][str(pid)] = [
            {
                "id": c.get("id"),
                "name": c.get("name"),
                "subject_id": c.get("subject_id"),
                "subject_name": c.get("subject_name"),
                "subject_type": c.get("subject_type"),
                "staff": c.get("staff"),
            }
            for c in raw
        ]
        if i % 25 == 0 or i == len(todo):
            cache.save()
            print(f"  人物角色表 {i}/{len(todo)}")
        time.sleep(args.interval)
    cache.save()

    # ---- 阶段 2: 聚合游戏候选（一人多役合并），抓取游戏详情 ----
    # candidates: anilist_id -> {bgm_subject_id: 最佳戏份 rank}
    candidates: dict[int, dict[int, int]] = {}
    # role_names: anilist_id -> {bgm_subject_id: [角色名]}，按 API 返回顺序去重，
    # 供「悬浮显示配音角色」用（作品词条的 title 提示）
    role_names: dict[int, dict[int, list[str]]] = {}
    for aid, pid in persons:
        for c in cache.data["person_characters"].get(str(pid)) or []:
            if c.get("subject_type") != GAME_TYPE or not c.get("subject_id"):
                continue
            games = candidates.setdefault(aid, {})
            gid = c["subject_id"]
            games[gid] = max(games.get(gid, 0), STAFF_RANK.get(c.get("staff") or "", 0))
            name = c.get("name")
            if name:
                names = role_names.setdefault(aid, {}).setdefault(gid, [])
                if name not in names:
                    names.append(name)

    all_gids = sorted({gid for m in candidates.values() for gid in m})
    todo_gids = [g for g in all_gids if str(g) not in cache.data["game_subjects"]]
    print(
        f"阶段2: 游戏候选 {len(all_gids)} 部（去重后），"
        f"需抓取详情 {len(todo_gids)} 部（已缓存 {len(cache.data['game_subjects'])}）"
    )
    for i, gid in enumerate(todo_gids, 1):
        d = http_get(f"/v0/subjects/{gid}") or {}
        cache.data["game_subjects"][str(gid)] = {
            "name": d.get("name"),
            "name_cn": d.get("name_cn") or None,
            "year": year_of(d.get("date")),
            # 评分人数作为人气代理（冷门游戏可能为 0）
            "rating_total": (d.get("rating") or {}).get("total") or 0,
        }
        if i % 50 == 0 or i == len(todo_gids):
            cache.save()
            print(f"  游戏详情 {i}/{len(todo_gids)}")
        time.sleep(args.interval)
    cache.save()

    # ---- 阶段 3: 每人按人气降序截 GAME_WORKS_CAP，汇总输出 ----
    subjects = cache.data["game_subjects"]
    games_out: dict[str, dict] = {}
    seiyuu_games: dict[str, list[int]] = {}
    seiyuu_game_roles: dict[str, dict[str, list[str]]] = {}
    for aid, game_map in candidates.items():
        ranked = sorted(
            game_map, key=lambda g: -(subjects.get(str(g), {}).get("rating_total") or 0)
        )
        top = ranked[:GAME_WORKS_CAP]
        if not top:
            continue
        seiyuu_games[str(aid)] = top
        # 只保留截断后 top 游戏的角色名（随 seiyuu_games 一起进前端 bundle）
        roles = {str(gid): names[:ROLES_PER_GAME_CAP] for gid in top if (names := role_names.get(aid, {}).get(gid))}
        if roles:
            seiyuu_game_roles[str(aid)] = roles
        for gid in top:
            if str(gid) not in games_out:
                games_out[str(gid)] = subjects[str(gid)]

    stats = {
        "seiyuu_total": len(seiyuu_list),
        "seiyuu_with_bangumi_id": len(persons),
        "seiyuu_with_games": len(seiyuu_games),
        "games_collected": len(games_out),
        "games_with_zh": sum(1 for g in games_out.values() if g["name_cn"]),
        "game_works_total": sum(len(v) for v in seiyuu_games.values()),
    }
    out = {
        "meta": {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "source": "bgm.tv API（/v0/persons/{id}/characters + /v0/subjects/{id}）",
            "key": "games 以 bgm.tv subject id 为键；seiyuu_games 以 AniList staff id 为键",
            "cap": GAME_WORKS_CAP,
            "stats": stats,
        },
        "games": dict(sorted(games_out.items(), key=lambda x: int(x[0]))),
        "seiyuu_games": dict(
            sorted(seiyuu_games.items(), key=lambda x: int(x[0]))
        ),
        "seiyuu_game_roles": dict(
            sorted(seiyuu_game_roles.items(), key=lambda x: int(x[0]))
        ),
    }
    OUT_PATH.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")

    counts = [len(v) for v in seiyuu_games.values()]
    avg = sum(counts) / len(counts) if counts else 0
    print(f"\n完成 -> {OUT_PATH}")
    print(json.dumps(stats, ensure_ascii=False, indent=2))
    print(f"人均游戏 {avg:.1f} 部（截断后，上限 {GAME_WORKS_CAP}）")


if __name__ == "__main__":
    main()
