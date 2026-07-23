"""从 AniList GraphQL API 采集日本声优数据，落地为本地 JSON。

用法:
    python scripts/collect_seiyuu.py [--target 500] [--per-page 50] [--max-pages 60]

输出:
    data/seiyuu.json          最终数据（声优列表，按人气降序）
    data/seiyuu.partial.json  断点文件：每完成一人落盘，重跑时自动跳过已完成者

作品数据走 Staff.characterMedia 连接（按作品维度返回，含该声优在片中配音的
角色与 MAIN/SUPPORTING 标记），按人气降序采前 MEDIA_PAGE_CAP 页——早期版本
用 characters 连接只取第 1 页 25 个角色、且每角色只取 media[0]，导致劳模声优
的作品大量缺失。

只依赖标准库。AniList 当前限速 30 req/min，脚本自带限速与 429 重试。
注意：修改 WORKS_CAP / ROLES_CAP 后需删除 data/seiyuu.partial.json 再重跑，
否则断点里的旧记录会原样复用。
"""

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

API_URL = "https://graphql.anilist.co"
OUT_DIR = Path(__file__).resolve().parent.parent / "data"
FINAL_PATH = OUT_DIR / "seiyuu.json"
PARTIAL_PATH = OUT_DIR / "seiyuu.partial.json"

# 每个声优保留的热门作品/角色上限。works 直接进入前端 bundle，30 约 3MB；
# roles 只供译名采集（前 8）与 build_db 备用，50 足够
WORKS_CAP = 30
ROLES_CAP = 50

# AniList 嵌套连接每页上限 25（传更大会被静默截断）
MEDIA_PER_PAGE = 25
# characterMedia 按作品人气降序返回，取前 3 页（75 部）已足够覆盖
# WORKS_CAP=30 的候选（第 4 页起的作品人气更低，不可能挤进前 30），
# 也兜底了偶发的非 ANIME 条目过滤；劳模声优 20 页全采只是浪费请求
MEDIA_PAGE_CAP = 3

LIST_QUERY = """
query ($page: Int, $perPage: Int) {
  Page(page: $page, perPage: $perPage) {
    pageInfo { total currentPage lastPage hasNextPage }
    staff(sort: [FAVOURITES_DESC]) {
      id
      name { full native }
      gender
      dateOfBirth { year month day }
      age
      homeTown
      bloodType
      yearsActive
      favourites
      primaryOccupations
      siteUrl
      image { large }
      characterMedia(page: 1, perPage: 25, sort: [POPULARITY_DESC]) {
        pageInfo { hasNextPage lastPage }
        edges {
          characterRole
          characters { id name { full native } favourites }
          node { id title { romaji native } popularity format seasonYear type }
        }
      }
    }
  }
}
"""

# 补采单个声优的 characterMedia 后续页
MEDIA_QUERY = """
query ($id: Int, $page: Int) {
  Staff(id: $id) {
    characterMedia(page: $page, perPage: 25, sort: [POPULARITY_DESC]) {
      edges {
        characterRole
        characters { id name { full native } favourites }
        node { id title { romaji native } popularity format seasonYear type }
      }
    }
  }
}
"""

REQUEST_INTERVAL = 2.2  # 秒，AniList 当前限速 30 req/min，留余量避免触发 429


