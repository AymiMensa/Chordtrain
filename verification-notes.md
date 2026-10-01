# 第十一版驗證筆記

目前預覽重現結果：

- 初學者視圖切換五線譜後，`renderBeginner()` 仍以 `renderStaff([NOTE_I[root]+60])` 傳入單一根音；因此 C 卡只輸出 `C4` 一個全音符，而不是該卡代表和弦的完整音名集合。
- 五線譜目前以半音名稱推導字母位置，升記號與調性內的正確拼寫尚未由和弦音名資料傳入；需要改成「音名字母 + 八度 + 升降記號」的音符物件，再依字母步階排譜。
- 吉祥物軌跡的 reduced-motion CSS 規則目前把 `.mascot-trail` 設為 `opacity:0`，且只有第一個子元素例外；需保留可見的淡出軌跡，不能以完全隱藏取代動畫。

修正後預覽結果：C 大三和弦輸出 3 個全音符，標籤為 `C4 · E4 · G4`；Eb 大三和弦輸出 `Eb4 · G4 · Bb4` 並呈現降記號；播放 650ms 後可取得 5px 白色 `.mascot-trail`，套用 `mascotTrailDraw` 與 `mascotTrailFade`，吉祥物處於顯示狀態。

第十二版重現結果：固定座標的高對比 SVG 線段可在頁面最上層顯示，表示 overlay 的座標、viewport 與 z-index 本身正常；實際播放時也能取得白色 trail，但短節點距離搭配初始 `stroke-dashoffset` 與 0.55 秒繪製動畫，肉眼容易在移動瞬間看不到。修正方向改為線段建立後立即完整可見，再單獨以約 5 秒 opacity 淡出。

第十二版修正後：真實 `playDiatonicSequence()` 在第一段移動後產生 1 條 trail，`stroke-width=5px`、`stroke=rgb(255,255,255)`、`stroke-dasharray=none`、`stroke-dashoffset=0px`、`z-index=120`；650ms 時仍有約 0.80 opacity，且固定高對比測試線已確認 overlay 可被瀏覽器繪製。

第十二版 halo 修正後：真實播放在 650ms 後產生 `.mascot-trail-group`，群組仍以 `mascotTrailFade` 淡出；其中包含白色 `5px` 核心線與白色 `14px`、`opacity=.28` 的 halo，兩者均為完整實線且座標相同，讓短距離節點間的移動也能清楚辨識。

第十四版瀏覽器驗證：問號按鈕開啟置中的可滾動操作說明 modal，內容涵蓋初學者／調內／中級、KEY／SCALE／MODE、樂器與音量、Play／循環／隨機／生成／智慧和聲、快捷鍵、吉祥物光軌、鋼琴／五線譜切換、琶音與背景；X 按鈕可關閉並回到主畫面。

第十四版瀏覽器驗證：Earth 按鈕可開啟「原有・深色／莫蘭迪／海洋」選單；選擇「莫蘭迪」後頁面工作台、側欄與內容區立即套用低飽和灰棕粉色系，選單關閉且顯示「莫蘭迪背景已套用」提示。新增主題選單未造成桌面 topbar 溢出。

第十四版服務重啟回歸：重啟後預覽可正常載入原有深色初學者頁面，Earth 與問號控制仍位於右上角，未出現版面溢出；後續動態調內驗證需在重載後重新選擇「調內」。

第十四版調內實測：重啟後切換「調內」再切到「五線譜」，四張卡片分別顯示 F4·A4·C5·E5、B3·D4·F4·A4、C4·E4·G4·B4、D4·F4·A4·C5 等完整四音和弦；每張卡片的視覺化標籤也由「單音」改為「和弦」，五線譜呈現垂直疊放的完整音符群。

第十四版琶音控制回歸：重啟後 DOM 已正確列出「八分音符」與「十六分音符」兩個 #arpMode 選項；循環次數 1x／2x／4x 維持獨立，不再被誤當作琶音模式。初始 active 為八分音符，播放排程使用 S.tempo 的 1/2 拍間隔，十六分音符使用 1/4 拍間隔。

第十四版瀏覽器排程實測：在 120 BPM 下攔截 playChord 的 setTimeout，切換十六分音符得到 [0, 125, 250, 375] ms；切換八分音符得到 [0, 250, 500, 750] ms。兩個模式均成功更新 active 狀態並依 BPM 排程四個和弦音。

第十四版桌面主題回歸：Earth 選單可完整顯示「原有・深色／莫蘭迪／海洋」，莫蘭迪套用後選單自動收合且背景變為低飽和灰棕色；再次開啟時海洋選項可見，未被 topbar 裁切。

第十四版海洋主題實測：選擇「海洋」後背景切換為深藍綠色系，工作台面板、文字、和弦樹與鋼琴視覺化維持清晰對比，選單自動收合並顯示「海洋背景已套用」。

第十四版問號 modal 實測：操作說明完整列出初學者／調內／中級、KEY／SCALE／MODE、樂器與音量節拍、播放／循環／隨機／生成、Space／M／L／R／G／Esc 快捷鍵、吉祥物 5px 光軌、鋼琴／五線譜、琶音與 Earth 背景；點擊 × 後 modal 關閉，海洋主題保持。

第十四版響應式回歸：390×844 直式截圖顯示側欄折疊為漢堡按鈕，主畫面垂直排列和弦樹與小鋼琴，未有水平溢出；844×390 橫式截圖顯示頂部 Earth／旋律轉和弦／主題／問號控制列完整，主要和弦節點分欄呈現且未互壓。

第十五版月亮深色模式實測：先切換至海洋背景，再點擊右上角月亮按鈕，頁面回到原有深色工作台；按鈕 `aria-pressed` 回復 `true`，並顯示「原有深色背景已套用」，頁首、側欄、內容與視覺化區域均保持深色高對比。

第十五版和弦視覺化實測：點擊初學者第一張卡片的 C 節點後，僅該卡片即時更新為 `C · E · G` 和弦與 3 個鋼琴高亮鍵，其他 E／A／G 卡片仍維持單音；切換至五線譜後，同一張卡片顯示 C4、E4、G4 垂直疊放，確認鋼琴與五線譜共用目前完整和弦資料。

第十五版手機回歸：390×844 直式截圖顯示月亮按鈕、折疊側欄、和弦樹與鋼琴區域均在畫面內；844×390 橫式截圖顯示頂部控制列與兩欄和弦樹未互壓，深色背景與文字對比維持可讀。

第十六版初步回歸：重新載入後 Earth 預設顯示白色工作台，Earth 選單列出「原有・白色／莫蘭迪／海洋」，側欄琶音選項改為「四分音符／十六分音符」，頁面底部可見「韶韻音樂學院 馬老師  專門為秀玲姊設計 和弦系統教學」。

第十六版主題回歸：Earth 選單選擇「莫蘭迪」後背景正常套用並顯示提示；再點擊月亮按鈕後，頁面切回深色模式，按鈕無障礙標籤變為「深色模式已啟用」，版權列仍固定於主內容底部且文字可讀。

第十六版琶音與手機回歸：瀏覽器實測 120 BPM 下「四分音符」琶音間隔為 500ms，「十六分音符」間隔為 125ms，測試後狀態恢復為四分音符。390×844 直式畫面顯示白色 Earth、和弦樹、鋼琴與底部版權列，控制列與內容未互壓或超出畫面。

第十六版橫式與建置回歸：844×390 橫式畫面中 Earth、月亮、控制列、和弦樹與版權列維持安全邊界；inline JavaScript `node --check`、`pnpm run check` 與 `pnpm run build` 均通過。日誌檢查未發現新增 JavaScript 例外、未處理錯誤或失敗請求。

第十七版音訊與光軌實測：重新載入後速度控制初始為 72 BPM，滑桿範圍為 30–300；`drawMascotTrail()` 產生 SVG `path` 二次貝茲弧線 `M 100 240 Q 230 182.8 360 240`，保留白色 5px 與淡出群組。72 BPM 下四分音符排程為 0／833.33／1666.67ms，十六分音符為 0／208.33／416.67ms；琶音 0% 時沒有任何排程。節拍器 72 BPM 為 833.33ms 間隔，啟動及每四拍循環的第一拍使用重音旗標。

第十七版響應式截圖回歸：1280×720 桌面顯示白色 Earth、速度 72、琶音控制與底部版權列；390×844 直式顯示漢堡側欄與垂直和弦樹，頁尾未覆蓋內容；844×390 橫式的頂部控制列、雙欄和弦樹與頁尾均維持安全邊界。

第十八版瀏覽器實測：Earth 主題的 `--bg` 為 `#edf0f3`，頁面由純白調整為淺灰，白色光軌與粒子具備清楚對比；播放後 `#mascotTrailSvg` 產生二次貝茲 `path` 與 5 個 `.mascot-trail-particle` 圓點，粒子具低透明度、錯開延遲與群組淡出。1280×720 桌面及 390×812 直式截圖均未出現內容溢出，版權頁尾與控制列維持可讀。

第十八版建置回歸：`pnpm run check`、`pnpm run build` 與 inline JavaScript `node --check` 均通過；Vite 僅保留既有 chunk size warning。日誌篩選未發現第十八版新增的瀏覽器例外或網路錯誤。

第十九版音訊開關實測：側欄在和弦音量與琶音音量滑桿左側分別顯示「關／開」按鈕；點擊和弦開關後 `aria-pressed=true` 並顯示「和弦音已開啟」，再關閉琶音後 `aria-pressed=false` 並顯示「琶音已關閉」。非破壞排程測試確認和弦開啟／琶音關閉時，`playChord([60,64,67])` 僅呼叫 3 次和弦音播放，沒有建立琶音計時器。

第十九版獨立音層實測：切換為和弦關閉、琶音開啟後，DOM 顯示 `chordToggle=關`、`arpToggle=開`；非破壞排程測試在四分音符模式下確認 `playChord([60,64,67])` 同步和弦播放呼叫為 0，僅建立 3 個琶音計時器，驗證兩種音訊可單獨出現。

第十九版響應式回歸：1280×720 桌面版中，和弦／琶音的「關／開」按鈕均位於各自音量滑桿左側；390×844 直式版面中側欄折疊後控制列與內容未溢出，頁尾版權仍可見，兩組音訊控制沒有互相覆蓋。

第十九版建置回歸：`pnpm run check`、`pnpm run build` 與 inline JavaScript `node --check` 均通過；Vite 僅保留既有 chunk size warning。開發伺服器、瀏覽器與網路日誌未發現本版新增的 JavaScript 例外或失敗請求。

第二十版視覺狀態回歸：和弦／琶音開關開啟時以綠色背景、亮邊、實心圓點與輕微外框光暈表示；關閉時以淺灰背景、低透明度與空心圓點表示，兩組狀態在 1280×720 桌面畫面均清楚可辨。390×844 直式畫面中按鈕仍位於各自滑桿左側，未造成控制列溢出；hover 與 `focus-visible` 具備額外對比和焦點框。

第二十版建置回歸：inline JavaScript `node --check`、`pnpm run check` 與 `pnpm run build` 均通過；Vite 僅保留既有 chunk size warning。預覽與網路請求均正常，未發現第二十版新增的 JavaScript 例外或失敗請求。

第二十一版智慧和聲實測：重新載入後點擊「智慧和聲」，進行列實際建立 `C → Em → G → C` 四個和弦，頁面顯示「智慧和聲已建立並播放」提示，且播放流程觸發目前和弦序列。此結果來自目前調性與已選音符的動態推導，不再是單純提示或固定空操作。

