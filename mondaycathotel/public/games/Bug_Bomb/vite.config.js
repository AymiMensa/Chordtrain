import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'esnext'
  },
  server: {
    watch: {
      // 忽略意外遞迴複製出來的專案副本
      // tools/mondaycathotel/public/games/Bug_Bomb/tools/mondaycathotel/...
      // 這個目錄把整個專案（含 node_modules、dist）自我嵌套複製，
      // 會讓 Vite 的檔案監視器遞迴到超出 Windows MAX_PATH(260) 而崩潰
      // （errno -4094）。它與上層專案逐位元相同，屬於可安全移除的垃圾，
      // 但在刪除前先讓 watcher 跳過它，避免 dev server 閃退。
      ignored: [
        '**/tools/mondaycathotel/**',
        '**/dist/**'
      ]
    }
  }
});
