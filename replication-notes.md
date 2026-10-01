# Chord Trees 原站複刻筆記

來源：使用者提供的 `https://chord-trees.nathanielschool.com/` 與圖 1、2、3。這是高保真複刻的 ground truth，不新增與原站無關的視覺方向。

## 已確認的原站資訊

- 三種等級選項依序為 `Beginner`、`Diatonic`、`Intermediate`。
- 左側為可收合設定欄，包含音符數 1–6、Random／Manual、Generate、Play、Smart Harmonize、Random Chords、樂器、Chords／Arpeggio 音量、Tempo、Metronome、Arpeggio 8th／16th、Cycles 1x／2x／4x、MIDI 匯出、Record Audio、快捷鍵、Mascot。
- Beginner 預設顯示四個根音節點（C、E、A、G），每個節點周圍有相鄰和弦樹，節點下方有單音標籤與小型鋼琴鍵盤。
- 原站鋼琴小鍵盤採白鍵與黑鍵的真實鋼琴排列，黑鍵位於相鄰白鍵之間，和弦／音符使用藍色高亮；不能用等寬連續按鍵或把黑鍵當成普通白鍵排列。
- 選單切換會改變主要工作區內容：Beginner 是單音根節點樹；Diatonic 是調內音級與和弦；Intermediate 是按 Major、Minor、Dominant 7th、Major 7th、Minor 7th、Diminished、Augmented 及延伸和弦分類的節點卡。
- 原站的主工作區為深色、寬畫布、水平排列的學習內容；窄視窗需要改成可用的堆疊／水平滾動，而不能讓控制列與卡片互相覆蓋。

## 參考圖對應

- 圖 1：Beginner，四個單音根節點與每個節點下方的鋼琴鍵盤。
- 圖 2：Diatonic，調性／音階控制與七個調內和弦的音級排列；每個音級下方仍有對應的和弦與鋼琴鍵盤。
- 圖 3：Intermediate，四個根音欄位，每欄分組展示和弦類型，延伸和聲區塊可展開。

## Diatonic 實測補充

原站在 `Diatonic` 模式的預設狀態為 `A Major`、`1st (Ionian)`。主區上方會先顯示「Diatonic chords in A Major」與 Ionian 音級列：A/I、B/ii、C#/iii、D/IV、E/V、F#/vi、G#/vii°。下方工作區以四欄展示 F#、E、B、D 的和弦樹，每欄包含根節點、三個或四個相鄰調內和弦、單音小鍵盤、Seventh Chords 按鈕列與 `EXTENDED HARMONY` 折疊列。

實測可見的七和弦標籤包含 `Bm7(ii7)`、`DΔ7(IVΔ7)`、`F#m7(vi7)`、`G#ø7(viiø7)`，其他欄位依其調內功能顯示 `AΔ7(IΔ7)`、`C#m7(iii7)`、`E7(V7)` 等。這確認高級資料模型需要同時保存和弦根音、品質、羅馬數字與功能標籤，而不只是顯示一個和弦名稱。

原站 Level 下拉選單的確切排序是 `Beginner`、`Diatonic`、`Intermediate`。桌面版左側欄固定約 160px，右側內容區可水平滾動以保留四欄和弦卡的完整寬度；窄視窗則應將側欄收納成抽屜，內容區保留自己的水平滾動而非讓卡片互壓。

## 目前重構驗證（2026-08-12）

- 最新單檔預覽可正常載入，Level 選單包含 Beginner、Diatonic、Intermediate。
- Beginner 顯示 C、E、A、G 四欄和弦樹與 Single note 鋼琴視覺化。
- Diatonic 顯示目前 C Major 的 I–vii° 七個調內七和弦，並保留每欄的延伸和聲區段。
- Intermediate 顯示 15 個原站分類，分類可折疊，和弦格可播放並加入進行。
- Play 在 Intermediate 模式可啟動播放，瀏覽器主控台沒有 JavaScript 錯誤；吉祥物節點會顯示在播放路徑上。