第二十一版節拍器實測：點擊節拍器後 checkbox 變為啟用狀態，無障礙標籤更新為「關閉節拍器（72 BPM）」；節拍器使用 72 BPM 的 833.33ms 間隔，啟動及每四拍循環的第一拍傳入重音旗標，第二至第四拍傳入一般滴聲旗標。新版 Web Audio 同時加入低頻三角波／短噪聲木魚音色與較高頻方波／短噪聲滴聲。

第二十一版手機回歸：390×844 全頁截圖中，節拍器、琶音、智慧和聲控制列不造成水平溢出；智慧和聲提示進行列與版權頁尾均可正常顯示，和弦樹與鋼琴視覺化維持垂直排列。

第二十一版桌面與建置回歸：1280×720 全頁截圖中節拍器、智慧和聲、和弦樹、鋼琴視覺化與控制列比例正常；`pnpm run check`、`pnpm run build` 與 inline JavaScript `node --check` 均通過。Vite 僅保留既有 chunk size warning，未發現第二十一版新增的建置或語法錯誤。

第二十二版桌面初步回歸：開啟遊戲後點擊「智慧和聲」，進行列建立 `C → Em → G → C`，每個 chip 皆出現可操作的播放按鈕與移除控制；播放畫面中目前和弦卡片的和弦標籤、鋼琴高亮鍵與五線譜／和弦預覽會隨序列更新，最後一個和弦保留高亮。瀏覽器頁面未出現載入錯誤或新增例外。

第二十二版進行列編輯實測：點擊第一個 chip 顯示編輯外框與下拉選單，選項為目前 C 大調的 `I C`、`ii Dm`、`iii Em`、`IV F`、`V G`；選擇 `iii Em` 後第一格立即變為 Em、播放對應和弦，第二張卡片同步顯示 `E · G · B` 與三個鋼琴高亮鍵，未造成整列溢出。

第二十二版調內五線譜回歸：切換「調內」後四張卡片仍顯示完整四音資料（F4·A4·C5·E5、B3·D4·F4·A4、C4·E4·G4·B4、D4·F4·A4·C5）；切換「五線譜」後每張卡片顯示對應的高音譜號與垂直全音符，進行列編輯狀態未造成版面破壞。

第二十二版建置回歸：`pnpm run check` 與 `pnpm run build` 均通過；Vite 僅保留既有 chunk size warning，沒有 TypeScript 或 production build 失敗。桌面與 390px 手機截圖均完成，使用說明同步補上智慧和聲高亮與進行列替換流程。

第二十三版智慧和聲風格實測：新增「流行／爵士／古典」選擇器；切換爵士後點擊智慧和聲，頁面建立並播放 `Cmaj7 → Em7 → G7 → Cmaj7`，保留既有逐和弦鋼琴／五線譜高亮與進行列同步。三種風格共用目前調性、音階與調式資料，不改變原有和弦視覺化路徑。

第二十三版錄音回放實測：點擊「開始錄音」後播放和弦，再點擊「停止」，狀態更新為「已有錄音，可回放」；錄音 Blob 成功解碼，audio 元件 `readyState=4`、`duration=7.128493`、`error=null`，點擊「回放」後正常進入播放狀態。另驗證沒有音訊輸入的空白錄音會被拒絕並提示使用者需在錄音期間播放和弦或節拍器，不會留下不可回放檔案。

第二十三版響應式與建置回歸：桌面與 390px 手機截圖均完成，風格選擇器、五個錄音控制與既有深色工作台沒有互壓或水平溢出；inline JavaScript `node --check`、`pnpm run check` 與 `pnpm run build` 均通過。Vite 僅保留既有 chunk size warning。

第二十四版初次瀏覽器回歸：頁面成功載入新增的和弦密度／替代／終止式選擇器、30–300 BPM 標示、木魚／Groove XOR 按鈕、Groove 類別與伴奏下拉選單，以及錄音時間軸容器。點擊 Groove 後，詳細說明 modal 成功開啟並以五大類呈現全部曲風；Toast 同步顯示「Groove 模式已啟用；木魚已關閉」。

第二十四版 Groove 分類回歸：切換「複節奏／拉丁」後伴奏選單正確更新為 Samba、Rumba、Bossa Nova、Cha-Cha、Salsa、Afrobeat；其餘四類亦由資料模型分別提供 Disco／EDM／Pop、Rock／Rock & Roll／Soul／Slow Soul／Ballad／Folk／R&B、Blues／Jazz／Swing／Shuffle Rock，以及 Funk／Hip-Hop／Neo-Soul／Rap。

第二十四版節拍器互斥實測：切回木魚後 Toast 顯示「木魚模式已啟用；Groove 已關閉」，`S.metroMode=woodblock`、`grooveControls.hidden=true`；切換前選取的 Samba 與複節奏／拉丁分類仍保留。速度滑桿 `min=30`、`max=300`、初始值 `72`，符合要求；Groove Samba pattern 使用 16 步、四分拍分割與 kick／snare／conga／shaker 聲部。

第二十四版智慧和聲參數回歸：延展密度可寫入 `S.harmonyDensity=8`，阻礙終止式可寫入 `S.harmonyCadence=deceptive`；替代和弦選單正式值為 `none`、`extensions`、`secondary`、`tritone`，分別對應傳統調內、七和弦色彩、副屬替代與半音替代，未改動既有三種風格選擇。

第二十四版延展智慧和聲實測：套用密度 8、半音替代、阻礙終止式後，點擊智慧和聲建立 8 格進行 `C → Am → F → G#7 → Dm → G#7 → G7 → Am`；`S.progression.length=8`，播放結束後 `S.activeChord` 保留最後一格 Am，且既有鋼琴／五線譜同步高亮路徑正常。

第二十四版錄音時間軸實測：開始錄音後播放八格和弦，再停止錄音，介面顯示「已有錄音，可回放」，時間軸 Slider 建立 `min=0`、`max=6.789667`、`value=0`，畫面顯示 0:00／0:06，可進行指定位置拖曳回放；錄音狀態已離開 `isRecording`。

第二十四版指定位置回放實測：錄音 audio 元件為 `recordingAudio`，解碼成功且 `duration=6.789667`；將 `recordSeekSlider` 定位至 `3.4` 秒並觸發 input 後，`recordingAudio.currentTime=3.4`，確認時間軸與 audio 播放位置同步。

第二十四版 Groove 資料回歸：五大分類共 23 種使用者可選曲風；分類內容為 Four-on-the-floor（Disco、EDM、Pop）、Backbeat（Rock / Rock & Roll、Soul、Slow Soul、Ballad、Folk、R&B）、Shuffle / Swung（Blues、Jazz、Swing、Shuffle Rock）、Syncopated（Funk、Hip-Hop、Neo-Soul、Rap）、Polyrhythm（Samba、Rumba、Bossa Nova、Cha-Cha、Salsa、Afrobeat）。拉丁曲風使用 conga、clave、shaker、rim 等對應聲部，不要求每種都具 snare；Groove 說明 modal 已成功開關，木魚／Groove XOR 狀態正常。速度 30／300 BPM 的測試需以不依賴內部 timer 變數的方式補驗。

第二十四版速度邊界補驗：在 Groove 模式下將 `tempoSlider` 依序設為 30、300，再恢復 72；回讀結果為 `S.tempo=30`、`S.tempo=300`、`S.tempo=72`，UI 值一致，模式維持 `groove`，節拍器 timer 仍存在，確認 30–300 BPM 邊界與即時重啟正常。

第二十四版交付前回歸：1280×720 桌面與 390×844 手機直式截圖均完成；桌面側欄新增和聲參數、木魚／Groove、類別／曲風選單與錄音控制仍在可視範圍，手機版改由既有抽屜式側欄承載，不造成水平溢出。`node --check`、`pnpm run check` 與 `pnpm run build` 均通過；Vite 僅保留既有 chunk size warning。

第二十五版節拍器音訊回歸：新增 `metroSlider` 0–100 與 `S.metroVol`，瀏覽器實測 0%／100%／65% 分別回寫 `0`／`1`／`0.65`，標籤同步顯示。木魚音源改為三角波木質共鳴、二次泛音與短促敲擊包絡，並透過共用輸出節點同時接主輸出與錄音路由；使用者操作開啟後 `AudioContext=running`、`metroMode=woodblock`、`timerActive=true`。切換 Groove 後控制展開；切回木魚後 `grooveControls.hidden=true`、木魚模式與 timer 恢復，確認 XOR 狀態沒有破壞節拍器啟停。

第二十五版音量 DOM 回歸：`metroSlider` 的 `min=0`、`max=100`、目前 `value=65`，輸入事件依序將 `S.metroVol` 更新為 `0`、`1`、`0.65`；畫面顯示元素為 `#metroVol`，文字同步為 `65%`，ARIA 標籤同步包含目前百分比。

第二十六版差異化音色回歸：Groove 資料模型已為不同曲風建立專屬聲部。Swing 使用 `brush`／`brushAccent`／`ride`／`closedHat`；Samba 使用 `congaLow`／`congaHigh`／`shaker`／`clave`／`agogo`／`openHat`；Trance 使用 `edmKick`／`synthBass`／`synthPluck`／`openHat`；Heavy Metal 使用密集 `kick`／`snare`、`crash`、`tomHigh`／`tomLow`；Funk 使用切分 `kick`／`electricBass`、`rim` 與細分 Hi-Hat；Neo-Soul 另加入 Conga 與 Shaker。
第二十六版音源觸發回歸：在瀏覽器以第 1 個細分拍點實際觸發 Swing、Samba、Trance、Heavy Metal、Funk；回讀的觸發聲部分別為 `kick + brushAccent + ride`、`kick + shaker + clave`、`edmKick + closedHat + synthBass`、`kick + closedHat + crash`、`kick + electricBass`，Web Audio 建立成功且沒有例外。Groove 詳細說明同步補上鼓刷、拉丁打擊樂、電子合成器及金屬鼓組差異。

第二十六版視覺回歸：1280×720 桌面與 390×844 手機直式截圖均完成；Groove 觸發後的類別／曲風控制保持在原版深色側欄層級，手機版主畫布與側欄抽屜沒有水平溢出。inline JavaScript `node --check`、`pnpm run check` 與 `pnpm run build` 均通過，僅保留既有 Vite chunk size warning。

第二十七版 Groove 播放診斷：逐一呼叫 23 種 Groove 的 `playGrooveStep`，所有曲風均產生至少一個專屬聲部呼叫，代表性聲部包含 Swing 的 `brush`／`ride`、Samba 的 `conga`／`shaker`、EDM 的 `edmKick`／`synthBass`、Metal 的 `crash`／`tom` 與 Funk 的 `electricBass`／`rim`；`AudioContext=running`，無瀏覽器例外。補強 `ensureAudioReady()`，避免使用者操作後 AudioContext 仍為 suspended 時整個 Groove 無聲。

第二十七版實際音訊回歸：將 Swing、Samba、EDM、Metal、Funk 接入 MediaRecorder，解碼後均有非零音訊振幅；RMS 分別為 `0.001344`、`0.001439`、`0.003486`、`0.001783`、`0.001803`，確認差異化 Groove 聲部確實進入輸出與錄音路由。木魚第一拍已改為較高音域 `780Hz → 540Hz`，第二至第四拍改為較低音域 `440Hz → 300Hz`，並保留第一拍較強包絡。

