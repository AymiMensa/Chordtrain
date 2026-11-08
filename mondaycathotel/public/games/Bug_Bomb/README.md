# Bomber Arena Ultimate

一款支援 PC、手機、平板、控制器、多種 AI 模式、完全自適應畫面、60FPS 流暢運行的現代炸彈超人。
採用原生 Vanilla JavaScript + Canvas 2D 打造的高效能遊戲引擎。

## 版本更新歷史

* **2026-07-10: Phase 1 核心引擎 MVP**
  * 從 React 框架全面轉移至純原生 JS (Vite)。
  * 打造自定義 `GameEngine` 處理 `requestAnimationFrame` 迴圈。
  * 打造 `GridSystem` 進行精準的網格與像素座標轉換。
  * 打造 `CanvasRenderer` 並設定 `13:11` 的自適應縮放機制。
  * 實作 `Player` 的四方向移動與地圖牆壁碰撞。
* **2026-07-10: Phase 2 炸彈與爆炸系統**
  * 實作炸彈放置、3秒倒數機制。
  * 實作十字範圍的火焰蔓延判定，並會被硬磚塊阻擋。
  * 實作火焰燒毀軟磚塊的邏輯。
  * 實作連鎖引爆機制 (Chain Explosion)。
* **2026-07-10: Phase 3 視覺重製**
  * 將死板的全黑背景升級為高級漸層星空與發光網格。
  * 硬磚塊加入立體漸層與真實陰影 (Drop Shadow)。
  * 軟磚塊改為高科技霓虹發光能量方塊。
  * 主角升級為帶有發光光環、並具備移動傾斜 (Tilt) 微動畫的高科技角色。
  * 炸彈加入加速脈衝閃爍光暈。
  * 爆炸特效升級為高溫雷射疊加特效 (Bloom)。
  * 修正 `roundRect` 導致舊瀏覽器當機的 Bug。
  * 輸入管理器升級為偵測 `e.code` 與 `e.key` 雙重保險，完全避開輸入法干擾。
* **2026-07-10: V1.0 完整開發完成**
  * 實作完整遊戲流程控制 (首頁選單、Victory、Game Over 狀態切換)。
  * 實作掉落道具系統 (ItemManager)，支援火力、炸彈數、跑速增益。
  * 實作基礎史萊姆怪物 AI (MonsterManager) 與碰撞死亡判定。
  * 實作高階電腦對手 AI (Bot)，搭配 DangerMap 即時計算危險區域，自動躲避炸彈並主動尋找磚塊爆破。
  * 完整玻璃擬物化 (Glassmorphism) HUD 與自適應全螢幕遮罩。
* **2026-07-10: V1.0.1 修正載入問題**
  * 修正 `start.bat` 指向錯誤的檔案名稱，解決玩家直接打開 HTML 時因為瀏覽器 CORS 政策導致 JavaScript 模組無法載入，造成遊戲進入畫面按鍵無反應的問題。
  * 將伺服器預設 Port 從 8080 更改為 8899，避免與其他應用程式衝突。
* **2026-07-11: V1.0.2 AI 升級與高質感動態向量素材**
  * **AI 尋路全面進化**：Bot 現在已配備 BFS (廣度優先搜尋) 演算法，會主動追殺怪物，並能聰明地繞過所有障礙物，徹底解決以往容易「卡牆」、「放置炸彈後發呆卡死」以及「被雙炸彈包夾時放棄求生」的致命邏輯錯誤。
  * **自動微調過彎**：AI 在逃跑與追殺時，如果遇到轉角沒對齊網格，會自動透過微調次要方向鍵進行完美過彎，大幅提升生存率。
  * **高解析向量素材**：捨棄了舊有靜態白底圖片，全面採用動態生成的 SVG 向量圖。具備完美去背、發光特效，以及能隨方向轉換的 4 面向動態視覺效果，符合最高標準的 UI/UX 美學。
