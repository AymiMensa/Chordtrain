import "./home.css";

export default function Home() {
  return (
    <main className="game-shell">
      <iframe
        className="game-frame"
        title="KIMIchord 和弦樹"
        src="./KIMIchord_trees_fixed.html"
      />
    </main>
  );
}
