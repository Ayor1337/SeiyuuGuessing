"""把采集到的 JSON 数据构建为 SQLite 数据库 data/seiyuu.db（游戏正式数据源）。

输入:
    data/seiyuu.json   声优基础数据（AniList）
    data/i18n.json     译名表（可选，缺省时跳过译名与 bangumi_id）
    data/games.json    游戏出演数据（可选，bgm.tv；缺省时 games 表为空）

幂等：每次运行全量重建。修改数据结构请改 SCHEMA 并重跑本脚本。

用法:
    python scripts/build_db.py
"""

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SEIYUU_PATH = ROOT / "data" / "seiyuu.json"
I18N_PATH = ROOT / "data" / "i18n.json"
SERIES_PATH = ROOT / "data" / "series.json"
GAMES_PATH = ROOT / "data" / "games.json"
DB_PATH = ROOT / "data" / "seiyuu.db"

SCHEMA = """
CREATE TABLE seiyuu (
    id          INTEGER PRIMARY KEY,  -- AniList staff id
    name_romaji TEXT NOT NULL,
    name_native TEXT,
    gender      TEXT,
    birth_year  INTEGER,
    birth_month INTEGER,
    birth_day   INTEGER,
    age         INTEGER,
    home_town   TEXT,
    blood_type  TEXT,
    debut_year  INTEGER,
    years_active TEXT,                -- JSON 数组，如 [1995, 2020]
    favourites  INTEGER,              -- AniList 人气值，用于难度分级
    image       TEXT,
    url         TEXT,
    bangumi_id  INTEGER
);
CREATE INDEX idx_seiyuu_favourites ON seiyuu(favourites DESC);

CREATE TABLE anime (
    id           INTEGER PRIMARY KEY,  -- AniList media id
    title_romaji TEXT,
    title_native TEXT,
    popularity   INTEGER,
    format       TEXT,                 -- TV / MOVIE / OVA / ONA ...
    year         INTEGER,
    bangumi_id   INTEGER,
    series_id    INTEGER               -- 系列簇根 id，同系列的作品相同；无系列时等于自身 id
);

CREATE TABLE characters (
    id          INTEGER PRIMARY KEY,  -- AniList character id
    name        TEXT,
    name_native TEXT,
    favourites  INTEGER,
    bangumi_id  INTEGER
);

-- 多语言译名：entity_type = seiyuu / character / anime，entity_id = AniList id
CREATE TABLE translations (
    entity_type TEXT NOT NULL,
    entity_id   INTEGER NOT NULL,
    lang        TEXT NOT NULL,        -- zh-Hans / zh-Hant / ...
    name        TEXT NOT NULL,
    PRIMARY KEY (entity_type, entity_id, lang)
) WITHOUT ROWID;
CREATE INDEX idx_translations_lookup ON translations(entity_type, lang);

-- 声优的热门作品（玩家提示用），rank = 1 最热门
CREATE TABLE seiyuu_works (
    seiyuu_id INTEGER NOT NULL REFERENCES seiyuu(id),
    anime_id  INTEGER NOT NULL REFERENCES anime(id),
    rank      INTEGER NOT NULL,
    PRIMARY KEY (seiyuu_id, anime_id)
) WITHOUT ROWID;
CREATE INDEX idx_works_anime ON seiyuu_works(anime_id);

-- 声优配音角色明细（原始关联，备用）
CREATE TABLE seiyuu_roles (
    seiyuu_id    INTEGER NOT NULL REFERENCES seiyuu(id),
    character_id INTEGER NOT NULL REFERENCES characters(id),
    anime_id     INTEGER REFERENCES anime(id),
    role         TEXT,                -- MAIN / SUPPORTING / BACKGROUND
    rank         INTEGER NOT NULL,    -- 角色在该声优下的人气排名
    PRIMARY KEY (seiyuu_id, character_id, anime_id)
) WITHOUT ROWID;

-- 游戏作品（bgm.tv subject，与 anime 表是不同的 id 空间，分开存放不混用）
CREATE TABLE games (
    id           INTEGER PRIMARY KEY,  -- bgm.tv subject id
    title        TEXT,                 -- 原名（多为日文）
    title_zh     TEXT,                 -- bgm name_cn（社区维护的中文名）
    year         INTEGER,              -- 发行年（date 解析）
    rating_total INTEGER,              -- 评分人数，作人气代理
    series_id    INTEGER               -- 预留：默认=自身 id，供将来的游戏系列聚类
);

-- 声优的热门游戏（与 seiyuu_works 平行），rank = 1 最热门
CREATE TABLE seiyuu_game_works (
    seiyuu_id INTEGER NOT NULL REFERENCES seiyuu(id),
    game_id   INTEGER NOT NULL REFERENCES games(id),
    rank      INTEGER NOT NULL,
    PRIMARY KEY (seiyuu_id, game_id)
) WITHOUT ROWID;
CREATE INDEX idx_game_works_game ON seiyuu_game_works(game_id);

-- 声优在游戏中的配音角色名（悬浮提示用，bgm 原名多为日文；rank 按 API 返回顺序）
CREATE TABLE seiyuu_game_roles (
    seiyuu_id      INTEGER NOT NULL REFERENCES seiyuu(id),
    game_id        INTEGER NOT NULL REFERENCES games(id),
    character_name TEXT NOT NULL,
    rank           INTEGER NOT NULL,
    PRIMARY KEY (seiyuu_id, game_id, character_name)
) WITHOUT ROWID;

CREATE TABLE meta (
    key   TEXT PRIMARY KEY,
    value TEXT
);
"""


