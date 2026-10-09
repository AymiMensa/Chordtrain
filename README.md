# 韶韻音樂學院 馬老師 開發和弦訓練器

這是一個用於學習和弦進行與樂理視覺化的訓練工具。本專案將和弦結構與進行關聯視覺化，透過互動式的訓練操作，幫助學習者記憶並理解和弦。

**授權：韶韻音樂學院 馬老師**

## 相關連結
- 線上遊戲：[https://aymimensa.github.io/Chordtrain/](https://aymimensa.github.io/Chordtrain/)
- 原始參考：[https://chord-trees.nathanielschool.com/](https://chord-trees.nathanielschool.com/)
- 姊妹專案（D3.js 樂理心智圖）：[https://aymimensa.github.io/ChordTree/](https://aymimensa.github.io/ChordTree/)

## 專案簡介
本專案為全新的架構設計，將原本的應用封裝在獨立的互動 HTML 檔案中。使用者可以透過直覺的視覺化介面操作、學習和弦的推導與結構。本專案結合了 Vite、React 進行開發與伺服，主要應用程式已全面更新為目前的最新版本，確保運行效能與流暢的訓練體驗。

## 架構圖 (Architecture Diagram)
- **前端框架 (Frontend Shell)**: Vite + React
  - `client/src/App.tsx` & `main.tsx`: 系統進入點。
  - `client/src/pages/Home.tsx`: 核心頁面，透過 `iframe` 嵌入實際互動程式碼。
- **核心互動邏輯 (Core Application)**:
  - `client/public/KIMIchord_trees_fixed.html`: 包含了所有核心的互動視覺化、和弦樹狀結構渲染、鋼琴鍵盤 UI、運算邏輯與樣式（包含多種主題如 Earth, Morandi, Ocean, Dark 等）。

## 專案結構
```text
Chord_Train/
├── client/
│   ├── public/
│   │   └── KIMIchord_trees_fixed.html  # 核心互動程式 (包含 JS, CSS, HTML 邏輯)
│   └── src/
│       ├── pages/
│       │   └── Home.tsx                # 首頁組件，包含 iframe
│       ├── App.tsx                     # 路由與 Provider 設定
│       └── main.tsx                    # React 進入點
├── package.json                        # 依賴管理
└── vite.config.ts                      # Vite 構建與部署配置
```

## 訓練操作
1. **啟動訓練**：進入應用後，畫面會展示互動式和弦樹與視覺化工作台。
2. **和弦點擊與聽寫**：點擊畫面上不同的和弦節點，右側/下方的視覺化介面與虛擬鍵盤會即時重繪出和弦的組成音，協助將聽覺與視覺結構結合。
3. **音階與調性切換**：利用上方的音階導航條可以切換不同的調性進行綜合練習。
4. **介面主題切換**：可透過系統設定切換不同的視覺主題（Earth/Morandi/Ocean/Dark），在長時間訓練下保護眼睛並提供最佳對比。

## 部署方式

本專案**沒有 CI/CD**（無 GitHub Actions）。線上網站由 `gh-pages` 分支提供，
該分支存放的是**扁平化的 build 產物**（等同 `dist/public/*` 的內容），而非原始碼。
因此每次改動都需要手動部署，且必須同時更新兩個分支：

```bash
# 1. 先建置產物
npx vite build

# 2. 提交原始碼至 main
git add -A && git commit -m "..."
git push origin main

# 3. 用臨時 worktree 取出 gh-pages，以 build 產物覆蓋
#    務必排除 dist/public/.git（詳見下方注意事項），否則會毀掉 worktree 指標檔
git worktree add --detach ../_gh_pages_deploy origin/gh-pages
Get-ChildItem dist\public -Force | Where-Object { $_.Name -ne '.git' } |
  ForEach-Object { Copy-Item $_.FullName ..\_gh_pages_deploy\ -Recurse -Force }

# 4. 提交並推送部署版本
cd ..\_gh_pages_deploy
git add -A
git commit -m "Deploy: ..."
git push origin HEAD:gh-pages

# 5. 驗證遠端已更新，並移除臨時 worktree
cd ..\Chord_Train
git fetch origin --prune
git worktree remove --force ../_gh_pages_deploy
```

> 注意事項：
> - **切勿直接 `Copy-Item dist\public\*`**：`dist/public/` 底下殘留一個舊部署方式遺留的
>   `.git` **目錄**（內含 gh-pages 提交歷史、**無 remote**）。用 `-Recurse` 複製會用該目錄
>   蓋掉 worktree 的 `.git` 指標檔，導致 `fatal: invalid gitfile format` 而無法操作 worktree。
>   複製前必須以 `.Name -ne '.git'` 排除（Vite 的 `emptyOutDir` 會保留 `.git`，因此每次 build 都在）。
> - 本機 build 產物使用 LF 換行，而 `gh-pages` 上的檔案是 CRLF，
>   `git add -A` 前會看到多個檔案的「換行符差異」；
>   提交後請用 `git diff --numstat` 確認真正有內容變更的檔案是否為預期範圍。
> - `dist/` 已在 `.gitignore` 中排除，build 產物只存在本機，不會進版控。
> - GitHub Pages 佈建通常需要 1–3 分鐘；若瀏覽器有快取，強制重新整理（Ctrl+F5）即可。

## 更新歷史 (Date Sorted)

- **2026-10-09 (當前)**:
  - 全難度樂器文字統一為 `空靈鼓、鋼琴、拇指琴、豎琴或鐵琴`。
  - 樂器「吉他」改為「拇指琴」：選單、說明文字與音色合成同步更換；舊 `Guitar` 值自動轉為 `Kalimba`。
  - 拇指琴採金屬簧片撥奏模型（基頻＋高八度＋微量高泛音、約 6ms 起音、自然衰減、4200Hz 低通）；空靈鼓採敲擊式金屬共鳴模型（基頻＋2.02× 八度＋3.01× 高泛音、約 4ms 起音、3600Hz 低通，泛音較基頻更快衰減，尾音溫潤不刺耳）。
  - 舊樂器名稱改由單一 `normalizeInstrument()` 統一轉換：`Flute`／長笛 → `TongueDrum`（空靈鼓）、`Guitar`／吉他 → `Kalimba`（拇指琴）。轉換點涵蓋初始化、`playNote()` 與樂器選單的 `change` 事件，移除先前散落三處、且未處理 `Flute` 的權宜判斷。
  - 由於樂器選單是各難度共用的單一控制項，上述文字與音色變更對初學者、調內、和弦種類圖與隨堂考試四種難度一致生效。
  - 修正節拍器與和弦進行「差半拍」的固定相位差：`startMetronome()` 會先呼叫 `stopMetronome()` 拆除共用時脈，使後啟動的節拍器一律以「當下」為新原點，與先播放的和弦進行各持無關原點。現由 `stopBeatTimeline()` 停止時保留原點至 `beatTimelinePreserved`，`ensureBeatTimeline()` 優先沿用執行中原點、其次沿用保留原點（速度未變時），木魚與 Groove 兩條排程改走 `acquireBeatTimelineForPlayback()`；原本從未被呼叫的 `adoptBeatTimeline()` 成為沿用原點的實際路徑。
  - 部署文件補上必須排除 `dist/public/.git` 的警告：`Copy-Item -Recurse` 會用該目錄蓋掉 worktree 的 `.git` 指標檔，造成 `fatal: invalid gitfile format`。
  - 部署至 `gh-pages`（`f5dd045` → `d79842f`），同步本次節拍同步修正至線上網站。
- **歷史版本**:
  - 移除全站右下角 Made with Manus 標籤按鈕，確保無干擾的訓練環境。
  - 將專案全面更新推送至 GitHub (`AymiMensa/Chordtrain`)，涵蓋所有最新程式碼。
  - 重構 README.md，更新為符合當前 React 封裝 iframe 結構的說明。
  - 重新確認所有素材（包含內嵌 SVG 高音譜記號等）可正常運作，確保系統 100% 穩定。
  - 手動部署至 `gh-pages`：以 `dist/public/*` 全量覆蓋該分支內容（`fae5a03` → `0c6af20`），同步本次樂器正規化重構至線上網站。
