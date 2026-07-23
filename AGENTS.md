# 声优猜谜（seiyuu-guessing）

## 项目概述

一个「猜声优」网页小游戏（类似 Wordle 的猜谜玩法）：系统从答案池随机选一位日本声优，玩家输入声优名进行猜测，每次猜测会与答案对比六类线索——性别、出生年份、出身地（都道府县）、血型、出道年份、出演作品——并用绿/黄/灰三色和 ▲▼ 方向箭头提示接近程度。

界面语言为简体中文，代码注释也使用中文，新增代码请保持一致。

## 技术栈与架构

- **前端**：Next.js 15（App Router）+ React 19 + TypeScript + Tailwind CSS 4（经 `@tailwindcss/postcss`）。
- **纯客户端游戏**：无后端 API、无账号体系。`data/web-seiyuu.json`（约 3.2MB）作为 JSON 模块直接被打包进前端 bundle，全部游戏逻辑在浏览器内运行；对局状态存于 `localStorage`（键 `seiyuu-game-v4`）。
- **数据管线（Python，仅标准库）**：`scripts/` 下的脚本从 AniList GraphQL API 与 bgm.tv API 采集数据，经 SQLite 中转后导出前端专用 JSON。游戏运行时**不**访问任何 API 或数据库。

## 构建与运行命令

```bash
npm install
npm run dev      # 开发服务器（默认 http://localhost:3000）
npm run build    # 生产构建
npm run start    # 运行生产构建
```

没有配置测试框架、lint 脚本或 CI。验证改动主要靠 `npm run build`（含 TypeScript 检查）加上手动试玩。

## 数据管线（仅在需要更新题库时使用）

数据源变更后按顺序重跑：

```bash
python scripts/collect_seiyuu.py        # AniList characterMedia → data/seiyuu.json（作品按人气取前 30，断点续传 data/seiyuu.partial.json）
python scripts/collect_translations.py  # bgm.tv + bangumi-data → data/i18n.json（缓存 data/i18n.cache.json 支持续传）
python scripts/collect_games.py         # bgm.tv 游戏出演 → data/games.json（缓存 data/games.cache.json 支持续传；需先有 i18n.json 的 bangumi_id）
python scripts/build_db.py              # seiyuu.json + i18n.json + series.json + games.json → data/seiyuu.db（幂等，全量重建）
python scripts/collect_series.py        # AniList relations 并查集聚类 → data/series.json（系列归属，用于「同系列」黄色提示）
python scripts/export_web_data.py       # seiyuu.db → data/web-seiyuu.json（前端唯一数据源）
```

注意顺序：`collect_games.py` 依赖 `i18n.json`（bangumi_id 映射），放在 `collect_translations.py` 之后；`collect_series.py` 依赖已存在的 `seiyuu.db`，因此首次采集需在 `build_db.py` 之后再跑一次 `build_db.py` 把 series 映射写回数据库。脚本只依赖 Python 标准库（`collect_translations.py` / `collect_games.py` 可选使用 certifi 解决 Windows 证书问题）。`data/bangumi-data.json` 是离线数据文件（AniList→Bangumi id 映射），不由脚本生成。

## 代码结构

- `app/` — Next.js App Router 页面
  - `layout.tsx` — 根布局（`lang="zh-CN"`，深色主题）
  - `page.tsx` — 主页：选择难度、作品范围（全部/仅动画/仅游戏）、性别范围与猜测次数（回填上次选择）；「开始游戏」把设置写入 localStorage 后跳转 `/play`（URL 不带参数）
  - `play/page.tsx` — 薄壳渲染 `GameBoard`；开局设置与对局存档均由 `GameBoard` 从 localStorage 读取
  - `globals.css` — Tailwind 4 入口 + 深色配色
- `lib/` — 纯逻辑，无 React 依赖
  - `data.ts` — 导入 `web-seiyuu.json`，定义 `Seiyuu`/`Work`/`GameWork` 类型、展示名解析（简体中文 > 日文原名 > 罗马音）、难度答案池（easy 前 100 / normal 前 250 / hard 全池，按 AniList 人气降序）；`poolFor` 按难度 + 性别范围 + 作品范围（`WorksFilter`）过滤答案池
  - `game.ts` — `compare(guess, answer, works)` 比对逻辑：精确匹配、年份 ±2 为黄色、同都道府县为黄色、共同出演作品（绿，动画与游戏各自独立求交集）与同系列作品（黄，`series_id` 相同，仅动画）；作品范围为仅动画/仅游戏时屏蔽对应类型的命中