def graphql(query: str, variables: dict, max_retries: int = 5) -> dict:
    body = json.dumps({"query": query, "variables": variables}).encode()
    for attempt in range(max_retries):
        req = urllib.request.Request(
            API_URL,
            data=body,
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json",
                # AniList 前置 Cloudflare，默认 Python-urllib UA 会被 403 拦截
                "User-Agent": "seiyuu-guessing-data-collector/0.1 (personal project)",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                payload = json.loads(resp.read())
        except urllib.error.HTTPError as e:
            if e.code == 429:
                wait = min(int(e.headers.get("Retry-After", 60)), 120)
                print(f"  触发限速，等待 {wait}s 后重试 ({attempt + 1}/{max_retries})")
                time.sleep(wait)
                continue
            if 500 <= e.code < 600 and attempt < max_retries - 1:
                time.sleep(2 ** attempt * 5)
                continue
            raise
        payload_errors = payload.get("errors")
        if payload_errors:
            raise RuntimeError(f"GraphQL 错误: {payload_errors}")
        return payload["data"]
    raise RuntimeError("重试次数耗尽，放弃请求")


def normalize(staff: dict, edges: list[dict]) -> dict:
    """把 staff 基础字段 + characterMedia 全部 edge 归一化为输出记录。"""
    dob = staff.get("dateOfBirth") or {}
    years_active = staff.get("yearsActive") or []
    roles = []
    works: dict[int, dict] = {}
    for edge in edges:
        media = edge.get("node") or {}
        # 防御：characterMedia 理论上全是 ANIME，漏进漫画/小说直接跳过
        if media.get("type") != "ANIME":
            continue
        title = media.get("title") or {}
        anime_id = media.get("id")
        # 一个 edge 是一部作品，characters 是该声优在片中配音的全部角色（一人多役）
        # 注意 characters 里可能混入 None（AniList 数据空洞）
        for node in edge.get("characters") or []:
            if not node:
                continue
            roles.append({
                "character_id": node.get("id"),
                "character": (node.get("name") or {}).get("full"),
                "character_native": (node.get("name") or {}).get("native"),
                "character_favourites": node.get("favourites"),
                "anime_id": anime_id,
                "anime": title.get("romaji"),
                "anime_native": title.get("native"),
                "role": edge.get("characterRole"),  # MAIN / SUPPORTING / BACKGROUND
            })
        # 聚合热门作品：同一动画去重，保留人气最高的一条
        if anime_id and (
            anime_id not in works
            or (media.get("popularity") or 0) > works[anime_id]["popularity"]
        ):
            works[anime_id] = {
                "anime_id": anime_id,
                "anime": title.get("romaji"),
                "anime_native": title.get("native"),
                "popularity": media.get("popularity"),
                "format": media.get("format"),      # TV / MOVIE / OVA ...
                "year": media.get("seasonYear"),
            }
    top_works = sorted(works.values(), key=lambda w: -(w["popularity"] or 0))[:WORKS_CAP]
    # roles 按角色人气降序，与旧版 characters(FAVOURITES_DESC) 语义一致
    top_roles = sorted(roles, key=lambda r: -(r["character_favourites"] or 0))[:ROLES_CAP]
    return {
        "id": staff["id"],
        "name_romaji": (staff.get("name") or {}).get("full"),
        "name_native": (staff.get("name") or {}).get("native"),
        "gender": staff.get("gender"),
        "birth_year": dob.get("year"),
        "birth_month": dob.get("month"),
        "birth_day": dob.get("day"),
        "age": staff.get("age"),
        "home_town": staff.get("homeTown"),
        "blood_type": staff.get("bloodType"),
        "debut_year": years_active[0] if years_active else None,
        "years_active": years_active or None,
        "favourites": staff.get("favourites"),
        "image": (staff.get("image") or {}).get("large"),
        "url": staff.get("siteUrl"),
        "top_roles": top_roles,
        "top_works": top_works,
    }


def fetch_all_media_edges(staff: dict) -> list[dict]:
    """取某声优 characterMedia 的前 MEDIA_PAGE_CAP 页（第 1 页已在列表查询里拿到）。"""
    cm = staff.get("characterMedia") or {}
    edges = list(cm.get("edges") or [])
    last_page = min((cm.get("pageInfo") or {}).get("lastPage") or 1, MEDIA_PAGE_CAP)
    for page in range(2, last_page + 1):
        data = graphql(MEDIA_QUERY, {"id": staff["id"], "page": page})
        more = ((data.get("Staff") or {}).get("characterMedia") or {}).get("edges")
        edges.extend(more or [])
        time.sleep(REQUEST_INTERVAL)
    return edges


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", type=int, default=500, help="目标声优数量")
    parser.add_argument("--per-page", type=int, default=50, help="每页 staff 数（≤50）")
    parser.add_argument("--max-pages", type=int, default=60, help="最多翻页数（防爆保险）")
    args = parser.parse_args()

    OUT_DIR.mkdir(exist_ok=True)

    # 断点恢复：partial 里只存「作品已采齐」的完整记录，中断的下次整体重采
    done: dict[int, dict] = {}
    if PARTIAL_PATH.exists():
        for rec in json.loads(PARTIAL_PATH.read_text(encoding="utf-8")):
            done[rec["id"]] = rec
        if done:
            print(f"断点恢复: 已完成 {len(done)} 人，将跳过")

    collected: list[dict] = []  # 按人气顺序的最终记录（done 记录或待补采 raw staff）
    seen: set[int] = set()
    scanned = 0

    # ---- 阶段 1: 翻页拉 staff 列表（含每人 characterMedia 第 1 页）----
    for page in range(1, args.max_pages + 1):
        data = graphql(LIST_QUERY, {"page": page, "perPage": args.per_page})
        page_info = data["Page"]["pageInfo"]
        staff_list = data["Page"]["staff"]
        scanned += len(staff_list)

        for staff in staff_list:
            if staff["id"] in seen:
                continue
            seen.add(staff["id"])
            if "Voice Actor" not in (staff.get("primaryOccupations") or []):
                continue
            # 只要日本声优：无日文名的多为英配演员，一并剔除
            if not (staff.get("name") or {}).get("native"):
                continue
            if staff["id"] in done:
                collected.append(done[staff["id"]])
            else:
                collected.append(staff)

        print(
            f"第 {page}/{page_info['lastPage']} 页: "
            f"本页 {len(staff_list)} 人，累计声优 {len(collected)}/{args.target}"
        )
        if len(collected) >= args.target or not page_info["hasNextPage"]:
            break
        time.sleep(REQUEST_INTERVAL)

    # 截到 target 再补采，避免给超出目标的声优浪费请求
    # （done 记录有 top_works 字段，raw staff 没有，借此区分）
    collected = collected[: args.target]
    pending = [s for s in collected if "top_works" not in s]

    # ---- 阶段 2: 逐人补采 characterMedia 后续页，完成一人落盘一次 ----
    for i, staff in enumerate(pending, 1):
        cm = staff.get("characterMedia") or {}
        total_pages = (cm.get("pageInfo") or {}).get("lastPage") or 1
        edges = fetch_all_media_edges(staff)
        rec = normalize(staff, edges)
        done[staff["id"]] = rec
        PARTIAL_PATH.write_text(
            json.dumps(list(done.values()), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        name = rec["name_native"] or rec["name_romaji"]
        print(
            f"补采 {i}/{len(pending)}: {name} "
            f"(采 {min(total_pages, MEDIA_PAGE_CAP)}/{total_pages} 页，"
            f"作品 {len(rec['top_works'])})"
        )
        time.sleep(REQUEST_INTERVAL)

    # collected 里的 raw staff 此时都已在 done 中有完整记录
    final = [done[s["id"]] for s in collected][: args.target]
    FINAL_PATH.write_text(
        json.dumps(final, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    # 数据质量摘要
    total = len(final)
    missing = {
        "gender": sum(1 for s in final if not s["gender"]),
        "birth_year": sum(1 for s in final if not s["birth_year"]),
        "debut_year": sum(1 for s in final if not s["debut_year"]),
        "home_town": sum(1 for s in final if not s["home_town"]),
        "blood_type": sum(1 for s in final if not s["blood_type"]),
        "top_roles": sum(1 for s in final if not s["top_roles"]),
    }
    works_count = [len(s["top_works"]) for s in final]
    print(f"\n完成: 扫描 {scanned} 名 staff，采集声优 {total} 人 -> {FINAL_PATH}")
    print("字段缺失统计:", json.dumps(missing, ensure_ascii=False))
    print(
        f"作品数: ≥{WORKS_CAP}(顶到上限) {sum(1 for c in works_count if c >= WORKS_CAP)} 人，"
        f"<3 {sum(1 for c in works_count if c < 3)} 人，"
        f"平均 {sum(works_count) / total:.1f}"
    )
    if total < args.target:
        print(f"警告: 未达到目标 {args.target}，可增大 --max-pages 重跑", file=sys.stderr)


if __name__ == "__main__":
    main()
