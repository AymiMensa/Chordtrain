import "./home.css";

export default function Home() {
  // 部署至 GitHub Pages 專案子路徑時，需以 BASE_URL 組出正確的相對路徑
  const gameUrl = `${import.meta.env.BASE_URL}KIMIchord_trees_fixed.html`;

  return (
    <main className="game-shell">
      <iframe
        className="game-frame"
        title="KIMIchord 和弦樹遊戲"
        src={gameUrl}
      />
    </main>
  );
}
