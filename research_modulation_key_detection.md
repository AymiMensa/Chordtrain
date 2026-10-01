# 轉調與和弦辨識研究備忘

## 來源一：AudioLabs FMP — HMM-Based Chord Recognition
URL: https://www.audiolabs-erlangen.de/resources/MIR/FMP/C5/C5S3_ChordRec_HMM.html

關鍵結論：以 chromagram（12 維音級向量）作為觀測序列，HMM 的狀態可代表和弦；發射機率可用觀測 chroma 與和弦 template 的相似度，Viterbi 演算法則找出整段最合理的和弦狀態序列。轉移機率可表達音樂上較合理的連接，例如主和弦到屬和弦比半音跳接更常見；自轉移可表示和弦維持。這種 transition model 具備 context-aware postfiltering 效果。

## 來源二：Papadopoulos & Peeters — Local Key Estimation From an Audio Signal Relying on Harmonic and Metrical Structures
URL: https://ieeexplore.ieee.org/abstract/document/6074928/
DOI: https://doi.org/10.1109/TASL.2011.2175385

關鍵結論：局部調性估計不應只使用全曲固定窗口；可根據拍號／速度與音樂內容調整分析窗口，並從和弦進行估計調性。研究將 harmonic 與 metrical 結構納入 key progression 模型，以處理隨時間變化的調性。

## 對本專案的設計含意

頻繁轉調時，應將每個時間窗視為候選調性分布，而不是立刻選定單一調。可用重疊窗口、chroma／旋律音級輪廓、和弦候選與調性轉移成本組成分數，並用 Viterbi 或 beam search 找出平滑但允許轉調的調性序列。轉調點應在相鄰窗口的最佳調性改變、信心差距超過門檻且持續數個窗口時才確認，以避免單一經過音造成誤判。

初學者模式可使用可信手勢下的鋼琴輸入音，先累積短時間音符集合，再產生包含這些音的候選和弦；以主音、三度、五度、旋律重拍音、調內程度與前一和弦連接評分。為避免每按一音就跳和弦，應採用 100–250 ms debounce／短窗，或在使用者按下「套用」後才把候選和弦寫入 progression；同時保留候選清單與信心分數，讓初學者能看見推薦原因。