第二十七版技術回歸：inline JavaScript `node --check`、代表性 Groove CDP 診斷、`pnpm run check` 與 `pnpm run build` 均通過；所有曲風 timer 可建立、模式切換無例外。1280×720 桌面與 390×844 手機直式截圖完成，節拍器與 Groove 控制維持在側欄安全範圍，手機主畫布沒有水平溢出。

第二十八版 Groove 全面播放修正：確認共同問題不是 23 種音色資料，而是切換至 Groove 後節拍器 checkbox 仍可能維持關閉，導致沒有建立循環 timer。現在點擊 Groove 模式會同步啟用節拍器、恢復 AudioContext、建立 Groove interval，並保留木魚模式下的原有關閉行為；切換曲風後仍使用各自差異化聲部與既有錄音輸出路由。

第二十八版逐類回歸：在修正後逐一啟動 23 種伴奏，均建立 timer 並產生至少一個有效聲部；Swing、Samba、Trance／EDM、Heavy Metal、Funk 等代表性曲風的 MediaRecorder RMS 維持非零，瀏覽器主控台沒有新增例外。Groove 說明、木魚／Groove XOR、30–300 BPM 與桌面／390px 手機版面均回歸完成。

第二十八版交付前技術回歸：單檔 inline JavaScript `node --check`、`pnpm run check` 與 `pnpm run build` 均通過；Vite 僅保留既有 chunk size warning。1280×720 桌面與 390×844 手機直式截圖完成，Groove 控制仍維持深色工作台比例，手機版沒有水平溢出。

第二十九版修改前 Groove 混音基線：以 cdp-groove-rms-audit.mjs 在 72 BPM、S.metroVol=0.65 下量測代表性曲風，Swing RMS 0.002275/peak 0.223866，Samba RMS 0.001490/peak 0.019846，EDM RMS 0.003467/peak 0.611249，Heavy Metal RMS 0.002258/peak 0.020289，Funk RMS 0.001850/peak 0.020894。基線顯示各曲風的輸出利用率差異過大，且 EDM 的同時觸發峰值已明顯高於其他曲風；AudioContext=running、錄音 bytes 非零，故問題不是無聲或錄音斷線。

第二十九版共同根因盤點：目前每個 playDrumVoice() 都直接把瞬態聲部接到 ctx.destination 與錄音目的地，沒有 Groove 專用 headroom/總線壓縮/limiter；各聲部以 peak=(accent?0.2:0.13)*S.metroVol 起算，再疊加同一拍的 kick、snare、hat、bass 與特色聲部，容易造成總和 clipping。特色聲部目前多數仍以 peak*0.22–0.48（shaker、clave、合成器、鼓刷部分路徑）或更低的倍率建立，因此在大鼓/小鼓與低頻聲部同時存在時聽感被掩蓋。後續修正需把 Groove 聲部集中至受控總線，對各類聲部採分組增益與平滑動態處理，並讓錄音路由取自同一條安全輸出鏈。

第二十九版 Groove 混音修正：新增 Groove 專用 input headroom（0.68）、DynamicsCompressorNode（threshold -16 dB、knee 18 dB、ratio 6:1、attack 4 ms、release 140 ms）、2x oversampled WaveShaper soft limiter 與 output gain（0.84）；所有 playDrumVoice 聲部改接 Groove 總線，不再直接疊到主輸出，且總線輸出同步接入 MediaStreamDestination。主聲部 envelope 改為 normalizedLevel，避免 peak 同時被 master 與音源 gain 雙重平方衰減；鼓刷、shaker、Conga、Clave、electric/synth bass、synth pluck、Ghost Note 等特色聲部的內部倍率同步提升並保留各曲風差異化配置。

第二十九版音訊量測：重啟開發伺服器並強制導向最新頁面後，在 S.metroVol=0.65 量測全部 GROOVE_PATTERNS 曲風，峰值約 0.007854–0.024190、RMS 約 0.001059–0.002236；在 S.metroVol=1 的最大音量邊界，峰值約 0.017742–0.847827、RMS 約 0.002389–0.006002，沒有達到 clipping。Swing、Samba、EDM、Heavy Metal、Funk 的逐曲風觸發診斷均無 errors 且 bytes 非零。

第二十九版錄音回歸：實際以 Samba Groove 啟動 startRecording，逐步呼叫 Groove 播放並 stopRecording，MediaRecorder 產生 11024 bytes、recordingUrl 存在；最新頁面確認 grooveMix 存在，compressor 參數為 -16 dB／6:1／4 ms／140 ms，停止後 recordingTarget 已清空。桌面 1280×720 與手機 390×844 截圖確認深色工作台、Groove 控制列、五線譜／鋼琴區與既有響應式版面未被混音修改破壞。

第二十九版音量邊界回歸：在節拍器音量 100% 下，全部 26 個 Groove 曲風 analyser 峰值範圍約 0.2377–0.4719、RMS 約 0.01585–0.02563，仍保留明顯 headroom，未出現 clipping；在 0% 下，全部 26 個曲風 RMS 與峰值均為 0，確認音量控制可完全靜音。

第三十版和弦 BPM 同步：新增 `getTempoBpm()` 與 `getChordBeatIntervalMs()`，讓節拍器、調內和弦播放、智慧和聲、隨機和弦、循環播放與琶音共用 `60000 / BPM` 的時間基準。30／72／120／300 BPM 實測和弦排程分別為 2000／833.33／500／200ms；四分琶音在 120 BPM 為 500ms，十六分琶音為 125ms。速度滑桿變更時會重建正在播放的調內／智慧和聲／循環排程，並保留 30–300 BPM 夾限。
第三十版回歸：原先固定 500／600／650ms 與 4 秒循環週期已從和弦播放路徑移除；和弦／琶音獨立開關、0% 琶音靜音、Groove／木魚模式與錄音路由維持。inline JavaScript `node --check`、`pnpm run check`、`pnpm run build` 與 `git diff --check` 通過。
第三十版視覺回歸：1280×720 桌面畫面保留原有深色工作台、和弦樹、鋼琴與左側控制列；390×844 直式畫面控制列折疊、和弦樹與鋼琴垂直排列，底部版權列可見，未發現因 BPM 同步修改造成的水平溢出或元件互壓。

第三十一版操作說明與固定定位：智慧和聲按鈕已改為「播放智慧和聲」，按下後仍會依目前風格與音符選取建立並立即播放和弦進行；操作說明同步區分「生成」與「播放智慧和聲」。快捷鍵文案已將 `M：切換節拍器` 改為 `M：關閉／開啟節拍器`，實測兩次 M 事件可在關閉／開啟狀態間切換。設定說明新增音符 1–6：點亮的音級會納入播放智慧和聲的推導目標，熄滅則排除，不會改變 KEY／SCALE／MODE，也不會單獨播放。
第三十一版吉祥物回歸：`#mascotTraveler` 改為 `position: fixed`，移除內容捲動時會重新抓取和弦節點座標的同步事件，保留播放初始化、視窗 resize 與 fixed viewport 座標重套用。瀏覽器實測播放智慧和聲後，吉祥物 computed position 為 `fixed`、可見，內容與視窗捲動前後 viewport 座標差為 `{x:0,y:0}`；操作說明 modal、桌面頁面與既有深色工作台均正常。
第三十二版音符提示與選取計數：音符 1–6 皆具備 title／ARIA tooltip，提示目前級數、對應音名、KEY／SCALE／MODE，以及點亮或熄滅後是否納入播放智慧和聲推導；音符控制同時支援滑鼠點擊與 Enter／Space 鍵盤操作。畫面新增 `已選 X／6` 即時計數，點亮／熄滅時同步更新。
第三十二版智慧和聲播放指示：點擊「播放智慧和聲」後，狀態列顯示目前和弦、`第 n／總數 拍`、進度百分比與進度條，進行列同步以 `smart-active` 高亮目前和弦；瀏覽器實測初始狀態為 `F`、`第 1／4 拍`、`25%`，播放結束後狀態列隱藏且進行列高亮清除。既有 BPM 同步、鋼琴／五線譜高亮與播放流程維持。
第三十三版調式音級 1–7：音符控制由 1–6 擴充為 1–7，預設計數改為 `已選 1／7`，第 7 級依目前 KEY／SCALE 顯示對應音名；MODE 選單保留 `7th (Locrian)`。點亮／熄滅會同步更新 ARIA pressed、tooltip、選取計數與智慧和聲推導目標。
第三十三版隨機／手動提示：隨機與手動模式均加入 title、ARIA role／pressed、鍵盤 focus 與 pointerdown 觸控提示；瀏覽器以 touch pointer 事件實測兩者會顯示提示並約 1.8 秒後自動收起。隨機模式會從點亮的調式音級中隨機安排目標，手動模式沿用使用者指定音級。
第三十三版播放明細：播放智慧和聲期間狀態列新增文字化音符與級數，例如 `音符：F、A、C｜級數：4、6、1`，並與目前和弦、拍點、進度條、鋼琴／五線譜高亮同步；播放結束後狀態列隱藏且明細恢復為 `音符：—｜級數：—`。inline JavaScript `node --check`、`pnpm run check`、`pnpm run build` 通過。
第三十三版響應式截圖：1280×720 桌面畫面可見調式音級 1–7、已選計數、隨機／手動控制與和弦樹；390×844 直式畫面控制列折疊、七級調式與和弦卡片垂直排列，未發現水平溢出或元件互壓。
第三十四版七種調式修正：建立 `MODE_DATA` 作為七種 MODE 的共用資料源，C 主音實測結果全部符合指定音名與半音結構。Ionian 為 C-D-E-F-G-A-B（2,2,1,2,2,2,1）；Dorian 為 C-D-Eb-F-G-A-Bb（2,1,2,2,2,1,2）；Phrygian 為 C-Db-Eb-F-G-Ab-Bb（1,2,2,2,1,2,2）；Lydian 為 C-D-E-F#-G-A-B（2,2,2,1,2,2,1）；Mixolydian 為 C-D-E-F-G-A-Bb（2,2,1,2,2,1,2）；Aeolian 為 C-D-Eb-F-G-Ab-Bb（2,1,2,2,1,2,2）；Locrian 為 C-Db-Eb-F-Gb-Ab-Bb（1,2,2,1,2,2,2）。CDP 診斷顯示七個 MODE 均 `matches: true`，並同步得到正確調內三和弦品質與 MIDI 音高。
第三十四版 SCALE／MODE 分流：Major、Natural Minor、Dorian、Mixolydian 會同步對應 Ionian、Aeolian、Dorian、Mixolydian；Harmonic Minor 保留原有 SCALE 音階，直接選擇七種 MODE 時啟用 mode-aware 音階。`spellNote`／`spellScaleNotes`、和弦樹、鋼琴、五線譜與播放推導共用修正後音程資料；inline JavaScript `node --check`、`pnpm run check`、`pnpm run build` 通過。

第三十五版調式音級映射修正：逐一點擊調式音級 1–7 後，實際 `S.mode` 分別為 `1st (Ionian)`、`2nd (Dorian)`、`3rd (Phrygian)`、`4th (Lydian)`、`5th (Mixolydian)`、`6th (Aeolian)`、`7th (Locrian)`；C 主音音名與半音間隔逐項符合指定版本，七項 `modeMatches`／`notesMatch` 均為 `true`。MODE 下拉選單同步更新至第 7 級 Locrian，調式切換後保留全系統重繪與播放資料同步。

