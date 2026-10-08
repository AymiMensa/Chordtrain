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

## 更新歷史 (Date Sorted)
- **2026-10-09 (當前)**:
  - 全難度樂器文字統一為 `空靈鼓、鋼琴、拇指琴、豎琴或鐵琴`。
  - 樂器「吉他」改為「拇指琴」：選單、說明文字與音色合成同步更換；舊 `Guitar` 值自動轉為 `Kalimba`。
  - 拇指琴採金屬簧片撥奏模型（基頻＋高八度＋微量高泛音、約 6ms 起音、自然衰減、4200Hz 低通）；「長笛」早已是空靈鼓，本次不另動。
- **歷史版本**:
  - 移除全站右下角 Made with Manus 標籤按鈕，確保無干擾的訓練環境。
  - 將專案全面更新推送至 GitHub (`AymiMensa/Chordtrain`)，涵蓋所有最新程式碼。
  - 重構 README.md，更新為符合當前 React 封裝 iframe 結構的說明。
  - 重新確認所有素材（包含內嵌 SVG 高音譜記號等）可正常運作，確保系統 100% 穩定。
