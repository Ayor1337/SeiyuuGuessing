"""采集中文译名，生成 data/i18n.json（多语言可扩展结构）。

数据来源:
- 动画中文名 + AniList→Bangumi id 映射: bangumi-data (data/bangumi-data.json，离线)
- 声优/角色中文名: bgm.tv API（人物/角色 infobox 的「简体中文名」「中文名」字段）

匹配链路:
  动画: AniList anime_id → bangumi-data sites.aniList → bangumi subject id
  角色: /v0/subjects/{id}/characters 中按「出演者名 == 声优日文名」+ 角色名双重匹配
  声优: 角色匹配命中后取该出演者的 Bangumi person id

用法:
    python scripts/collect_translations.py [--interval 0.4] [--limit N]

输出:
    data/i18n.json        最终译名表 {seiyuu, characters, anime} 三节，按 AniList id 索引
    data/i18n.cache.json  API 响应缓存，中断后重跑自动续传
"""

import argparse
import json
import ssl
import time
import unicodedata
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SEIYUU_PATH = ROOT / "data" / "seiyuu.json"
BGM_DATA_PATH = ROOT / "data" / "bangumi-data.json"
CACHE_PATH = ROOT / "data" / "i18n.cache.json"
OUT_PATH = ROOT / "data" / "i18n.json"

API_BASE = "https://api.bgm.tv"
HEADERS = {
    "Accept": "application/json",
    "User-Agent": "seiyuu-guessing/0.1 (personal project, data collection)",
}
ZH_KEYS = ("简体中文名", "中文名")
# 译名只采集每个声优前 N 个代表角色：角色译名游戏不展示，采集全部角色 API 开销大、价值低
ROLES_SCAN = 8

# Windows 系统证书库对 bgm.tv 的 Let's Encrypt 中间证书校验失败，优先用 certifi
try:
    import certifi

    SSL_CTX = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    SSL_CTX = ssl.create_default_context()


def norm(s: str | None) -> str:
    """名字归一化：NFKC + 去空白，用于跨站日文名比对。"""
    if not s:
        return ""
    return "".join(unicodedata.normalize("NFKC", s).split())


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


def extract_zh(infobox: list | None) -> str | None:
    for entry in infobox or []:
        if entry.get("key") in ZH_KEYS and isinstance(entry.get("value"), str):
            return entry["value"]
    return None


class Cache:
    def __init__(self, path: Path):
        self.path = path
        if path.exists():
            self.data = json.loads(path.read_text(encoding="utf-8"))
        else:
            self.data = {"subjects": {}, "persons": {}, "characters": {}}

    def save(self) -> None:
        self.path.write_text(
            json.dumps(self.data, ensure_ascii=False), encoding="utf-8"
        )


def build_anime_index(bgm_data: dict) -> tuple[dict, dict]:
    """返回 (anilist_id → item, 归一化日文标题 → item) 两个索引。"""
    by_anilist, by_title = {}, {}
    for item in bgm_data["items"]:
        for site in item.get("sites") or []:
            if site.get("site") == "aniList":
                by_anilist[str(site["id"])] = item
        by_title.setdefault(norm(item.get("title")), item)
    return by_anilist, by_title


def anime_zh(item: dict) -> tuple[str | None, str | None, str | None]:
    tt = item.get("titleTranslate") or {}
    zh_hans = (tt.get("zh-Hans") or [None])[0]
    zh_hant = (tt.get("zh-Hant") or [None])[0]
    bgm_id = next(
        (s["id"] for s in item.get("sites") or [] if s.get("site") == "bangumi"), None
    )
    return zh_hans, zh_hant, bgm_id