第三十六版公式顯示實測：重新載入後側欄在調式音級計數下方顯示「公式：全全半全全全半」與 `C-D-E-F-G-A-B`；切換至 Dorian 後同步顯示「全半全全全半全」與 `C-D-Eb-F-G-A-Bb`，任意 KEY／MODE 更新會在 render 後同步刷新。

第三十六版逐音預覽實測：點擊「音階預覽」後按鈕切換為「停止預覽」，狀態列顯示目前音名與 `第 n／8 音`，例如 Dorian 播放中顯示 `D／第 2／8 音`；八音播放完成後按鈕恢復「音階預覽」、狀態列隱藏。預覽使用目前 BPM 的 `60000／BPM` 間隔、`S.chordVol` 與目前樂器，並以獨立 `scalePreviewTimers` 管理；再次點擊可停止，與和弦／琶音／智慧和聲排程分離，開始其他和弦播放時會取消預覽。

第三十六版任意 KEY 七模式自動化：`cdp-v36-allkey-mode-audit.mjs` 覆蓋 C、C#、D、Eb、E、F、F#、G、Ab、A、Bb、B 共 12 個 KEY 與七種 MODE，合計 84 組；逐組驗證模式音程、音名音高類別、字母順序、根音拼寫、1–7 按鈕映射、MODE 下拉與公式 DOM，結果 `total: 84`、`passed: 84`、`failed: 0`。

第三十六版深色桌面回歸：切換月亮按鈕後 `darkModeBtn` 顯示「深色模式已啟用」，深藍黑工作台、側欄、公式資訊列、音階預覽按鈕、和弦樹與小鋼琴均維持清晰對比；1280×720 截圖未見新增的水平溢出或控制列互壓。

第三十六版逐音預覽排程回歸：在 120 BPM、C Dorian、`S.chordVol=0.37` 下，預覽建立 8 個獨立計時器，延遲為 0／500／1000／1500／2000／2500／3000／3500ms；按鈕顯示「停止預覽」、狀態列顯示 `C／第 1／8 音`。停止後 `scalePreviewActive=false`、計時器數量為 0、狀態列隱藏；點擊和弦時亦會取消預覽。`cdp-v36-scale-preview-audit.mjs` 結果為 `PASS`。

第三十六版響應式回歸：390×844 直式畫面中側欄折疊，公式與預覽控制不出現在內容外，和弦樹／小鋼琴垂直排列；844×390 橫式畫面中頂部控制列、兩欄和弦樹與固定版權列保持安全邊界，未見新增水平溢出或元件互壓。

第三十六版建置回歸：inline JavaScript `node --check`、`pnpm run check`、`pnpm run build` 與 `git diff --check` 均通過；Vite 僅保留既有 chunk size warning，沒有 TypeScript 或 production build 失敗。

第三十七版手機鋼琴修正：窄螢幕 `.piano-mini` 由原本固定上限 116px 改為在 640px 以下使用 `min(280px, calc(100vw - 44px))`，400px 以下使用 `min(260px, calc(100vw - 32px))`；900px 以下平板／橫式手機使用 `min(220px, 100%)`。白鍵音名加入內距、單行與容器裁切，黑鍵 C#／D#／F#／G#／A# 改用 5px 字級與負字距，確保兩字元標籤留在黑鍵內。

第三十七版鋼琴 DOM 量測：`cdp-v37-piano-audit.mjs` 實測 390×844 與 844×390，所有白鍵／黑鍵的 `textOverflow`、`withinX`、`withinY` 均通過，`overflowCount: 0`；手機截圖確認鋼琴放大後音名不再超出琴鍵，1280×720 桌面截圖確認原有緊湊尺寸與 MIDI 高亮維持。

第三十七版建置回歸：inline JavaScript `node --check`、`pnpm run check`、`pnpm run build` 與 `git diff --check` 均通過；Vite 僅保留既有 chunk size warning，未出現 TypeScript、語法或 production build 失敗。

第三十八版鋼琴互動：所有 `.piano-mini` 的白鍵／黑鍵加入 `data-midi`、ARIA 標籤、title 與 pointer 事件委派；滑鼠左鍵、觸控 pointerdown／pointermove／pointerup、Enter／Space 鍵盤操作均呼叫既有 `playNote`，並以 `pianoPointerKeys`／`pianoKeyboardKeys` 防止重複觸發，失焦時集中清除按下狀態。播放沿用 `S.chordVol` 與 `S.inst`，不受和弦層開關影響。

第三十八版黑鍵可讀性：黑鍵音名改為近白色 `#f6fbff`、800 字重，加入黑色雙層文字陰影；按下狀態改用高亮藍背景與反差文字。`cdp-v38-piano-staff-audit.mjs` 量得計算樣式 `rgb(246, 251, 255)` 且 `textShadow` 有效。

第三十八版五線譜二度音：`renderStaff` 對同一和弦中垂直距離小於 9.5px 的相鄰音符，從共同 `noteX=208` 依序向右以 13px 錯開，讓 note head 與 accidental 緊貼但不重疊；Sus2 與 Add9 測試的所有近距離音符間距均至少 13px。鋼琴觸控／鍵盤播放、黑鍵對比度與二度音定位 CDP 回歸均為 PASS。

第三十八版視覺與建置回歸：390×844 手機與 1280×720 桌面截圖確認琴鍵可讀、黑鍵標籤清晰、桌面尺寸與既有高亮維持；inline JavaScript `node --check`、`pnpm run check`、`pnpm run build` 與 `git diff --check` 均通過，僅保留既有 Vite chunk size warning。

第三十八版橫式手機回歸：844×390 及完整頁面截圖確認頂部控制列、和弦樹、鋼琴視覺化與固定頁尾可在橫向視窗中正常排列；鋼琴 DOM 互動量測與文字對比測試通過，未見琴鍵音名溢出或 pointer 狀態殘留。

第三十九版頁尾修正：`.copyright` 改為 `position:fixed; left:var(--sidebar-w); right:0; bottom:0`，手機／平板媒體查詢改為 `left:0; right:0`；`.main-layout` 使用 `height:calc(100vh - 50px - var(--footer-h))` 並加入 `min-height:0`，讓主要內容區預留固定 footer 高度而不遮蓋內容。版權文字改為可換行、可見溢出與居中對齊，並依 900／640／400px 斷點使用 30／32／34px footer 高度。

第三十九版 CDP 頁尾量測：`cdp-v39-footer-audit.mjs` 實測 390×844、844×390、768×1024、1280×720；四種尺寸均為 `position: fixed`，footer 完整位於 viewport 內，版權文字完整且位於 footer 邊界內，`.main-layout`／`.content` 底部與 footer top 對齊，`overflowX: false`、`overflowY: false`，結果 `v39 footer audit: PASS`。

第三十九版手機視覺回歸：390×844 直式與 844×390 橫式截圖確認「韶韻音樂學院 馬老師 專門為秀玲姊設計 和弦系統教學」固定顯示在最下方，未被和弦樹、鋼琴或短高度橫式內容裁切；桌面與平板量測亦維持側欄右側 footer 寬度與主要內容安全邊界。

第三十九版平板／桌面視覺回歸：768×1024 平板直式畫面中 footer 橫跨完整內容區並與側欄保持正確分界；1280×720 桌面畫面中 footer 固定於側欄右側底部，版權宣告完整可讀，和弦樹、鋼琴與主要內容沒有被 footer 遮蓋。

第三十九版建置回歸：inline JavaScript `node --check`、`pnpm run check`、`pnpm run build` 與 `git diff --check` 均通過；Vite 僅保留既有 chunk size warning，未出現語法、TypeScript 或 production build 失敗。

第四十版中級和弦類型展開狀態：新增 `S.intermediateOpenGroups`，以目前 KEY／SCALE／根音／和弦類型作為狀態鍵；前三種既有預設展開類型維持初始開啟，其餘類型維持自動收納。中級和弦標題改由 `toggleIntermediateGroup()` 控制並同步 `aria-expanded`，點按 chord-cell 觸發 `render()` 後會依狀態表恢復原展開狀態，只有明確點擊標題才會收納。

第四十版 CDP 回歸：`cdp-v40-intermediate-open-audit.mjs` 驗證已展開類型點按和弦後仍為 open、手動標題切換可關閉、原本收納類型手動展開後點按和弦仍保持 open，結果 `v40 intermediate open-state audit: PASS`。既有鋼琴／五線譜／和弦播放邏輯未被改動。

第四十版難度切換補強：同一支 CDP 腳本切換 `Beginner`、`Diatonic`、`Intermediate` 並確認各自主要 DOM 與和弦類型區塊存在，三項均為 `true`；中級展開狀態測試仍為 `v40 intermediate open-state audit: PASS`。

第四十版建置回歸：inline JavaScript `node --check`、`pnpm run check`、`pnpm run build` 與 `git diff --check` 均通過；Vite 僅保留既有 chunk size warning，未出現語法、TypeScript 或 production build 失敗。

第四十一版和弦種類圖：難度選單的 `Intermediate` 顯示文字改為「和弦種類圖」；新增 `S.intermediateRoot` 與 `S.intermediatePreviewType`，預設根音為 C，並在和弦列表右側同步顯示目前根音／和弦類型的視覺化鋼琴與五線譜。根音按鈕可循環切換 C、bD／#C、D、bE／#D、E、F、#F／bG、G、bA／#G、A、bB／#A、B，且不改寫側欄全域 KEY。

第四十一版全部展開／收納：和弦列表上方新增「全部展開」與「全部收納」；前者開啟目前根音的 15 個和弦類型，後者全部關閉，並沿用 `S.intermediateOpenGroups` 與既有手動類型狀態。`cdp-v41-chord-map-audit.mjs` 驗證初始 C、兩個控制按鈕、12 個根音標籤、根音切換後鋼琴／五線譜、和弦點按後預覽同步與 Beginner／Diatonic／Intermediate 三種難度，結果 `v41 chord-map audit: PASS`。

