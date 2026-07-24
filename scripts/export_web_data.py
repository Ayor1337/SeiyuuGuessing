"""从 data/seiyuu.db 导出 Web 游戏专用数据 data/web-seiyuu.json。

导出的字段即游戏所需的最小集，中文名在导出时解析完毕，前端无需再做 join。
数据源变更后重跑：python scripts/build_db.py && python scripts/export_web_data.py
"""

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = ROOT / "data" / "seiyuu.db"
OUT_PATH = ROOT / "data" / "web-seiyuu.json"

# 每部作品导出的角色名上限（控制 bundle 体积，一部多役取前 3 已够提示）
CHARACTERS_CAP = 3


def main() -> None:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        seiyuu_rows = conn.execute(
            """
            SELECT s.*, t.name AS name_zh
            FROM seiyuu s
            LEFT JOIN translations t
              ON t.entity_type = 'seiyuu' AND t.entity_id = s.id AND t.lang = 'zh-Hans'
            ORDER BY s.favourites DESC
            """
        ).fetchall()

        works_rows = conn.execute(
            """
            SELECT w.seiyuu_id, w.rank, a.id, a.title_native, a.title_romaji,
                   a.year, a.format, a.popularity, a.series_id, t.name AS title_zh
            FROM seiyuu_works w
            JOIN anime a ON a.id = w.anime_id
            LEFT JOIN translations t
              ON t.entity_type = 'anime' AND t.entity_id = a.id AND t.lang = 'zh-Hans'
            ORDER BY w.seiyuu_id, w.rank
            """
        ).fetchall()

        # 动画配音角色（悬浮提示用）：译名解析 zh-Hans > 日文原名 > 罗马音，
        # 按 seiyuu_roles.rank（角色人气）排序；anime_id 可能为 NULL，直接排除
        anime_roles_rows = conn.execute(
            """
            SELECT r.seiyuu_id, r.anime_id, r.rank,
                   COALESCE(t.name, c.name_native, c.name) AS char_name
            FROM seiyuu_roles r
            JOIN characters c ON c.id = r.character_id
            LEFT JOIN translations t
              ON t.entity_type = 'character' AND t.entity_id = c.id AND t.lang = 'zh-Hans'
            WHERE r.anime_id IS NOT NULL
            ORDER BY r.seiyuu_id, r.anime_id, r.rank
            """
        ).fetchall()

        # 游戏配音角色（bgm 原名，多为日文；采集时已按 API 顺序排好 rank）
        game_roles_rows = conn.execute(
            """
            SELECT seiyuu_id, game_id, character_name
            FROM seiyuu_game_roles
            ORDER BY seiyuu_id, game_id, rank
            """
        ).fetchall()

        # 游戏作品（bgm.tv id 空间，与动画分开导出；中文名直接取自 games.title_zh）
        game_works_rows = conn.execute(
            """
            SELECT w.seiyuu_id, w.rank, g.id, g.title, g.title_zh,
                   g.year, g.rating_total, g.series_id
            FROM seiyuu_game_works w
            JOIN games g ON g.id = w.game_id
            ORDER BY w.seiyuu_id, w.rank
            """
        ).fetchall()

    finally:
        conn.close()

    # (seiyuu_id, work_id) -> 角色名列表；空数组不导出以省体积（前端按可选字段处理）
    anime_chars: dict[tuple[int, int], list[str]] = {}
    for r in anime_roles_rows:
        key = (r["seiyuu_id"], r["anime_id"])
        names = anime_chars.setdefault(key, [])
        if r["char_name"] and r["char_name"] not in names and len(names) < CHARACTERS_CAP:
            names.append(r["char_name"])

    game_chars: dict[tuple[int, int], list[str]] = {}
    for r in game_roles_rows:
        key = (r["seiyuu_id"], r["game_id"])
        names = game_chars.setdefault(key, [])
        if len(names) < CHARACTERS_CAP:
            names.append(r["character_name"])

    works_by_seiyuu: dict[int, list] = {}
    for w in works_rows:
        entry = {
            "id": w["id"],
            "title_native": w["title_native"],
            "title_romaji": w["title_romaji"],
            "title_zh": w["title_zh"],
            "year": w["year"],
            "format": w["format"],
            "popularity": w["popularity"],
            "series_id": w["series_id"],
        }
        chars = anime_chars.get((w["seiyuu_id"], w["id"]))
        if chars:
            entry["characters"] = chars
        works_by_seiyuu.setdefault(w["seiyuu_id"], []).append(entry)

    # 字段命名对齐 works（title_native/popularity），前端可用同一套展示逻辑
    game_works_by_seiyuu: dict[int, list] = {}
    for w in game_works_rows:
        entry = {
            "id": w["id"],
            "title_native": w["title"],
            "title_zh": w["title_zh"],
            "year": w["year"],
            "popularity": w["rating_total"],
            "series_id": w["series_id"],
        }
        chars = game_chars.get((w["seiyuu_id"], w["id"]))
        if chars:
            entry["characters"] = chars
        game_works_by_seiyuu.setdefault(w["seiyuu_id"], []).append(entry)

    out = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "seiyuu": [
            {
                "id": s["id"],
                "name_romaji": s["name_romaji"],
                "name_native": s["name_native"],
                "name_zh": s["name_zh"],
                "gender": s["gender"],
                "birth_year": s["birth_year"],
                "home_town": s["home_town"],
                "blood_type": s["blood_type"],
                "debut_year": s["debut_year"],
                "favourites": s["favourites"],
                "image": s["image"],
                "url": s["url"],
                "works": works_by_seiyuu.get(s["id"], []),
                "game_works": game_works_by_seiyuu.get(s["id"], []),
            }
            for s in seiyuu_rows
        ],
    }
    OUT_PATH.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")

    zh_names = sum(1 for s in out["seiyuu"] if s["name_zh"])
    enough = sum(1 for s in out["seiyuu"] if len(s["works"]) >= 3)
    with_games = sum(1 for s in out["seiyuu"] if s["game_works"])
    game_total = sum(len(s["game_works"]) for s in out["seiyuu"])
    work_total = sum(len(s["works"]) for s in out["seiyuu"])
    work_chars = sum(1 for s in out["seiyuu"] for w in s["works"] if w.get("characters"))
    game_chars_n = sum(1 for s in out["seiyuu"] for g in s["game_works"] if g.get("characters"))
    print(f"完成 -> {OUT_PATH}")
    print(f"声优 {len(out['seiyuu'])}，有中文名 {zh_names}，作品数≥3 的 {enough}")
    print(f"有游戏作品 {with_games} 人，游戏词条共 {game_total} 条")
    print(
        f"带角色名：动画词条 {work_chars}/{work_total} "
        f"({work_chars / work_total:.0%})，游戏词条 {game_chars_n}/{game_total}"
    )


if __name__ == "__main__":
    main()
