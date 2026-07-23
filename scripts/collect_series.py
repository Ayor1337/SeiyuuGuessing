"""采集动画系列归属：基于 AniList Media relations 聚类，输出 data/series.json。

对 data/seiyuu.db 中全部动画，按 id_in 批量查询 relations（SEQUEL/PREQUEL/
SIDE_STORY/SPIN_OFF/ALTERNATIVE/SUMMARY），用并查集把同一系列的动画聚成一簇，
簇根取最小 anime_id 作为 series_id。只写出簇大小 > 1 的映射；未出现的动画
在 build_db 时默认 series_id = 自身 id（即不与任何作品同系列）。

用法: python scripts/collect_series.py
"""

import json
import sqlite3
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = ROOT / "data" / "seiyuu.db"
OUT_PATH = ROOT / "data" / "series.json"

API_URL = "https://graphql.anilist.co"
HEADERS = {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "User-Agent": "seiyuu-guessing-data-collector/0.1 (personal project)",
}
BATCH = 50
INTERVAL = 2.5

# 视为"同系列"的关系类型（不含 ADAPTATION/SOURCE/CHARACTER/OTHER）
SERIES_RELATIONS = {"SEQUEL", "PREQUEL", "SIDE_STORY", "SPIN_OFF", "ALTERNATIVE", "SUMMARY"}

QUERY = """
query ($ids: [Int]) {
  Page(perPage: 50) {
    media(id_in: $ids, type: ANIME) {
      id
      relations { edges { relationType node { id } } }
    }
  }
}
"""


def graphql(variables: dict, max_retries: int = 5) -> dict:
    body = json.dumps({"query": QUERY, "variables": variables}).encode()
    for attempt in range(max_retries):
        req = urllib.request.Request(API_URL, data=body, headers=HEADERS)
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                payload = json.loads(resp.read())
        except urllib.error.HTTPError as e:
            if e.code == 429:
                wait = min(int(e.headers.get("Retry-After", 60)), 120)
                print(f"  限速，等待 {wait}s")
                time.sleep(wait)
                continue
            if 500 <= e.code < 600 and attempt < max_retries - 1:
                time.sleep(2 ** attempt * 5)
                continue
            raise
        if payload.get("errors"):
            raise RuntimeError(payload["errors"])
        return payload["data"]
    raise RuntimeError("重试耗尽")


class UnionFind:
    def __init__(self):
        self.parent: dict[int, int] = {}

    def find(self, x: int) -> int:
        self.parent.setdefault(x, x)
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]
            x = self.parent[x]
        return x

    def union(self, a: int, b: int) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.parent[max(ra, rb)] = min(ra, rb)


def main() -> None:
    conn = sqlite3.connect(DB_PATH)
    try:
        anime_ids = [r[0] for r in conn.execute("SELECT id FROM anime")]
    finally:
        conn.close()
    print(f"动画 {len(anime_ids)} 部，分 {(len(anime_ids) + BATCH - 1) // BATCH} 批查询")

    uf = UnionFind()
    fetched: set[int] = set()

    def fetch_batch(ids: list[int]) -> None:
        data = graphql({"ids": ids})
        for media in data["Page"]["media"]:
            fetched.add(media["id"])
            for edge in (media.get("relations") or {}).get("edges") or []:
                if edge.get("relationType") in SERIES_RELATIONS and edge.get("node"):
                    uf.union(media["id"], edge["node"]["id"])

    for i in range(0, len(anime_ids), BATCH):
        batch = anime_ids[i : i + BATCH]
        fetch_batch(batch)
        print(f"  第一遍 {min(i + BATCH, len(anime_ids))}/{len(anime_ids)}")
        time.sleep(INTERVAL)

    # 第二遍：补查关系中出现但不在库内的中间节点（如完结篇前篇），打通跨季链
    extra = sorted(set(uf.parent) - set(anime_ids) - fetched)
    print(f"  中间节点 {len(extra)} 部，补查中")
    for i in range(0, len(extra), BATCH):
        fetch_batch(extra[i : i + BATCH])
        time.sleep(INTERVAL)

    # 只保留库内动画、且簇大小 > 1 的映射
    clusters: dict[int, list[int]] = {}
    for aid in anime_ids:
        clusters.setdefault(uf.find(aid), []).append(aid)
    mapping = {
        str(aid): root
        for root, members in clusters.items()
        if len(members) > 1
        for aid in members
    }
    OUT_PATH.write_text(json.dumps(mapping, ensure_ascii=False), encoding="utf-8")
    n_clusters = len({v for v in mapping.values()})
    print(f"完成 -> {OUT_PATH}: {len(mapping)} 部动画分属 {n_clusters} 个系列")


if __name__ == "__main__":
    main()