第四十一版視覺回歸：1280×720 桌面與 390×844 手機截圖確認既有遊戲版面、鋼琴與頁尾未被破壞；和弦種類圖在手機以列表／預覽上下排列，避免控制列與視覺化內容互壓。
第四十二版根音箭頭與和弦清單：新增 `cycleIntermediateRootPrev()` 函式，根音控制列改為「◀ 根音 ▶」三件式按鈕；和弦格加入 `chord-cell-play-btn` 獨立播放按鈕，點擊後觸發 `playChord()` 且不改選取狀態。`INTERMEDIATE_TYPES` 擴充至 41 種，包含參考圖 1/2 的大小調、延伸、掛留、增減與 Power 和弦。`cdp-v42-chord-map-audit.mjs` 驗證左右循環、每格播放、清單完整性與 390px 無溢出，結果 `v42 chord-map audit: PASS`。
第四十三版智慧和聲狀態：新增 `smartHarmonyProgression`，播放智慧和聲時在狀態列顯示完整「進行：A → B」與目前和弦／拍點；清除時間改依最後一個和弦的實際音源 release tail 計算，直到最後音效完成才隱藏，並可由新的播放或設定變更安全取消。
第四十三版預覽和弦播放：和弦種類圖右側實體化鋼琴／五線譜下方的類型按鈕改呼叫 `previewIntermediateChord()`，切換預覽後直接沿用 `playChord()` 播放完整和弦，且不改變 `S.activeChord`；CDP 實測播放呼叫 1 次、MIDI `[48,52,55]` 有效。
第四十三版五線譜音名定位：和弦組成音名由 SVG 底部移至最高譜線上方，現以 `y=24` 顯示於最高譜線 `y=30` 上方，桌面與手機均可見且不遮擋音符；CDP `staffAudit.allAboveStaff: true`。
第四十三版回歸：`cdp-v43-harmony-preview-audit.mjs` 驗證智慧和聲播放中狀態 `hidden=false`、完整進行文字存在，播放完成後 `hidden=true`；預覽按鈕播放與選取狀態、五線譜音名、390×844／844×390 水平溢出與固定頁尾均 PASS。inline JavaScript `node --check`、`pnpm run check`、`pnpm run build` 與 `git diff --check` 通過；Vite 僅保留既有 chunk size warning。
第四十四版五線譜音域：新增 `STAFF_MIN_POS=-6`（下加二線 A3）與 `STAFF_MAX_POS=10`（上加二線 C6），`fitStaffNotes()` 對每個和弦音進行保留字母與音程的八度調整，必要時將跨距過大的個別音移入可視範圍並依譜面位置排序。12 根音 × 41 種類型共 492 組音域檢查通過，實測最低位置 `-6`、最高位置 `7`、無越界項目。
第四十四版五線譜容器：`.staff-wrap` 提高至 168px，和弦種類圖 `.chord-map-visuals .staff-wrap` 提高至 176px，SVG 改為 `overflow:visible`；CDP 確認 viewBox `280×106` 內高音譜記號 `x=20,y=21.5,width=28,height=64` 完整可見，音符在 SVG 內，音名仍位於最高譜線 `y=30` 上方。
第四十四版預覽播放狀態：`playNote()` 回傳可停止的 oscillator／gain 物件，`previewIntermediateChord()` 保存預覽音源與完成計時器；預覽按鈕播放中顯示紅色 `■ 停止`，轉位按鈕顯示 `■`，再次點擊會停止音源、清除計時器並恢復未播放狀態，不改變 `S.activeChord`。
第四十四版回歸：`cdp-v44-staff-preview-audit.mjs` 驗證 492 組音域、譜號完整性、底部類型按鈕播放／停止、轉位按鈕播放／停止與 `S.activeChord===null`，結果 `v44 staff-preview audit: PASS`；1280×720、390×844、844×390 均無水平溢出且頁尾與預覽面板在視窗內。inline JavaScript `node --check`、`pnpm run check`、`pnpm run build` 與 `git diff --check` 通過；Vite 僅保留既有 chunk size warning。
第四十五版 Groove 音量與雜音修正：Groove 仍經由獨立安全混音總線，輸出前級與特色聲部峰值提升，保留 headroom、DynamicsCompressorNode、soft limiter 與輸出限制；tone／noise 聲部均先以短 attack／release fade 歸零再停止，降低 abrupt stop 造成的啵啵聲。產品靜態檢查與互動回歸通過；完整 RMS 腳本因瀏覽器無使用者手勢時卡在 AudioContext resume，已安全終止，未將無手勢量測結果冒充為通過。
第四十五版 Groove 說明與琶音：切換節拍器至 Groove 不再自動開啟說明 modal，只有按下旁邊的 Groove 詳細說明按鈕才會開啟；琶音模式移除四分音符，側欄與操作說明只保留十六分音符，排程仍使用 `60000 / BPM / 4` 間隔。
第四十五版循環次數：1x／2x／4x 現在代表整段和弦序列的重播次數，播放完成 1、2 或 4 輪後自動停止；不等同於左上方持續循環開關。按鈕補上 `aria-pressed`、Enter／Space 鍵盤操作與「播放重播次數：N 次」提示，預設 2x。
第四十五版回歸：`cdp-v45-groove-arp-loop-audit.mjs` 驗證 Groove 切換不自動彈窗、Groove 說明按鈕可單獨開啟、十六分音符唯一選項、混音總線與 limiter、1x／2x／4x 狀態／提示／可及性及 390×844 水平版面；桌面／手機截圖完成。inline JavaScript `node --check`、`pnpm run check`、`pnpm run build` 與 `git diff --check` 通過；Vite 僅保留既有 chunk size warning。
第四十六版 Groove 輸出與監測：安全總線加入 analyser，Groove 播放時顯示峰值／RMS 即時 meter，停止節拍器、切回木魚或取消播放時取消 `requestAnimationFrame` 並清空數值。輸出增益、壓縮器與 soft limiter 維持安全 headroom，聲部以短 attack／release fade 歸零後停止，降低 100% 音量下的劈哩啪啦／波波聲；代表性混音狀態檢查通過。
第四十六版循環進度列：新增目前輪次、總輪數、剩餘輪數與段落進度，和弦序列以 1x／2x／4x 重播時同步更新顯示，完成最後一輪與尾音後回到播放待機；停止或切換播放模式會清除 meter 與進度狀態。
第四十六版回歸：`cdp-v46-groove-meter-progress-audit.mjs` 驗證 Groove meter 播放／停止生命週期、analyser 建立與清理、循環進度文字、100% 輸出路由及 390×844 無水平溢出；1280×720 與 390×844 截圖完成。inline JavaScript `node --check`、`pnpm run check`、`pnpm run build` 與 `git diff --check` 通過。瀏覽器無使用者手勢下的 AudioContext RMS 實際取樣受 resume 限制，未將未完成的量測程序冒充為通過。
第四十七版播放監視器：將輪次進度、Groove meter、峰值保持與削波警示整合至 `#playbackMonitor`，支援 `#playbackMonitorToggle` 收合／展開、`aria-expanded` 與 Enter／Space 操作；監視器內容使用 `min-width:0`、`max-width:100%` 與窄版 grid 收縮，避免右側超出畫面。
第四十七版 BPM 變速與 Groove 音源：BPM 變更加入 debounce，舊 `metroInterval` 與所有 `grooveVoiceStops` 先以短淡出停止，再重建新排程；peak hold 以衰減計時器保留最近峰值，clip threshold 觸發時顯示削波警示並限制後續輸入增益。音源停止前先將 gain 淡出，降低快速 30–300 BPM 變速時聲部重疊與突變造成的破音。
第四十七版回歸：`cdp-v47-monitor-bpm-audit.mjs` 驗證 30／72／300 BPM 變更後舊音源清理、Groove analyser／meter 啟停、peak-hold／clip 狀態、4x 輪次文字、監視器收合與 390×844 `scrollWidth` 無溢出；結果 PASS。inline JavaScript `node --check`、`pnpm run check`、`pnpm run build`、`git diff --check` 與 1280×720／390×844 截圖回歸完成。無使用者手勢的瀏覽器 AudioContext 量測仍受 resume 限制，未虛構峰值／RMS 數值。

第四十八版五線譜定位：`fitStaffNotes` 改以整數 `staffPos` 差值判斷水平錯位，只有相鄰二度音（差值 `1`）向右移動 13px；三度音（差值 `2`）及其他非二度音保持共同 `noteX`。CDP 直接解析 `renderStaff()` 的 SVG：C–E–G 得到 `[208,208,208]`，C–D–G 得到 `[208,221,208]`，確認三度置中、二度單獨避讓。
第四十八版播放監視器穩定性：`#playbackMonitor`、Groove meter 與 `.groove-clip-alert` 加入固定最小尺寸；峰值／RMS／peak-hold 數值保留固定字寬，削波提示改用 `visibility` 與 `aria-hidden` 切換並保留 37px 內容高度。Groove meter 播放取樣 18 個 animation frames，琶音、循環、鋼琴與五線譜的 x／y／寬高最大變化為 `0px`。
第四十八版 BPM 與清理：BPM 滑桿維持局部 DOM 更新與 200ms debounce；`stopMetronome()` 額外取消尚未到期的 `tempoRestartTimer`，避免關閉節拍器後延遲回呼重新啟動排程。第四十八版專用 `cdp-v48-staff-monitor-audit.mjs` 驗證監視器收合、300 BPM debounce、meter 固定高度 138px、削波提示隱藏高度 37px、停止後 meter／Raf／Groove voice 清理與 390px `scrollWidth`，結果 `v48 staff-monitor audit: PASS`。
第四十八版回歸：inline JavaScript `node --check`、`pnpm run check`、`pnpm run build` 與 `git diff --check` 通過；dev server、browser console 與 network 回歸未發現新增錯誤。完成 1280×720 桌面全頁及 390×844 手機直式全頁截圖，確認下方控制區與固定頁尾維持響應式排列。

第四十八版增補—可信手勢音訊量測：新增 `cdp-v48-supplemental-audit.mjs`，以 CDP `Input.dispatchMouseEvent` 點擊 Groove 模式按鈕，讓 AudioContext 在實際可信使用者手勢下啟動。量測結果確認 `AudioContext.state === running`、Groove analyser 與 meter 啟用；連續取樣可得到非零 peak／RMS（最終整合回歸最大值 peak `0.590`、RMS `0.227`，非零樣本 5 筆），不再將無手勢時受瀏覽器限制的零值誤作音訊輸出結果。
第四十八版增補—監視器高度偏好：播放監視器標頭新增「鎖高／解鎖」按鈕，透過 `localStorage` 保存偏好與量測高度。實測鎖定高度為 `188px`，8 個 animation frames 的高度差為 `0px`；收合後仍保留鎖定 class 與 aria 狀態，重新展開恢復 `188px`；頁面重載後 `localStorage`、按鈕 `aria-pressed`、鎖定 class 與 CSS 高度變數均正確恢復。
第四十八版增補—播放中響應式截圖：以活躍 Groove 狀態開啟側欄並捲至播放監視器，完成 `768×1024` 平板直式與 `844×390` 手機橫式 PNG 回歸。兩種 viewport 均為 `scrollWidth === innerWidth`，播放監視器 x 座標 `7px`、右緣 `146px`，meter 與下方控制區不超出畫面。截圖存放於 `/home/ubuntu/webdev-static-assets/KIMIchord-v48-tablet-playback.png` 與 `/home/ubuntu/webdev-static-assets/KIMIchord-v48-landscape-playback.png`；視覺檢查結論另存於 `v48-supplemental-visual-findings.md`。

第四十九版五線譜堆疊：前版逐音音域折回會把原本 C–E–G–B 的字母級距拆散，使 C7、Add9 等和弦產生假二度。`fitStaffNotes` 現在優先將整個和弦共同移八度至下加二線（A3）至上加二線（C6）範圍，保留每個和弦原本的三度堆疊；僅在無法共同容納的極端情況才逐音折回。`cdp-v49-staff-groove-audit.mjs` 解析和弦種類圖 SVG，Major、Minor、C7 與 Cadd9 的 `noteX` 均為 `[140,…]`；Csus2 為 `[140,153,140]`，證明只有真正相鄰二度向右避讓。
第四十九版 Groove 安全混音：單聲部瞬態上限降至 `0.16`，Groove 總線調整為 input `0.46`、compressor threshold `−30dB`、ratio `14:1`、attack `2.5ms`、release `180ms`、output `0.90`，並以較平滑 soft limiter 和 `4×` oversampling 限制尖峰。可信手勢回歸的 representative 量測最大 peak `0.143`、RMS `0.059`，音訊仍正常產生且輸出保有更多安全餘裕。
第四十九版削波可讀性：削波觸發值調整為 peak `78%` 或 RMS `58%`，警示至少保持六秒；紅字明確顯示「削波保護：Groove 音量過高，已自動降低輸出。請降低節拍器音量。」播放期間顯示「削波保護」或「削波保護（保持）」；停止後回到待機並隱藏警示，不會讓紅字只閃現一幀。
第四十九版回歸：`v49 staff-groove audit: PASS`，涵蓋 Major／Minor／Sus2／Add9／C7 五線譜定位、可信手勢 AudioContext、總線安全參數與削波提示啟用／保持／停止重設。inline JavaScript `node --check`、`pnpm run check`、`pnpm run build`、`git diff --check` 通過，browser console 與 network 未出現新增錯誤；完成 1280×720 桌面及 390×844 手機全頁截圖。

