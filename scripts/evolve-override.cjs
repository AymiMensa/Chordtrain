const fs = require('fs');
const { runWithOverrides } = require('../tests/override-harness.cjs');

const BASE = JSON.parse(fs.readFileSync('C:/Users/user/Desktop/Monday_Cat_Hotel/replay_base.json', 'utf8'));
const ACTIONS = BASE.actions;
const TOWER_TYPES = ['wall','arrow','cannon','ice','fire','poison','shock','stun','laser'];

function clone(o) { return JSON.parse(JSON.stringify(o)); }

function mutateAction(act) {
  const r = Math.random();
  if (r < 0.33) {
    // noop: skip this action
    return { tick: act.tick, action: 'noop', args: [] };
  }
  if (r < 0.66 && act.action === 'place') {
    // change type
    const newType = TOWER_TYPES[Math.floor(Math.random() * TOWER_TYPES.length)];
    return { tick: act.tick, action: 'place', args: [newType, act.args[1], act.args[2]] };
  }
  if (act.action === 'place') {
    // shift cell slightly
    const dx = Math.floor(Math.random() * 3) - 1;
    const dy = Math.floor(Math.random() * 3) - 1;
    return { tick: act.tick, action: 'place', args: [act.args[0], Math.max(0, Math.min(31, act.args[1] + dx)), Math.max(0, Math.min(17, act.args[2] + dy))] };
  }
  // upgrade -> noop sometimes
  return { tick: act.tick, action: 'noop', args: [] };
}

const FRAMES = parseInt(process.argv[2] || '30000', 10);
const ITERS = parseInt(process.argv[3] || '15', 10);
const SEED = parseInt(process.argv[4] || '12345', 10);

let bestOverrides = [];
let bestLevel = runWithOverrides([], FRAMES, SEED).maxLevel;
console.log('baseline (empty) level:', bestLevel);

for (let it = 0; it < ITERS; it++) {
  // pick a random recorded action
  const act = ACTIONS[Math.floor(Math.random() * ACTIONS.length)];
  const mut = mutateAction(act);
  // build candidate: best + this mutation (avoid duplicate ticks)
  const cand = bestOverrides.filter(o => o.tick !== mut.tick).concat([mut]);
  const r = runWithOverrides(cand, FRAMES, SEED);
  const improved = r.maxLevel > bestLevel;
  console.log(`iter ${it+1}/${ITERS}: cand level ${r.maxLevel} (best ${bestLevel}) ${improved ? 'IMPROVED' : ''}  mut=${JSON.stringify(mut)}`);
  if (improved) {
    bestOverrides = cand;
    bestLevel = r.maxLevel;
    fs.writeFileSync('C:/Users/user/Desktop/Monday_Cat_Hotel/overrides_best.json', JSON.stringify(bestOverrides), 'utf8');
  }
}

console.log('FINAL best level:', bestLevel, 'overrides:', bestOverrides.length);
fs.writeFileSync('C:/Users/user/Desktop/Monday_Cat_Hotel/overrides_best.json', JSON.stringify(bestOverrides), 'utf8');
process.exit(0);