- `components/` — 客户端组件
  - `GameBoard.tsx` — 对局状态机（playing / won / lost / gaveUp），自行从 localStorage 读取开局设置与存档
  - `GuessInput.tsx` — 带键盘导航（↑↓ 循环、Enter 确认、Esc 关闭）的搜索下拉，支持中文/日文/罗马音模糊匹配
  - `GuessTable.tsx` — 猜测结果表格，命中词条高亮并排到最前；游戏词条带「游」徽标
- `scripts/` — Python 数据采集/构建脚本（见上节）
- `data/` — 数据文件：`web-seiyuu.json` 是前端直接 import 的唯一文件；`seiyuu.db`、`seiyuu.json`、`i18n.json`、`series.json`、`games.json` 等是中间产物

## 代码风格约定

- TypeScript `strict: true`，路径别名 `@/*` 指向项目根。
- 注释用中文，倾向解释「为什么」而非复述代码；导出函数/字段常配简短 JSDoc。
- UI 文案全中文；深色主题（`zinc-950` 底、`emerald` 强调色、`amber` 表示「接近」、`sky` 表示「游戏」标记），body 带极淡的 emerald/sky 径向渐变氛围光（globals.css）。
- 组件为函数式 + Hooks；样式全部用 Tailwind 工具类，无额外 CSS 文件。
- 图片用原生 `<img>`（外部 AniList 图片 URL，未配置 `next/image` 域名），并以 `eslint-disable-next-line @next/next/no-img-element` 注释标注。
- 代码中引用了 ESLint 规则（如 `react-hooks/exhaustive-deps`），但项目未安装/配置 ESLint——保留这些注释即可，不要依赖 lint 命令验证。

## 关键设计细节

- **答案池过滤**：`lib/data.ts` 的 `poolFor` 只保留作品数达标（仅动画看动画、仅游戏看游戏、不限看合计，均 ≥3）且有性别和出生年份的声优，保证出题质量；`answerPool` 常量为「不限」模式的全量池。
- **游戏数据（bgm.tv）**：AniList 无游戏类目，游戏出演来自 bgm.tv 的「角色-声优」关联（`/v0/persons/{id}/characters`，`subject_type==4`；注意 `/v0/persons/{id}/subjects` 只有 staff 职位，不含配音出演）。游戏与动画**分开存放**：独立 `games` 表、独立 `game_works` 数组，bgm subject id 与 AniList media id 是不同 id 空间（可能撞号），比对各自独立进行。中文名直接取 bgm `name_cn`，不经翻译管线。已知局限：无 bangumi_id 的声优（约 26 人）无游戏数据；R18 作品声优多用马甲独立条目，出演记录不关联本尊。
- **系列判定**：`series_id` 由 `collect_series.py` 用并查集从 AniList relations（SEQUEL/PREQUEL/SIDE_STORY 等）聚类得出，无系列时等于作品自身 id。游戏暂无系列聚类（`series_id` 预留，等于自身 id），因此「同系列」黄色提示只对动画生效。
- **存档**：两个 localStorage 键（常量定义在 `lib/data.ts`）：`seiyuu-settings-v1` 存开局设置（主页写入、`/play` 读取、主页回填），`seiyuu-game-v5` 存对局状态；修改存档结构时递增版本号，避免旧存档解析出错。
- **无障碍**：难度/次数选择使用原生 radio + `peer sr-only` 模式，支持 Tab/方向键/Enter 操作，新增交互控件请保持键盘可用。

## 安全与注意事项

- 项目无密钥、无环境变量；AniList 与 bgm.tv API 均为匿名公开接口，采集脚本礼貌限速（间隔 0.4s~2.5s，带 429 重试；AniList 当前限速 30 req/min）并声明 User-Agent。
- `data/` 下的 JSON/DB 是生成产物，修改数据请改采集/构建脚本后重跑，不要手改 `web-seiyuu.json`。
- 无测试框架：改动后跑 `npm run build` 确认类型与构建通过，涉及游戏逻辑时手动开一局验证。