def main() -> None:
    seiyuu_list = json.loads(SEIYUU_PATH.read_text(encoding="utf-8"))
    i18n = json.loads(I18N_PATH.read_text(encoding="utf-8")) if I18N_PATH.exists() else None
    series = (
        json.loads(SERIES_PATH.read_text(encoding="utf-8")) if SERIES_PATH.exists() else {}
    )
    games_data = (
        json.loads(GAMES_PATH.read_text(encoding="utf-8")) if GAMES_PATH.exists() else None
    )

    if DB_PATH.exists():
        DB_PATH.unlink()
    conn = sqlite3.connect(DB_PATH)
    try:
        conn.executescript(SCHEMA)
        with conn:  # 单事务写入
            # ---- 声优 ----
            conn.executemany(
                """INSERT INTO seiyuu VALUES
                   (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                [
                    (
                        s["id"], s["name_romaji"], s.get("name_native"),
                        s.get("gender"), s.get("birth_year"), s.get("birth_month"),
                        s.get("birth_day"), s.get("age"), s.get("home_town"),
                        s.get("blood_type"), s.get("debut_year"),
                        json.dumps(s["years_active"]) if s.get("years_active") else None,
                        s.get("favourites"), s.get("image"), s.get("url"),
                        (i18n or {}).get("seiyuu", {}).get(str(s["id"]), {}).get("bangumi_id"),
                    )
                    for s in seiyuu_list
                ],
            )

            # ---- 动画（汇总 top_works 与 top_roles 中出现的全部作品）----
            anime: dict[int, dict] = {}
            for s in seiyuu_list:
                for w in s.get("top_works") or []:
                    if w.get("anime_id"):
                        anime[w["anime_id"]] = w
                for r in s.get("top_roles") or []:
                    if r.get("anime_id") and r["anime_id"] not in anime:
                        anime[r["anime_id"]] = {
                            "anime_id": r["anime_id"],
                            "anime": r.get("anime"),
                            "anime_native": r.get("anime_native"),
                        }
            conn.executemany(
                "INSERT INTO anime VALUES (?,?,?,?,?,?,?,?)",
                [
                    (
                        a["anime_id"], a.get("anime"), a.get("anime_native"),
                        a.get("popularity"), a.get("format"), a.get("year"),
                        (i18n or {}).get("anime", {}).get(str(a["anime_id"]), {}).get("bangumi_id"),
                        series.get(str(a["anime_id"]), a["anime_id"]),
                    )
                    for a in anime.values()
                ],
            )

            # ---- 角色 + 配音关系 ----
            characters: dict[int, dict] = {}
            roles_rows = []
            for s in seiyuu_list:
                for rank, r in enumerate(s.get("top_roles") or [], 1):
                    if not r.get("character_id"):
                        continue
                    characters.setdefault(r["character_id"], r)
                    roles_rows.append((
                        s["id"], r["character_id"], r.get("anime_id"),
                        r.get("role"), rank,
                    ))
            conn.executemany(
                "INSERT INTO characters VALUES (?,?,?,?,?)",
                [
                    (
                        c["character_id"], c.get("character"), c.get("character_native"),
                        c.get("character_favourites"),
                        (i18n or {}).get("characters", {}).get(str(c["character_id"]), {}).get("bangumi_id"),
                    )
                    for c in characters.values()
                ],
            )
            conn.executemany(
                "INSERT OR IGNORE INTO seiyuu_roles VALUES (?,?,?,?,?)", roles_rows
            )

            # ---- 热门作品关系 ----
            conn.executemany(
                "INSERT OR IGNORE INTO seiyuu_works VALUES (?,?,?)",
                [
                    (s["id"], w["anime_id"], rank)
                    for s in seiyuu_list
                    for rank, w in enumerate(s.get("top_works") or [], 1)
                    if w.get("anime_id")
                ],
            )

            # ---- 游戏（bgm.tv，可选数据源；系列聚类未做，series_id 暂等于自身 id）----
            if games_data:
                conn.executemany(
                    "INSERT INTO games VALUES (?,?,?,?,?,?)",
                    [
                        (
                            int(gid), g.get("name"), g.get("name_cn"),
                            g.get("year"), g.get("rating_total"), int(gid),
                        )
                        for gid, g in games_data.get("games", {}).items()
                    ],
                )
                conn.executemany(
                    "INSERT OR IGNORE INTO seiyuu_game_works VALUES (?,?,?)",
                    [
                        (int(aid), gid, rank)
                        for aid, gids in games_data.get("seiyuu_games", {}).items()
                        for rank, gid in enumerate(gids, 1)
                    ],
                )
                conn.executemany(
                    "INSERT OR IGNORE INTO seiyuu_game_roles VALUES (?,?,?,?)",
                    [
                        (int(aid), int(gid), name, rank)
                        for aid, game_roles in games_data.get("seiyuu_game_roles", {}).items()
                        for gid, names in game_roles.items()
                        for rank, name in enumerate(names, 1)
                    ],
                )

            # ---- 译名 ----
            if i18n:
                rows = []
                for entity_type, section in (
                    ("seiyuu", i18n.get("seiyuu", {})),
                    ("character", i18n.get("characters", {})),
                    ("anime", i18n.get("anime", {})),
                ):
                    for eid, langs in section.items():
                        for lang, name in langs.items():
                            if lang.startswith("zh") and name:
                                rows.append((entity_type, int(eid), lang, name))
                conn.executemany(
                    "INSERT OR IGNORE INTO translations VALUES (?,?,?,?)", rows
                )

            conn.executemany(
                "INSERT INTO meta VALUES (?,?)",
                [
                    ("generated_at", datetime.now(timezone.utc).isoformat()),
                    ("seiyuu_count", str(len(seiyuu_list))),
                    ("schema", "3"),
                ],
            )

        # ---- 校验输出 ----
        counts = {
            t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
            for t in ("seiyuu", "anime", "characters", "translations", "seiyuu_works", "seiyuu_roles", "games", "seiyuu_game_works", "seiyuu_game_roles")
        }
        print(f"完成 -> {DB_PATH}")
        print(json.dumps(counts, ensure_ascii=False, indent=2))
    finally:
        conn.close()


if __name__ == "__main__":
    main()