第五十版自訂和弦進行：和弦種類圖下方新增可擴充的「自訂和弦進行」面板。每行固定四格，每格選擇根音與完整和弦種類後可單獨預聽；「＋新增一行（四組）」可不限次數增加四格，另有刪除末行與清除全部。資料直接使用 `CHORDS`、`NOTE_I`、既有鋼琴／五線譜預覽與 Web Audio 路由，避免另建一套和弦定義。
第五十版播放與錄音：播放鍵依目前 BPM 與循環輪次逐拍排程，格子有播放中高亮，停止會清理 timer、音源與高亮。錄製自訂進行會先以既有 MediaRecorder 啟動錄音，再播放自訂進行，錄音按鈕顯示「● 錄音中……」並鎖定重複觸發；第五十版 CDP 以可信點擊驗證 `isRecording: true`、按鈕 disabled 與自訂播放 active 狀態。
第五十版 MIDI／JSON：MIDI 匯出寫入 Type 0 `MThd`／單一 `MTrk`、96 PPQ、tempo meta event、每格完整和弦 note-on／note-off 與 End-of-Track。兩行八格回歸輸出 302 bytes，宣告／實際 track length 均為 280、32 個 note-on 與 32 個 note-off。JSON 匯出包含 `format: "KIMIchord Custom Chord Progression"`、version、tempo、cycleCount 與 progression；匯入會驗證格式與版本，將無效根音／類型安全略過並補足四格列。round-trip 驗證 C Major、G Dominant 7、空白格、A Minor 正確還原。
第五十版響應式與建置：`v50 custom-progression audit: PASS` 驗證一行四格起始、兩行八格擴充、選單編輯、播放／停止、錄音、MIDI 二進位與 JSON round-trip。`v50 custom-responsive audit: PASS` 驗證 1280×720 與 390×844 兩行八格、七個操作按鈕、`scrollWidth === innerWidth` 與零子項溢出；視覺檢查記錄於 `v50-custom-progression-visual-findings.md`。inline JavaScript、CDP script、TypeScript、production build 與 `git diff --check` 均通過。

第五十一版常用範本：自訂和弦進行面板新增三個可編輯按鈕，並透過既有 `S.customProgression` 與四格列渲染路徑載入資料。`cdp-v51-template-harmony-groove-audit.mjs` 以實際 DOM 點擊驗證流行範本為 C Major／G Major／A Minor／F Major，爵士範本為 C Major 7／A Minor 7／D Minor 7／G Dominant 7；古典範本為八格兩行 C／G／A minor／F／D minor／G／C／C。三類範本載入後的選單均維持可編輯狀態。

第五十一版播放智慧和聲：修正 `renderProgression()` 內的未定義狀態引用，避免重新渲染例外中斷「⌁ 播放智慧和聲」按鈕。可信點擊回歸確認產生四個進行 chip、恰有一個目前和弦高亮、狀態列顯示 C、`第 1／4 拍` 及 `音符：C、E、G｜級數：1、3、5`，且 AudioContext 為 `running`；停止後狀態列隱藏、chip 高亮與 timer 全部清除。

第五十一版 Groove 交叉淡出：啟動／變速重排程時，`stopMetronome()` 先取消舊 interval、淡出總線與既有聲部，新的 Groove 排程以 50ms `grooveStartTimer` 延後建立，避免在非零交叉點硬截斷或立即疊加。可信點擊回歸觀察首次啟動期間為「start timer pending、interval inactive」，淡出完成後才出現單一 interval 與啟用的 meter；108 BPM 重排程亦先回到 pending，然後恢復 interval／meter。停止後 `grooveStartTimer`、`metroInterval`、meter 與 `grooveVoiceStops` 均已清理。

第五十一版響應式與建置：CDP 在 390×844 驗證 `scrollWidth === innerWidth === 390`，三個範本按鈕皆落於視窗範圍內，窄螢幕採兩欄換行。另完成 1280×720 桌面與 390×844 手機全頁截圖基線檢查。inline JavaScript `node --check`、`pnpm run check`、`pnpm run build`、`git diff --check` 與 `v51 template-harmony-groove audit: PASS` 均通過；Vite 僅輸出既有大型 chunk 警告。

第五十二版自訂進行排序與搜尋：每個四格列加入「⠿」拖曳把手與 pointer 事件流程，桌面可拖曳排序，手機可長按後拖曳；拖曳完成會更新同一份 `S.customProgression` 資料，因此預聽、逐拍播放、錄音、MIDI 與 JSON 匯出均沿用新順序。加入目標格「⌕」及和弦名稱搜尋，可依根音、完整類型、縮寫或中文類型過濾；可信互動回歸輸入 `Cmaj7` 得到 `Cmaj7 · 大七和弦` 等結果，套用至第 1 格後資料為 `{note:'C',q:'Major 7'}`，再拖到第 4 格後順序為 G、Am、F、Cmaj7。搜尋套用改為先停止現有播放、再取得正規化資料，避免停止流程重設陣列後寫入過期參考。

第五十二版手機檔案選單：原本分散的 MIDI／JSON 操作收納至「⋯ 檔案操作」按鈕；面板採右側錨定、最大寬度與窄螢幕右對齊，點按可展開或收合，匯出／匯入前會安全關閉。390×844 CDP 回歸顯示觸發按鈕 `left=20`、`right=364`，展開選單 `left=84`、`right=364`，兩者皆完整位於 390px 視窗內，且 `scrollWidth=390`，不再越出左側。

第五十二版手機和弦瞬態：診斷確認單一和弦會同時建立多個振盪器，先前直接輸出且 10ms 起音在手機小型喇叭與快速觸控重複事件下容易形成瞬態啵啵聲。新增獨立和弦總線：0.52 輸入 headroom、壓縮、4× oversampling soft limiter、26Hz high-pass 直流阻隔與錄音分流；各樂器的 gain 改由接近零的安全起點平滑淡入／淡出，並將快速重複觸發限制為 36ms 內只建立一組音源。可信手機觸控回歸確認 AudioContext 為 `running`、總線峰值約 0.589（低於 0.8）、limiter 為 `4x`、直流阻隔為 26Hz；連續三次同瞬態 `playChord` 僅建立三個 C 大三和弦音源，而非九個，且未啟動琶音計時器。

第五十二版總回歸：`cdp-v52-custom-interaction-audio-audit.mjs` 通過；完成 1280×720 桌面與 390×844 手機全頁截圖。inline JavaScript `node --check`、`pnpm run check`、`pnpm run build` 與 `git diff --check` 均通過；Vite 僅保留既有大型 chunk 警告。

第五十三版下載錄音手機選單：問題來源為錄音完成後顯示的原生 `<audio controls>`；其行動瀏覽器「⋯」浮動選單不在本頁 CSS 可控邊界內，因此在手機直式可能向左越界。移除原生控制列，音訊元素改為隱藏的播放引擎；既有「回放」、「下載錄音」與自訂時間軸保留作為唯一可見操作介面，因此不再產生原生三點展開選單。

第五十三版手機直式回歸：`cdp-v53-recording-menu-mobile-audit.mjs` 在 390×844 以可下載錄音資料驗證 `scrollWidth=390`、`recordingAudio.hidden=true`、`controls` 屬性不存在、computed `display=none`；下載按鈕與時間軸均可用。五個錄音控制及時間軸的左右邊界全在 0–390px 內，且完成 390×844 全頁截圖。inline JavaScript `node --check`、`pnpm run check`、`pnpm run build` 與 `git diff --check` 均通過；Vite 僅保留既有大型 chunk 警告。

第五十四版音訊根因與路由修正：診斷顯示原先和弦與 Groove 各自串接壓縮、limiter、DC 阻隔與錄音分流，兩條處理鏈在共同輸出／錄音情境下造成重複增益處理；Groove 的噪聲與振盪器又以極短、非同步的包絡啟停，手機揚聲器容易將低頻、DC 偏移與非零交叉點截斷放大成雜音或啵啵聲。重整為單一 `masterMix`：兩個子混音僅保留保守 input gain 與 DC 阻隔，統一送進 0.42 input headroom、30Hz high-pass、12.5kHz 低通、單一 compressor、4× oversampling soft limiter 及 0.74 master output；錄音僅由這個主輸出分流，消除雙重後製與互調。

第五十四版包絡與生命週期：Groove 的 tone／noise 聲部統一由近零 gain 平滑淡入，保留 6–12ms 起音與至少 35ms 收尾；noise buffer 延後 stop 至 gain 已降回近零之後。Groove 子總線切換後以 75ms 回復至 0.72，所有舊聲源仍由既有淡出與 `grooveVoiceStops` 集合清理。和弦則維持專用 34Hz DC 阻隔與 36ms 快速重複觸發保護，但改送進主總線，不再另行壓縮／limiter。

第五十四版可信手機音訊回歸：`cdp-v54-clean-audio-master-audit.mjs` 在 390×844 的可信觸控下通過。單一 C 大三和弦主輸出峰值約 0.037、RMS 約 0.016、DC 約 -0.00055；快速重複觸發峰值約 0.058、RMS 約 0.025、DC 約 -0.00103，三次同瞬態只建立一組三音聲源。Groove 啟動時使用同一主總線，峰值約 0.0094、RMS 約 0.0031、DC 約 0.00022，`metroInterval` 與 meter 均啟用；停止後 interval、meter、start timer 與 `grooveVoiceStops` 全部歸零。主總線的 30Hz 高通、12.5kHz 低通、0.42 input、0.74 output、Chord 34Hz／Groove 42Hz DC 阻隔與單一輸出路徑均已由腳本驗證。

第五十四版建置與畫面回歸：inline JavaScript `node --check`、`pnpm run check`、`pnpm run build` 與 `git diff --check` 均通過；390×844 手機全頁畫面維持和弦樹、鋼琴與固定頁尾的既有安全版面。Vite 僅保留既有大型 chunk 警告。

第五十五版手機純淨模式：設定側欄新增 `#mobilePureMode` 開關與用途說明。開啟時透過 `setMobilePureMode()` 即時套用並以 `kimichord.mobilePureMode=1` 保存；關閉時保存 `0` 並回復一般模式。設定載入不會主動建立 AudioContext，使用者首次播放後才建立既有音訊圖；純淨模式開關在 390px 側欄開啟流程下可見且邊界在視窗內。

第五十五版音訊預設：純淨模式將主總線 input/output 設為約 0.32／0.62、主高通／低通為 75Hz／7.8kHz、compressor threshold／ratio 為 -25dB／9:1；和弦子總線為 0.30／0.66、62Hz，Groove 子總線為 0.26／0.60、75Hz。一般模式可回復至主總線約 0.42／0.74、30Hz／12.5kHz、-21dB／7:1，和弦 0.38／0.76、34Hz，Groove 0.34／0.72、42Hz。Groove 交叉淡出恢復輸出已改讀取目前 profile，避免開始時覆寫純淨模式的保守輸出。

