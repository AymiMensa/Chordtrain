import { describe, it, expect } from 'vitest';
import { BombLearner, BOMB_REWARD, BOMB_FEATURE_NAMES } from '../../src/game/ai/BombLearner.js';

const feat = (o = {}) => BOMB_FEATURE_NAMES.map(() => 0).map((_, i) => {
  const n = BOMB_FEATURE_NAMES[i];
  return o[n] !== undefined ? o[n] : 0;
});

describe('BombLearner：真的在學（不是死程式碼）', () => {
  it('高擊殺特徵的預測值，訓練後應高於低擊殺特徵', () => {
    const net = new BombLearner({ learningRate: 0.05, hiddenSize: 8 });
    const good = feat({ mcKill: 1, coverRatio: 1 });
    const bad = feat({ mcKill: 0, coverRatio: 0 });
    // 2000 次監督學習：good -> +10，bad -> -10
    for (let i = 0; i < 2000; i++) {
      net.trainOne(good, BOMB_REWARD.KILL);
      net.trainOne(bad, -BOMB_REWARD.KILL);
    }
    const pg = net.predict(good).out;
    const pb = net.predict(bad).out;
    expect(pg).toBeGreaterThan(pb);
    expect(pg).toBeGreaterThan(0);
    expect(pb).toBeLessThan(0);
  });

  it('經驗重播會從已結算樣本學習', () => {
    const net = new BombLearner({ learningRate: 0.05 });
    const f = feat({ mcKill: 1 });
    const i = net.observe(f);
    expect(net.samplesSeen).toBe(1);
    const before = net.predict(f).out;
    net.settle(i, 10);
    const after = net.predict(f).out;
    expect(net.replay[0].target).toBe(10);
    expect(after).toBeGreaterThan(before);
    const rl = net.replayBatch(10);
    expect(rl).toBeGreaterThanOrEqual(0);
  });

  it('未看過樣本時 blend 為 0（保證學習初期不破壞原有評分）', () => {
    const net = new BombLearner();
    expect(net.blend()).toBe(0);
    for (let i = 0; i < 100; i++) net.observe(feat({ mcKill: 1 }));
    expect(net.blend()).toBeGreaterThan(0);
    expect(net.blend()).toBeLessThan(1);
    for (let i = 0; i < 1000; i++) net.observe(feat({ mcKill: 1 }));
    expect(net.blend()).toBe(1);
  });

  it('JSON 序列化／還原可來回一致', () => {
    const a = new BombLearner();
    a.trainOne(feat({ mcKill: 1 }), 5);
    const json = JSON.parse(JSON.stringify(a.toJSON()));
    const b = new BombLearner();
    expect(b.loadJSON(json)).toBe(true);
    const f = feat({ mcKill: 1, brickRatio: 0.5 });
    expect(b.predict(f).out).toBeCloseTo(a.predict(f).out, 6);
  });

  it('維度不符的 JSON 不會被載入', () => {
    const net = new BombLearner({ inputSize: 12, hiddenSize: 10 });
    const other = new BombLearner({ inputSize: 5, hiddenSize: 4 });
    expect(net.loadJSON(other.toJSON())).toBe(false);
  });
});
