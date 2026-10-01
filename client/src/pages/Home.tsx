import "./home.css";

export default function Home() {
  return (
    <main className="game-shell">
      <iframe
        className="game-frame"
        title="KIMIchord 和弦樹遊戲"
        src={`${import.meta.env.BASE_URL}KIMIchord_trees_fixed.html`}
      />
    </main>
  );
}