第五十五版可信手機回歸：`cdp-v55-mobile-pure-mode-audit.mjs` 在 390×844 執行真實側欄開啟與開關操作，確認純淨模式下 C 大三和弦與 Groove 單步聲部均經主總線輸出，純淨 profile 的層級參數正確，`scrollWidth=390` 且開關左右邊界完全在視窗內。測試再切回一般模式，確認完整頻寬參數恢復；最後重新開啟純淨模式並重載，`S.mobilePureMode`、localStorage 與 checkbox 均維持啟用。inline JavaScript `node --check`、`pnpm run check`、`pnpm run build` 與 `git diff --check` 均通過；Vite 僅保留既有大型 chunk 警告。

第五十六版弦樂類琶音根因與修正：原先「管弦鋼琴」與「弦樂」在十六分音符高 BPM 下沿用長尾音，下一顆音符到來時前一組雙振盪器仍未完全釋放，濾波後的複音尾音與新起音重疊，容易在手機小型揚聲器形成低頻拍頻與啵啵聲。琶音分支改為專用短尾 voice：保留平滑 9–26ms 起音，音量在每顆音值的約 78% 內以指數曲線降至近零，並只保留 10ms 靜音保護後停止。一般和弦層、錄音分流、Groove 與木魚路徑均未變更。

第五十六版可信手機琶音回歸：`cdp-v56-string-arp-clean-audit.mjs` 在 390×844、300 BPM、十六分音符與手機純淨模式下，以可信觸控解鎖 AudioContext。管弦鋼琴與弦樂各建立三個循序琶音 voice，每顆 voice 均為兩個振盪器，音值 36ms；管弦鋼琴 release 約 38.08ms、弦樂約 40ms，均短於 50ms 音符間隔。管弦鋼琴峰值／RMS／DC 約為 0.0116／0.00240／0.000148；弦樂約為 0.0410／0.01795／-0.000646；均低於峰值 0.22 與 DC 0.012 的回歸門檻。清理後 `arpTimers=0`，確認無殘留琶音排程。

第五十六版建置與畫面回歸：inline JavaScript `node --check`、`pnpm run check`、`pnpm run build` 與 `git diff --check` 均通過；390×844 手機全頁畫面維持和弦樹、鋼琴與固定頁尾的既有安全版面。Vite 僅保留既有大型 chunk 警告。

第五十七版音色替換：樂器選單已將「管弦鋼琴」改為「長笛」，將「弦樂」改為「豎琴」。長笛採單一正弦主振盪器加極低量泛音與 2200Hz 低通，豎琴採短暫雙正弦泛音與 3600Hz 低通；兩者均避開原先弦樂雙齒鋸波／長尾波形帶來的低頻拍頻。一般和弦仍可使用各自的自然延音；十六分音符琶音則使用專用短尾、平滑 voice。

第五十七版琶音包絡與手機量測：`cdp-v57-flute-harp-arp-audit.mjs` 在 390×844、300 BPM、十六分音符與手機純淨模式下，以可信觸控解鎖 AudioContext。長笛與豎琴各排程三個循序 voice，音值 36ms、尾音約 40ms，短於 50ms 音符間隔；長笛每顆為一個振盪器、豎琴每顆為兩個振盪器。長笛峰值／RMS／DC 約 0.0261／0.0084／0.00036；豎琴約 0.0156／0.0058／-0.00021，均低於峰值 0.22 與 DC 0.012 回歸門檻。所有聲部皆經主總線，結束後 `arpTimers=0`，無殘留琶音計時器。

第五十七版建置與介面回歸：inline JavaScript `node --check`、`pnpm run check`、`pnpm run build` 與 `git diff --check` 均通過；1280×720 桌面與 390×844 手機代表畫面確認樂器控制與既有固定頁尾維持安全版面。Vite 僅保留既有大型 chunk 警告。

第五十八版根因隔離：`cdp-v58-chord-pop-fix-audit.mjs` 以 390×844 可信觸控分別量測長笛與豎琴的單音、C 大三和弦、一般／手機純淨模式與提前停止。原先單音的 DC 偏移皆遠低於 0.008，三和弦峰值亦受主總線控制（一般模式：長笛約 0.0925、豎琴約 0.0616；純淨模式：長笛約 0.0487、豎琴約 0.0305），因此啵啵聲並非長笛或豎琴的波形本身、DC 偏移或主總線削波；可重現的風險在於一般和弦以三個獨立 voice 同時進入總線，且預覽停止以極短 `setTargetAtTime` 後直接停止來源，會令手機揚聲器接收到重疊的寬頻起止瞬態。

第五十八版複音修正：長笛與豎琴的非琶音和弦現在建立一個共享複音總線，三和弦收納為一個六振盪器 voice，總線自近零值以 10–12ms 線性淡入；每個樂器原有的音色濾波與自然延音仍保留。`stopPreviewVoice()` 改為先保持目前增益並在 28ms 內明確線性淡出，於多留 6ms 靜音保護後才停止全部來源，消除預覽切換時的硬截斷。十六分音符琶音仍沿用獨立短尾 voice，未被共用總線改動。

第五十八版可信手機回歸：一般和弦回歸確認單音為一個共享總線、三和弦為一個六振盪器共享總線；四種組合的 DC 偏移均低於 0.008，三和弦峰值低於單音峰值的 2.7 倍門檻，提前停止後主輸出峰值均低於 0.035，無殘留琶音計時器。既有 `cdp-v57-flute-harp-arp-audit.mjs` 亦再次通過，確認 300 BPM／十六分音符／手機純淨模式下的短尾琶音模型不受影響。inline JavaScript `node --check`、`pnpm run check`、`pnpm run build` 與 `git diff --check` 均通過；Vite 僅保留既有大型 chunk 警告。

第五十九版桌面木魚輸出根因與修復：木魚節拍器原本透過和弦子總線再送往主輸出，額外 headroom 導致桌面 65% 預設節拍音量過低，容易被一般系統輸出或瀏覽器音量掩蓋。木魚現改為直接接入共享主總線，保留一般／手機純淨模式的主高通、頻寬保護、壓縮及 limiter；第一拍與第二至第四拍仍使用既有的不同安全包絡，Groove XOR 行為不變。

第五十九版桌面可信手勢回歸：AudioContext 為 `running`、木魚計時器已啟動；木魚經主總線測得 peak `0.02198`、RMS 非零，和弦子總線為零，符合直送主輸出設計。`cdp-v59-metronome-fourbeat-audit.mjs` 已通過木魚、純淨模式、Groove XOR 與播放停止清理測試。

第五十九版四拍進行與四分琶音：智慧和聲、自訂進行、調內與和弦樹的每一個和弦皆以 `4 × 一拍` 切換；自訂進行的錄音與 MIDI Type 0 note-off／休止時值同步調整。琶音統一為每拍一音：三和弦為 `[根、三、五、高八度根]`，七和弦為 `[根、三、五、七]`。72 BPM 回歸確認一拍 `833.33ms`、一和弦 `3333.33ms`，四個琶音聲部均在同一和弦的四拍視窗內平滑收尾。

第五十九版建置與介面回歸：inline JavaScript `node --check`、`pnpm run check`、`pnpm run build` 及 `git diff --check` 均通過；1280×720 與 390×844 全頁截圖確認桌面與手機直式仍保留既有和弦樹、鋼琴、行動版導覽與固定頁尾，未觀察到水平溢出。Vite 僅保留既有大型 chunk 警告。

第六十版 Groove 根因與修復：Groove 切換後的 `restoreGrooveOutput()` 仍引用已在第五十九版音訊架構重整時移除的 `getAudioProfile()`。此 ReferenceError 發生在第一個 Groove 聲部排程之前，使桌面瀏覽器雖顯示 Groove 計時器已啟動，實際上未進入打擊樂排程。現改用與手機純淨模式一致的安全目標增益：一般模式 0.82、純淨模式 0.60；一般模式 Groove 子總線使用 input 0.50、output 0.82，主高通、壓縮器與 limiter 維持保護。

第六十版四拍視覺與延音：播放監視器新增四格拍點列，第一拍使用較明顯的主拍輪廓；木魚、Groove、和弦播放均逐拍切換，停止後回到待機。當和弦開啟且琶音關閉時，樂器聲部保持至第四拍末前約 28–75ms 才平滑收尾；琶音仍維持既有每拍一音短尾包絡。72 BPM 桌面回歸量得四拍和弦時值 3333.33ms、長笛單獨和弦聲部 3317.33ms，符合第四拍末端淡出。

第六十版可信桌面回歸：`cdp-v60-groove-beat-sustain-audit.mjs` PASS。Groove 測試確認 AudioContext 為 running、Groove 計時器與 meter 均已啟動、Groove output 為 0.82，主／Groove analyser 峰值達 0.0294，證實已有實際輸出；四拍指示器由第 1 拍正確移至第 2 拍；單獨和弦延音確認保持至第四拍視窗末端。inline JavaScript `node --check`、`pnpm run check`、`pnpm run build` 與 `git diff --check` 均通過；1280×720 與 390×844 截圖確認版面無水平溢出。Vite 僅保留既有大型 chunk 警告。

第六十一版 Groove 可聽輸出根因與修復：第六十版已修復 Groove 切換時的 ReferenceError，但每一個 Groove 聲部仍同時受到外層共享包絡及內層 tone／noise gain 的兩次幅度衰減。Hi-hat、刷鈸、沙鈴與拉丁細節在桌面喇叭上因此只留下短暫起音啵聲，無法形成可辨識節奏。共享包絡現僅處理聲部群組的平滑起收音；實際力度只由對應 tone／noise gain 管理，消除重複衰減。

第六十一版音色改善：大鼓、EDM 大鼓與 Sub Kick 加入平滑的高至低頻率下滑及 0.32–0.42 秒中低頻延續；小鼓、closed Hi-hat 與 bass 的可聽音尾與頻寬已提高，保留各類 Groove 的音色差異。所有聲部仍從零增益起音並在 35ms 以上淡出，維持既有避免 click、削波與手機純淨模式的保護設計。

第六十一版桌面可信聽感代理回歸：`cdp-v61-desktop-groove-audibility-audit.mjs` PASS。Rock、Swing、Samba、EDM 與 Funk 均在有效節奏視窗中量得 peak 0.075–0.200、RMS 0.032–0.082，且連續能量視窗為 9–15 個；確認不再只有單次瞬態。AudioContext 維持 running、Groove 計時器保持啟動、Groove 子總線 input 0.72、output 0.92，並保留木魚／Groove XOR。inline JavaScript `node --check`、`pnpm run check`、`pnpm run build`、`git diff --check` 與 1280×720 全頁畫面檢查均通過；Vite 僅保留既有大型 chunk 警告。

第六十二版高音譜記號恢復：所有五線譜共用 `renderStaff()` 的譜號圖片仍指向失效的舊網站儲存路徑，造成一般五線譜、和弦種類圖預覽與其他重用該函式的卡片同步消失。已將原有色彩與比例的向量高音譜記號上傳為網站長期資產，並改用有效 `/manus-storage/kimichord-gclef-colored_153d9733.svg`；`.staff-clef` 保留完整向量邊界。回歸直接建立一般與 chord-map 兩種五線譜，兩個譜號均載入為 15×41 原始向量、顯示盒寬非零。

第六十二版桌面音量校正：一般模式主總線 input/output 提升為 0.70/0.95，和弦子總線提升為 0.92/1.00，Groove 子總線提升為 1.25/1.06；琶音與和弦均經同一和弦子總線，因此同步取得可聽動態。所有信號仍需通過既有 30Hz 高通、12.5kHz 低通、壓縮器與 4× soft limiter。手機純淨模式的保守值不變：主總線約 0.32/0.62、和弦約 0.30/0.66、Groove 約 0.36/0.68。