* **2026-07-13: V1.1 UI自適應與Boss怪物強化**
  * **道具與狀態系統完善**：實作所有核心道具效果，如跑速、火力、炸彈增加、遠端遙控、護盾、冰凍炸彈、穿透火焰等。
  * **AAA 級道具實作**：加入磁鐵(吸引道具)、地雷(隱形陷阱)、追蹤炸彈(自動滑行尋敵)、分身假人(視覺干擾)。
  * **自適應UI優化**：完美支援 16:9 / 21:9 橫式與直式切換，修復小螢幕手機的選單超框與觸控按鈕重疊問題。
  * **地圖環境屬性**：新增冰原與火山地圖，冰原具備滑行效果，火山毒水無護盾會即死。
  * **特殊形狀爆炸**：支援不同爆炸形狀，如十字形、X形、圓形大範圍爆炸，與真正的全畫面核爆。
  * **Boss 技能強化**：DragonBoss 完整實作 10 種不同屬性 Boss 技能（雷射、閃現背刺、鑽地、大範圍爆破等），並加入死亡超級爆炸。
* **2026-07-14: V1.2 Bug 修復與細節完善**
  * 修正 Vite 編譯目標不支援 top-level await 導致的建置失敗問題，並新增 `vite.config.js`。
  * 修復過關後「勝利畫面」未正確隱藏，導致下一關卡住的問題。
  * 修復怪物與電腦 AI 不會追蹤玩家「分身道具 (Clone)」的 Bug，使分身具有實質誘敵功能。
  * 從網路引入免費遊戲背景配樂 (BGM)，並修正 Web Audio API 播放邏輯。
  * 修復電腦 AI 放完最大數量炸彈後卡死發呆的問題，現在會正常躲避與移動。
  * 移除 3D 背景粒子的自轉效果，解決玩家產生整個畫面持續往左移動的視覺錯覺。
  * 導入命數機制，預設給予 `3/3` 條命，吃到生命道具提升生命上限與當前生命，死亡時不再立刻結束遊戲，給予無敵時間。
  * 強化 DangerMap 與 Bot AI，使其能將怪物視為高危險區域並主動繞開或逃跑，避免發生直衝怪物的自殺行為。
* **2026-07-15: V1.3 終極高質感視覺與音效升級 (Aesthetic Overhaul)**
  * **全素材極致 SVG 化**：將所有硬體磚塊、軟體能量方塊、發光地板、炸彈與爆破離子波升級為高規格精細 Cyberpunk/Neon 風格 SVG，替換原本的 PNG 圖檔，達到絕對細緻質感的視覺饗宴。
  * **音響工程級音效**：重寫 `AudioManager.js`，導入高階 `AudioContext` 震盪器合成技術，實作極具震撼力的重低音爆破音效、科技感上升音階拾取音效，與清脆的放炸彈回饋音效。
  * **UI/UX 完美自適應**：重新編寫 `index.html` 與 CSS，為虛擬搖桿與動作按鈕加上琉璃擬物化 (Glassmorphism) 效果與動態光暈，且保證在任何裝置與直橫式切換下絕對不會出現畫面重疊與超出邊界的情形。
  * 完全遵守安全無干擾原則，排除所有不必要背景干擾迴圈。

## 電腦 AI（電腦單人 / 電腦雙人合作）

兩種電腦模式共享同一套「決策大腦」管線（`src/game/ai/`）：

| 模組 | 角色 |
|---|---|
| `HunterPolicy.js` | **已出貨的決策大腦**，實測第 1 關 83.3% 通關（N=120）。高勝率策略，**絕對不可刪除**。 |
| `MCTSolver.js` | 新候選決策大腦：Monte-Carlo 擊殺價值 + 聯合「放彈位置×逃生」搜尋 + Stackelberg 合作協調。 |
| `AIStrategy.js` | 策略登記冊 + 線上神經網路 + OR 規劃器。負責「結果論」的高勝率保留 / 低勝率改良 / 過低捨棄。 |
| `AIController.js` | 把登記冊選擇的決策大腦掛到 `Bot.think()`，並在每關結束回報勝負供學習。 |

