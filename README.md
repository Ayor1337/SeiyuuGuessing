# 声优猜谜（seiyuu-guessing）

一个「猜声优」网页小游戏，玩法类似 Wordle：系统从答案池中随机选一位日本声优，玩家输入声优名进行猜测。每次猜测会与答案对比六类线索，并用颜色和方向箭头提示接近程度。

## 玩法

- **六类线索**：性别、出生年份、出身地（都道府县）、血型、出道年份、出演作品。
- **颜色提示**：
  - 绿色：完全命中
  - 黄色：接近（年份相差 ±2、同都道府县、同系列作品等）
  - 灰色：不相关
- **方向箭头**：年份类线索用 ▲▼ 提示答案比猜测更大或更小。
- 开始前可选择**难度**（答案池范围，按 AniList 人气排序：简单前 100 / 普通前 250 / 困难全池）和**猜测次数**。
- 对局状态自动保存在浏览器 `localStorage` 中，刷新页面可继续。

## 技术栈

- **前端**：Next.js 15（App Router）+ React 19 + TypeScript + Tailwind CSS 4
- **纯客户端运行**：无后端 API、无账号体系；`data/web-seiyuu.json` 作为 JSON 模块直接打包进前端 bundle
- **数据管线**：Python（仅标准库），从 AniList GraphQL API 与 bgm.tv API 采集数据，经 SQLite 中转后导出前端专用 JSON

## 快速开始

```bash
npm install
npm run dev      # 开发服务器，默认 http://localhost:3000
npm run build    # 生产构建
npm run start    # 运行生产构建
```

项目没有配置测试框架和 lint，验证改动主要靠 `npm run build`（含 TypeScript 检查）加上手动试玩。

## 目录结构

```
app/            # Next.js 页面（主页选难度、/play 对局页）
components/     # 客户端组件（GameBoard 对局状态机、GuessInput 搜索输入、GuessTable 结果表格）
lib/            # 纯逻辑（data.ts 数据与答案池、game.ts 比对逻辑）
scripts/        # Python 数据采集/构建脚本
data/           # 数据文件（web-seiyuu.json 为前端唯一数据源，其余为中间产物）
```

## 数据管线

游戏运行时不访问任何 API 或数据库。仅在需要更新题库时按顺序重跑以下脚本：

```bash
python scripts/collect_seiyuu.py        # AniList → data/seiyuu.json（支持断点续传）
python scripts/collect_translations.py  # bgm.tv → data/i18n.json（中文译名，支持缓存续传）
python scripts/build_db.py              # 合并 → data/seiyuu.db（幂等，全量重建）
python scripts/collect_series.py        # AniList relations 聚类 → data/series.json
python scripts/build_db.py              # 再跑一次，把 series 映射写回数据库
python scripts/export_web_data.py       # seiyuu.db → data/web-seiyuu.json（前端数据源）
```

脚本只依赖 Python 标准库（`collect_translations.py` 可选使用 certifi 解决 Windows 证书问题），对公开匿名接口礼貌限速。

> 注意：`data/` 下的 JSON/DB 都是生成产物。修改数据请改采集/构建脚本后重跑，不要手改 `web-seiyuu.json`。