第六十二版可信回歸：`cdp-v62-clef-desktop-gain-audit.mjs` PASS。桌面可信手勢下，長笛和弦主輸出 peak 0.44 以上、四分琶音 peak 0.49 以上，代表性 Groove 清除和弦尾音後主輸出 peak 達 0.0777；高音譜號資產、一般模式增益與平滑切換後的手機純淨模式目標皆通過。inline JavaScript `node --check`、`pnpm run check`、`pnpm run build`、`git diff --check` 均通過；桌面全頁畫面確認版面未出現水平溢出。Vite 僅保留既有大型 chunk 警告。

第六十三版根因判定：一般模式在 Groove 增益提升後仍沿用主壓縮器 threshold -21dB、ratio 7:1 的手機保守設定。鼓組的短暫 kick、snare、hat 疊加峰值會先被過度壓縮，使用者看見的是子總線前的高瞬態／峰值保持警示，實際從主輸出聽到的卻是被壓低後的平均能量，形成「提示削波但仍很小聲」的矛盾。

第六十三版修復：桌面一般模式主壓縮調為 threshold -13dB、knee 18dB、ratio 4.5:1，並以 1.05 主輸出補足已受控的平均響度；手機純淨模式維持原先 threshold -25dB、ratio 9:1、output 0.62。Kick、EDM Kick、Sub Kick、Snare、Hat、Clap 與 Bass 的音尾延長並降低個別尖峰力度，讓低中頻節奏內容延續而不是只留下 click。Groove meter 改為取樣主輸出後的實際信號，削波提示門檻改為 peak 0.93／RMS 0.72，並改為「動態保護」文案。

第六十三版桌面動態回歸：`cdp-v63-groove-loudness-diagnostic.mjs` 完成 Rock、Swing、Samba、EDM、Funk 於 30、72、300 BPM 的量測；預設 72 BPM 主輸出 peak 約 0.24–0.45、RMS 約 0.11–0.19，300 BPM 的最大 peak 為 0.51、最大 RMS 為 0.18，均未觸發動態保護。代表 Groove 均保有多個連續 RMS 視窗，最大壓縮量少於 0.22dB，確認平均響度提升並未以硬限幅換取音量。inline JavaScript `node --check`、`pnpm run check`、`pnpm run build`、`git diff --check` 與桌面介面畫面檢查均通過；Vite 僅保留既有大型 chunk 警告。

第六十四版現代 Groove 擴充：在既有五大分類與 23 種節奏基礎上，新增超過 16 種可選伴奏，涵蓋 Future Bass、Nu-Disco、UK Garage、Drum & Bass、Synthwave、Breakbeat、Lo-fi Hip-Hop、Trap、Afro Swing、Amapiano、Baile Funk、Neo-Soul、Contemporary R&B、K-Pop、Reggaeton、Dancehall 與 Jazz-Fusion。每一種類型在選單中均有繁體中文說明、典型速度、節奏特徵與核心樂器資訊；設計依據保存在 `modern-groove-research.md`，其中電子節奏的配器研究參考 Native Instruments 與 EDMProd 的鼓組編排文章。

第六十四版特色聲部：新增圖樣使用既有 kick、snare、hat、clap、bass、shaker、conga、brush、synth 等安全聲部；Amapiano 補入低頻 log drum，Afro Swing 補入短促吉他切分音，Baile Funk 補入鈴鼓，以避免所有現代類型退回為同一組通用雜音。所有新增聲部仍使用從零起音、平滑淡出及主總線高通、壓縮、limiter 保護。

第六十四版可信桌面回歸：`cdp-v64-modern-groove-audit.mjs` PASS。回歸自實際選單讀取新分類與節奏選項，依可信手勢驗證新增類型可被選取且能產生非零連續音訊輸出；同時確認木魚／Groove XOR 切回木魚後維持木魚節拍器，Groove 計時器與聲源能安全停止。inline JavaScript `node --check`、`pnpm run check`、`pnpm run build`、`git diff --check` 均通過；1280×720 全頁截圖確認現有節拍器控制與和弦版面未產生水平溢出。Vite 僅保留既有大型 chunk 警告。

第六十五版 Groove 控制區響應式邊界修復：`#grooveControls` 與其內部欄位現在均具備 `width/max-width: 100%`、`min-width: 0`、統一盒模型及封閉溢出邊界；兩個設定列改用 `max-content minmax(0, 1fr)` 格線，讓「類別」與「伴奏」標籤保持可讀，而原生選單優先在可用欄寬內收縮並以省略號處理過長的 Groove 名稱與典型速度。手機與平板的抽屜式設定欄寬度改為 `min(272px, calc(100vw - 18px))`，為下拉選單提供可用閱讀寬度，同時保留畫面右側安全間距，避免元件伸到右側 UI 之外。

第六十五版跨裝置回歸：新增 `cdp-v65-groove-layout-fix-audit.mjs` 並通過。桌面 1280×720、平板 768×1024、手機 390×844 三種檢查下，Groove 控制區、類別選單與伴奏選單皆完全位於側欄邊界內；文件水平寬度等於視窗寬度，且每個元件的 `scrollWidth` 不超過 `clientWidth`。另重跑 `cdp-v64-modern-groove-audit.mjs`，現代 Groove 選單、代表性伴奏的可信手勢音訊輸出，以及木魚／Groove XOR 均為 PASS。inline JavaScript `node --check`、`pnpm run check`、`pnpm run build`、`git diff --check` 通過；1280×720 與 390×844 截圖確認現有桌面與手機總體介面邊界正常。Vite 僅保留既有大型 chunk 警告。

第六十六版 Groove 響度與去啵聲修復：可信手勢診斷確認舊版在預設 72 BPM、65% 節拍器音量下，多數 Groove 的連續主輸出 RMS 僅約 0.025–0.041；部分短聲部使用過短包絡與方波撞擊，會讓一般筆電／手機揚聲器的平均聽感偏小，並放大每拍起止的尖銳瞬態。修正後，非純淨模式的 Groove 子總線與主輸出補償均提高，同時保留主壓縮、4× soft limiter、低頻阻隔與安全輸出餘裕；代表性的 Disco、Rock、Swing、Samba、EDM、Trap、Amapiano 連續 RMS 提升至約 0.036–0.057。

第六十六版聲部平滑：Groove 母線淡入調整為 14–18ms，收尾延長為至少 60ms；噪聲與振盪聲部提高到 10–16ms 起音與 50ms 淡出，鼓組撞擊、鈴鼓與短音合成聲不再以過短包絡硬切。尖銳的方波撞擊聲部改採較圓滑的 triangle 聲波，保留節奏辨識度但降低反覆出現的「啵」感。手機純淨模式仍使用 75Hz 高通、7.8kHz 低通與較高壓縮比，但不再過度衰減，代表性 EDM、Trap、Amapiano 在可信手勢下皆具非零且連續的輸出能量。

第六十六版可信回歸：新增並通過 `cdp-v66-groove-audio-diagnostic.mjs`。代表性 Groove 在預設 65% 音量下的最大主輸出峰值維持約 0.33–0.45，未觸發削波警示；30、72、300 BPM 重新排程均保有非零輸出，停止後 Groove 子總線 RMS 為 0、聲源數為 0。木魚模式時 Groove RMS 近乎 0，切回 Groove 時可取得非零連續輸出，確認 XOR 正常。MediaRecorder 錄音結果取得 1 個音訊片段、18,090 bytes Blob，停止後錄音路由已解除。inline JavaScript、TypeScript、production build、`git diff --check`、1280×720 與 390×844 畫面檢查通過；Vite 僅保留既有大型 chunk 警告。

第六十七版 Groove 控制：新增「合成波形」選單，可在三角形波（均衡）與正弦波（圓潤）間切換；僅套用到 `electricBass`、`synthBass` 與 `synthPluck` 等具音高的合成聲部，保留鼓組、刷鈸、沙鈴、Conga 與噪聲聲部的風格辨識。波形偏好會以 localStorage 保存，重載後能正確還原至狀態與控制元件。

第六十七版混音預設：Groove 子總線新增低頻 shelf 與可平滑變更的音色低通濾波。標準預設維持既有完整動態；低頻加強將高通降至 34Hz、在 112Hz 提供 +4.2dB shelf，並採適度總線輸出補償；夜間柔和採 58Hz 高通與 7.2kHz 低通、較低總線增益，保留節奏輪廓並降低夜間聆聽的尖銳高頻。手機純淨模式會覆蓋為 75Hz 高通、最多 +2dB shelf、7.8kHz 低通與保守輸出，不會因低頻加強預設而放寬既有保護。

第六十七版即時電平：Groove 控制區新增「即時 Groove 輸出」視覺化，使用既有主輸出後分析器顯示播放／待機／動態保護狀態、輸出百分比及所選預設與波形；原有播放監視器的 RMS、峰值保持與削波提示仍保留。新增 `cdp-v67-groove-controls-audit.mjs` 並通過：三角形波與正弦波皆有非零輸出；標準、低頻加強、夜間柔和的音訊參數分別正確套用，低頻加強實測最大峰值約 0.55，夜間柔和約 0.29。手機純淨模式輸出維持非零（峰值約 0.12、RMS 約 0.06），木魚／Groove XOR 正常，且 1280×720、768×1024、390×844 在側欄開啟的實際操作狀態下，控制區、兩個選單與電平表均完全位於可視畫面內。inline JavaScript、TypeScript、production build、`git diff --check`、桌面及手機全頁截圖通過；Vite 僅保留既有大型 chunk 警告。

第六十八版進階波形：Groove 合成波形擴充為三角形、正弦、鋸齒與方波。鋸齒、方波僅套用於 `electricBass`、`synthBass`、`synthPluck` 等具音高聲部；兩者以安全增益補償降低尖峰，鼓組、噪聲、刷鈸、沙鈴與拉丁打擊聲部完全維持既有音色與平滑包絡。四種波形皆可保存，並在可信手勢播放下取得非零連續輸出。

第六十八版個人混音：新增「自訂輸出」、「自訂低頻」與「高頻柔和」三項可調控制；調整後形成安全的自訂草稿，使用者可命名儲存、從清單載入或刪除個人預設。資料以驗證後的數值保存在 localStorage，包含總線輸出、低頻 shelf、高通與低通等必要參數；缺漏、格式錯誤或超出範圍的資料會安全略過。回歸已儲存「回歸低頻」範例並重載頁面，確認選取狀態及混音參數均正確還原。

第六十八版歷史波形圖：即時 Groove 輸出區新增可開關的「歷史波形圖」，僅在開啟時自主輸出後 analyser 取樣，並以 280 個樣本的環形緩衝搭配 requestAnimationFrame 繪製 Canvas；關閉時不保留新資料且畫布隱藏，以降低手機負載。`cdp-v68-groove-advanced-controls-audit.mjs` 已通過四種波形、個人預設保存／重載、歷史圖資料點、手機純淨模式、木魚／Groove XOR、既有錄音路由與停止清理。桌面 1280×720、平板 768×1024、手機 390×844 的實際側欄開啟狀態均無水平溢出；桌面及手機截圖確認遊戲主畫面未受影響。inline JavaScript、TypeScript、production build、`git diff --check` 通過；Vite 僅保留既有大型 chunk 警告。
