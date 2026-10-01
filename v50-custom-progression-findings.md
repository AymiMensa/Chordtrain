# 第五十版自訂和弦進行初步檢查

瀏覽器切換至「和弦種類圖」後，DOM 已出現 `.custom-progression-panel`。初始進行有一行、四個 `.custom-progression-slot`，根音預設依序為 `C`、`G`、`A`、`F`。

初步 DOM 檢查確認下列控制已渲染：播放自訂和弦進行、錄音、輸出 MIDI、匯出 JSON 自訂和弦進行、匯入 JSON 自訂和弦進行。後續回歸需驗證新增列、選單更新、逐格播放高亮、MediaRecorder、MIDI 標頭／事件與 JSON round-trip。
