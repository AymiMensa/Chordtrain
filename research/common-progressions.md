# 常見和聲進行參考

本次進行庫設計以公開音樂理論資料作為參考，不將歌曲旋律或受版權保護內容直接複製到專案。

## 可採用的結構參考

- 八小節藍調是常見的八小節和聲結構，可作為流行／藍調相關 8 組進行的結構參考。來源：[Wikipedia — Eight-bar blues](https://en.wikipedia.org/wiki/Eight-bar_blues)
- 爵士和聲的 ii–V–I 被多個音樂理論教材列為核心、常見的標準進行，並可延伸成 turnaround、循環五度與 32 小節 AABA 結構。來源：[Puget Sound — Standard Chord Progressions](https://musictheory.pugetsound.edu/mt21c/StandardChordProgressions.html)；[JazzGuitar.be — The 10 Most Popular Jazz Chord Progressions](https://www.jazzguitar.be/blog/10-most-popular-jazz-chord-progressions/)
- 古典和聲可使用正格終止 V–I、變格終止 IV–I、偽終止 V–vi、循環五度與 ii–V–I 等功能和聲結構。來源：[Puget Sound — Cadences](https://musictheory.pugetsound.edu/mt21c/cadences.html)；[Open Music Theory — Introduction to Harmony, Cadences, and Phrase Endings](https://viva.pressbooks.pub/openmusictheory/chapter/intro-to-harmony/)
- 8、16、32 小節的資料模型應以和弦級數序列表示，再由目前調性轉換為和弦種類圖可用的和弦資料，避免把固定調名硬編碼到進行庫。

## 實作原則

- 進行以羅馬級數／功能標籤保存，播放時依目前根音與調性解析成既有 CHORDS 資料中的和弦種類。
- 每個風格與長度提供 30 組，優先涵蓋正格終止、循環五度、常見流行循環、爵士 ii–V–I／turnaround、藍調與古典功能和聲；同一進行可有轉位、替代和弦或終止式變體，但不複製任何單一歌曲的完整作品。
- 「經典且好聽」屬於音樂編排判斷，不宣稱存在客觀排名；介面應提供預覽，讓使用者自行比較與選擇。