政策選擇（`Bot.js`）：

```js
window.__BB_POLICY_OVERRIDE = 'hunter' | 'mctsolver'   // A/B 量測用
// 否則由 StrategyRegistry.selectPolicy() 依「已實測勝率」決定
// 兩者都沒有足夠樣本時，一律回退到 hunter（已知的高勝率策略，不冒險）
```

#### 如何量測（結果論的唯一裁判）

```bash
node tools/bb-bench2.mjs SINGLE,COOP 12 6 --sec=180               # 出貨路徑
node tools/bb-bench2.mjs SINGLE 12 6 --sec=180 --policy=mctsolver # 新候選
node tools/bb-bench2.mjs SINGLE 12 6 --sec=180 --holdout          # 沒看過的種子
node tools/bb-diag2.mjs  SINGLE 1 8 60 --policy=mctsolver         # 失敗結構 + 決策階段分布
node tools/bb-ctrace.mjs <seed> mctsolver 60                      # 逐幀追蹤死亡
```

#### 目前實測（N=12，每關上限 180 秒，同一引擎、只有政策不同）

| 模式 | 政策 | 全破率（6 關） | 各關通關率 |
|---|---|---|---|
| 單人 | hunter | 0% | 75 / 77.8 / 28.6 / 50 / 0 / – |
| 單人 | mctsolver | **8.3%（1/12）** | 58.3 / 57.1 / 50 / 50 / 100 / 100 |
| 雙人合作 | hunter | **33.3%（4/12）** | 83.3 / 90 / 77.8 / 100 / 71.4 / 80 |
| 雙人合作 | mctsolver | 0% | 66.7 / 62.5 / 40 / 50 / 100 / 0 |

> 誠實說明：兩種電腦模式的「全破關率 100%」**尚未達成**。
> 完整量測、失敗歸因與已排除的路線，全部記錄在 `AI_FINDINGS.md`。
> AI 不會在沒有實測數字支撐時宣稱 100%。

## 專案結構

```
c:/Users/user/Desktop/Bug_Bomb/
├── index.html        (主入口與自適應 UI/HUD)
├── package.json      (Vite 設定檔)
├── vite.config.js    (Vite 建置設定)
├── README.md         (專案說明與歷史)
├── PROJECT_STATE.md  (專案狀態與 Bug 追蹤)
└── src/
    ├── main.js       (主程式與系統整合)
    ├── engine/
    │   ├── GameEngine.js
    │   ├── input/InputManager.js
    │   ├── physics/GridSystem.js
    │   └── renderer/CanvasRenderer.js
    └── game/
        ├── ai/
        │   ├── Bot.js        (高階電腦對手)
        │   └── DangerMap.js  (即時危險區域計算)
        ├── bomb/
        │   ├── Bomb.js       (炸彈實體與脈衝動畫)
        │   └── BombManager.js
        ├── explosion/
        │   ├── Explosion.js  (高溫雷射特效)
        │   └── ExplosionManager.js 
        ├── item/
        │   ├── Item.js       (道具實體)
        │   └── ItemManager.js
        ├── map/
        │   └── MapManager.js (地圖生成與環境影響)
        ├── monster/
        │   ├── Monster.js    (基礎怪物 AI)
        │   ├── MonsterManager.js
        │   └── DragonBoss.js (Boss 與多樣技能)
        └── player/
            └── Player.js     (玩家控制與 AABB 碰撞)
```

## 如何執行

1. 安裝依賴：
   ```bash
   npm install
   ```
2. 啟動本機開發伺服器：
   ```bash
   npm run dev
   ```
3. 發布與建置：
   ```bash
   npm run build
   ```
4. 在瀏覽器打開 `http://localhost:5173/` 即可遊玩。