def pick_by_char_name(candidates: list, char_native: str) -> dict | None:
    """在候选角色条目中按日文名消歧：精确 > 包含，要求唯一。"""
    target = norm(char_native)
    if not target:
        return candidates[0] if len(candidates) == 1 else None
    exact = [c for c in candidates if norm(c["name"]) == target]
    if len(exact) == 1:
        return exact[0]
    if exact:
        candidates = exact
    contain = [
        c
        for c in candidates
        if target in norm(c["name"]) or norm(c["name"]) in target
    ]
    if len(contain) == 1:
        return contain[0]
    return None


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--interval", type=float, default=0.4, help="请求间隔秒数")
    parser.add_argument("--limit", type=int, default=0, help="只处理前 N 名声优（测试用）")
    args = parser.parse_args()

    seiyuu_list = json.loads(SEIYUU_PATH.read_text(encoding="utf-8"))
    if args.limit:
        seiyuu_list = seiyuu_list[: args.limit]
    bgm_data = json.loads(BGM_DATA_PATH.read_text(encoding="utf-8"))
    by_anilist, by_title = build_anime_index(bgm_data)
    cache = Cache(CACHE_PATH)

    # ---- 阶段 A: 动画离线匹配（覆盖 top_roles 与 top_works 中出现的全部动画） ----
    anime_out: dict[str, dict] = {}
    need_subjects: dict[str, str] = {}  # anilist_anime_id → bangumi subject id（仅角色匹配需要）
    unmatched_anime: set[str] = set()
    anime_ids: set[int] = set()
    role_anime_ids: set[int] = set()
    native_of: dict[int, str] = {}
    for s in seiyuu_list:
        for r in s["top_roles"][:ROLES_SCAN]:
            if r.get("anime_id"):
                anime_ids.add(r["anime_id"])
                role_anime_ids.add(r["anime_id"])
                native_of.setdefault(r["anime_id"], r.get("anime_native"))
        for w in s.get("top_works") or []:
            if w.get("anime_id"):
                anime_ids.add(w["anime_id"])
                native_of.setdefault(w["anime_id"], w.get("anime_native"))
    for aid in sorted(anime_ids):
        item = by_anilist.get(str(aid)) or by_title.get(norm(native_of.get(aid)))
        if not item:
            unmatched_anime.add(str(aid))
            continue
        zh_hans, zh_hant, bgm_id = anime_zh(item)
        anime_out[str(aid)] = {
            "zh-Hans": zh_hans,
            "zh-Hant": zh_hant,
            "bangumi_id": int(bgm_id) if bgm_id else None,
        }
        if bgm_id and aid in role_anime_ids:
            need_subjects[str(aid)] = str(bgm_id)
    print(f"阶段A: 动画 {len(anime_ids)} 部，离线匹配 {len(anime_out)}，未匹配 {len(unmatched_anime)}")

    # ---- 阶段 B: 抓取条目角色表 ----
    todo_subjects = sorted(set(need_subjects.values()) - set(cache.data["subjects"]))
    print(f"阶段B: 需抓取条目角色表 {len(todo_subjects)} 部（已缓存 {len(cache.data['subjects'])}）")
    for i, bgm_id in enumerate(todo_subjects, 1):
        raw = http_get(f"/v0/subjects/{bgm_id}/characters") or []
        cache.data["subjects"][bgm_id] = [
            {
                "id": c["id"],
                "name": c.get("name"),
                "actors": [
                    {"id": a["id"], "name": a.get("name")}
                    for a in c.get("actors") or []
                ],
            }
            for c in raw
        ]
        if i % 25 == 0 or i == len(todo_subjects):
            cache.save()
            print(f"  条目角色表 {i}/{len(todo_subjects)}")
        time.sleep(args.interval)
    cache.save()

    # ---- 阶段 C: 角色/声优离线匹配 ----
    char_match: dict[str, int] = {}     # anilist char id → bangumi char id
    seiyuu_match: dict[str, int] = {}   # anilist staff id → bangumi person id
    for s in seiyuu_list:
        s_norm = norm(s.get("name_native"))
        for role in s["top_roles"][:ROLES_SCAN]:
            bgm_id = need_subjects.get(str(role.get("anime_id")))
            if not bgm_id or str(role.get("character_id")) in char_match:
                continue
            chars = cache.data["subjects"].get(bgm_id) or []
            # 优先按出演者名匹配（最可靠）
            cands = [
                c
                for c in chars
                if any(norm(a["name"]) == s_norm for a in c["actors"])
            ]
            target = pick_by_char_name(cands, role.get("character_native")) if cands else None
            if not target:
                # 兜底：仅按角色名匹配
                target = pick_by_char_name(chars, role.get("character_native"))
                if target and s["id"] and len(target["actors"]) == 1:
                    seiyuu_match[str(s["id"])] = target["actors"][0]["id"]
            if target:
                char_match[str(role["character_id"])] = target["id"]
                for a in target["actors"]:
                    if norm(a["name"]) == s_norm:
                        seiyuu_match[str(s["id"])] = a["id"]
    print(
        f"阶段C: 角色匹配 {len(char_match)}/"
        f"{len({r['character_id'] for s in seiyuu_list for r in s['top_roles'][:ROLES_SCAN]})}，"
        f"声优匹配 {len(seiyuu_match)}/{len(seiyuu_list)}"
    )

    # ---- 阶段 D: 抓取人物/角色详情取中文名 ----
    todo_persons = sorted(set(seiyuu_match.values()) - {int(k) for k in cache.data["persons"]})
    print(f"阶段D1: 需抓取人物 {len(todo_persons)}")
    for i, pid in enumerate(todo_persons, 1):
        d = http_get(f"/v0/persons/{pid}") or {}
        cache.data["persons"][str(pid)] = {"name": d.get("name"), "zh": extract_zh(d.get("infobox"))}
        if i % 25 == 0 or i == len(todo_persons):
            cache.save()
            print(f"  人物 {i}/{len(todo_persons)}")
        time.sleep(args.interval)
    cache.save()

    todo_chars = sorted(set(char_match.values()) - {int(k) for k in cache.data["characters"]})
    print(f"阶段D2: 需抓取角色 {len(todo_chars)}")
    for i, cid in enumerate(todo_chars, 1):
        d = http_get(f"/v0/characters/{cid}") or {}
        cache.data["characters"][str(cid)] = {"name": d.get("name"), "zh": extract_zh(d.get("infobox"))}
        if i % 50 == 0 or i == len(todo_chars):
            cache.save()
            print(f"  角色 {i}/{len(todo_chars)}")
        time.sleep(args.interval)
    cache.save()

    # ---- 阶段 E: 汇总输出 ----
    seiyuu_out = {
        sid: {
            "zh-Hans": cache.data["persons"].get(str(pid), {}).get("zh"),
            "bangumi_id": pid,
        }
        for sid, pid in sorted(seiyuu_match.items(), key=lambda x: int(x[0]))
    }
    char_out = {
        cid: {
            "zh-Hans": cache.data["characters"].get(str(bid), {}).get("zh"),
            "bangumi_id": bid,
        }
        for cid, bid in sorted(char_match.items(), key=lambda x: int(x[0]))
    }
    stats = {
        "seiyuu_total": len(seiyuu_list),
        "seiyuu_matched": len(seiyuu_out),
        "seiyuu_zh": sum(1 for v in seiyuu_out.values() if v["zh-Hans"]),
        "characters_matched": len(char_out),
        "characters_zh": sum(1 for v in char_out.values() if v["zh-Hans"]),
        "anime_matched": len(anime_out),
        "anime_zh_hans": sum(1 for v in anime_out.values() if v["zh-Hans"]),
        "anime_unmatched": len(unmatched_anime),
    }
    out = {
        "meta": {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "languages": ["zh-Hans", "zh-Hant"],
            "sources": [
                "bangumi-data: 动画译名与 AniList→Bangumi id 映射",
                "bgm.tv API: 声优/角色简体中文名",
            ],
            "key": "各节均以 AniList id 为键",
            "stats": stats,
        },
        "seiyuu": seiyuu_out,
        "characters": char_out,
        "anime": anime_out,
    }
    OUT_PATH.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n完成 -> {OUT_PATH}")
    print(json.dumps(stats, ensure_ascii=False, indent=2))
    unmatched_seiyuu = [
        (s["name_native"] or s["name_romaji"])
        for s in seiyuu_list
        if str(s["id"]) not in seiyuu_match
    ]
    if unmatched_seiyuu:
        print(f"未匹配声优({len(unmatched_seiyuu)}): {'、'.join(unmatched_seiyuu[:20])}...")


if __name__ == "__main__":
    main()
