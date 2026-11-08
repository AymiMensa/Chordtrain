/**
 * BombLearner.js — 深度學習 × 成功獎勵 × 失敗處罰
 *
 * 以一個真正會從對局結果學習的神經網路，取代手寫的放彈評分權重。
 *
 * 設計要點（都可被 tools/ 下的腳本量測）：
 *
 * 1. **殘差式融合，不是取代。**
 *    未訓練時輸出≈0 → 完全沿用原有手寫評分，保證「學習不會讓 AI 變笨」。
 *    blend 隨樣本由 0 漸增至 1，學習成果逐步接管。
 *
 * 2. **成功獎勵 / 失敗處罰**（每顆炸彈引爆後立刻結算）：
 *      + KILL  × 擊殺數      − SELF × 自傷次數
 *      + BRICK × 破磚數      − WASTE / MISS
 *
 * 3. **經驗重播**：保留最近 N 個樣本，更新時隨機抽樣，
 *    打破同一時段樣本高度相關造成的震盪。
 *
 * 4. 純函式、不依賴 DOM，可在 Node 直接 import 做單元測試。
 */

export const BOMB_FEATURE_NAMES = [
  'mcKill', 'coverRatio', 'blockRatio', 'brickRatio', 'steps',
  'escapeSlack', 'liveEarliest', 'aliveRatio', 'hpRatio', 'shield',
  'nearestMonster', 'isCurrent',
];

export const BOMB_REWARD = {
  KILL: 10.0,
  BRICK: 1.5,
  SELF: -6.0,
  WASTE: -1.0,
  MISS: -0.5,
};

export const BOMB_NET_DEFAULTS = {
  inputSize: 12,
  hiddenSize: 10,
  learningRate: 0.03,
  replaySize: 3000,
  batchSize: 24,
  blendWarmup: 600,
};

function randMatrix(rows, cols, scale) {
  // **絕不使用 Math.random**：初始化權重會呼叫 rows*cols 次（本類別 130 次），
  // 而這個遊戲的怪物轉向／地圖生成都靠全域 Math.random 驅動。
  // 每次 new BombLearner() 都會消耗 130 個亂數，足以讓整局的怪物行為改變 ——
  // 那會讓「接上學習」前後的 A/B 量到完全虛假的提升（本輪實測 72.9% → 87.5%）。
  // 因此改用固定種子的獨立 PRNG。
  const m = [];
  let s = 0x1234567;
  const rnd = () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = 0; i < rows; i++) {
    m[i] = new Array(cols);
    for (let j = 0; j < cols; j++) m[i][j] = (rnd() * 2 - 1) * scale;
  }
  return m;
}

export class BombLearner {
  constructor(opts = {}) {
    const c = { ...BOMB_NET_DEFAULTS, ...opts };
    this.nIn = c.inputSize;
    this.nHid = c.hiddenSize;
    this.lr = c.learningRate;
    this.replaySize = c.replaySize;
    this.batchSize = c.batchSize;
    this.blendWarmup = c.blendWarmup;

    this.W1 = randMatrix(this.nIn, this.nHid, Math.sqrt(1 / this.nIn));
    this.b1 = new Array(this.nHid).fill(0);
    this.W2 = randMatrix(this.nHid, 1, Math.sqrt(1 / this.nHid));
    this.b2 = [0];

    this.replay = [];
    this.samplesSeen = 0;
    this.updates = 0;
    this.lastLoss = null;
    this.rewardSum = 0;
    this.rewardCount = 0;
    // 獨立的 PRNG：**不使用 Math.random**，避免汙染遊戲的亂數序列（見頂部註解）。
    this._seed = (this._seed | 0) || 0x9e3779b9;
  }

  /** 取下一個偽隨機數 [0,1)（mulberry32） */
  rand() {
    this._seed = (this._seed + 0x6D2B79F5) | 0;
    let t = this._seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** tanh 隱藏層（有界，梯度不爆炸），線性輸出 */
  predict(feat) {
    const h = new Array(this.nHid);
    for (let j = 0; j < this.nHid; j++) {
      let s = this.b1[j];
      for (let i = 0; i < this.nIn; i++) s += feat[i] * this.W1[i][j];
      h[j] = Math.tanh(s);
    }
    let out = this.b2[0];
    for (let j = 0; j < this.nHid; j++) out += h[j] * this.W2[j][0];
    return { out, h };
  }

  /** 單樣本反向傳播，回傳 squared error */
  trainOne(feat, target, weight = 1) {
    const { out, h } = this.predict(feat);
    const gOut = (out - target) * weight;
    const dH = new Array(this.nHid);
    for (let j = 0; j < this.nHid; j++) {
      dH[j] = gOut * this.W2[j][0] * (1 - h[j] * h[j]);   // tanh'
    }
    const norm = Math.sqrt(this.nIn) || 1;
    const lr = this.lr;
    for (let i = 0; i < this.nIn; i++) {
      let s = 0;
      for (let j = 0; j < this.nHid; j++) s += dH[j] * this.W1[i][j];
      const g = s / norm;
      if (g === 0) continue;
      const row = this.W1[i];
      for (let j = 0; j < this.nHid; j++) row[j] -= lr * g * h[j];
    }
    for (let j = 0; j < this.nHid; j++) {
      this.b1[j] -= lr * dH[j];
      this.W2[j][0] -= lr * gOut * h[j];
    }
    this.b2[0] -= lr * gOut;
    this.updates++;
    const e = out - target;
    return e * e;
  }

  /** 學習才剛開始時 blend 應為 0，避免未收斂的網路破壞既有評分 */
  blend() {
    return Math.min(1, this.samplesSeen / Math.max(1, this.blendWarmup));
  }

  /** 記錄一次「放彈決策」的特徵，之後用真實結果訓練 */
  observe(feat) {
    this.samplesSeen++;
    this.replay.push({ feat, target: null });
    if (this.replay.length > this.replaySize) this.replay.shift();
    return this.replay.length - 1;
  }

  /** 用實際發生的結果（獎勵）回填並訓練 */
  settle(index, reward) {
    if (index < 0 || index >= this.replay.length) return null;
    const rec = this.replay[index];
    if (!rec || rec.target !== null) return null;
    rec.target = reward;
    this.rewardSum += reward;
    this.rewardCount++;
    const loss = this.trainOne(rec.feat, reward);
    this.lastLoss = loss;
    return loss;
  }

  /** 經驗重播：從已結算樣本隨機抽一批再訓練（降低相關性造成的震盪） */
  replayBatch(n) {
    const ready = this.replay.filter(r => r.target !== null);
    if (!ready.length) return 0;
    let loss = 0, cnt = 0;
    for (let i = 0; i < n; i++) {
      const r = ready[(this.rand() * ready.length) | 0];   // 獨立 PRNG，不動遊戲亂數
      loss += this.trainOne(r.feat, r.target, 0.3);
      cnt++;
    }
    return cnt ? loss / cnt : 0;
  }

  toJSON() {
    return { v: 2, W1: this.W1, b1: this.b1, W2: this.W2, b2: this.b2, samplesSeen: this.samplesSeen };
  }

  loadJSON(d) {
    if (!d || !d.W1 || !d.W2) return false;
    if (d.W1.length !== this.nIn || d.W2.length !== this.nHid) return false;
    this.W1 = d.W1; this.b1 = d.b1; this.W2 = d.W2; this.b2 = d.b2;
    this.samplesSeen = d.samplesSeen || 0;
    return true;
  }
}
