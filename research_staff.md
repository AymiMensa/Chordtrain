# 第三版五線譜定位依據

Wikipedia 的 Staff（music）條目指出，五線譜由下往上編號，高音譜號是 G 譜號，並固定「中央 C 上方的 G」位於第二線；音符中心應落在線上或空間內，超出五線譜時才使用與音符寬度相當的加線。[1]

本專案的 SVG 會因此採用「第二線 G4」作為垂直基準：第二線 y=40、每一個自然音級相差 5px，五線譜五條線為 F5、D5、B4、G4、E4。高音譜記號只應服務於左側譜號區，音名標籤則從譜號右側的安全 x 座標開始，避免重疊。[1] [2]

三度和弦的音符中心落在相鄰線／間時，應使用同一個時間位置的 x 座標上下堆疊；只有同音高或需要處理符桿方向時才需要水平錯開。本遊戲呈現的是全音符和弦，因此本版會讓同一組音符共享固定 x 座標，並以同一個半徑繪製，形成置中對齊的垂直堆疊。

## References

[1]: https://en.wikipedia.org/wiki/Staff_(music) "Staff (music) - Wikipedia"
[2]: https://musictheory.pugetsound.edu/mt21c/Notation.html "Notation - Music Theory for the 21st-Century Classroom"
