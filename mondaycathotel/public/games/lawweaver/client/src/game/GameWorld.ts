import type {
  Direction,
  GridPoint,
  LevelDefinition,
  RuleStatus,
  RuleView,
  WorldEntity,
  WorldSnapshot,
  WorldView,
} from "./types";
import { campaignLevels } from "./levels";
import { assertNoDuplicateRequiredRules } from "./ruleGuards";
import { getLexiconEntry } from "./lexicon";
import { solveLevelAfterRule } from "./solver";

type Listener = () => void;
const GRID_SIZE = 7;

const challengesFor = (level: LevelDefinition) => [level.challenge, ...(level.additionalChallenges ?? [])].filter(Boolean) as NonNullable<LevelDefinition["challenge"]>[];
const initialMessageFor = (level: LevelDefinition) => {
  const challenge = challengesFor(level)[0];
  if (!challenge) return "先看地圖元件與規則工作列，找出正在阻擋門印的實體。";
  if (level.order === 4) return "焰流正在堵住中央唯一缺口；潮體位於門印前。先排成「焰流 化 潮體」，焰流才會轉成可通行的潮體。";
  return `先看規則：${challenge.blocker}目前正在影響通路。完成「${challenge.subject} ${challenge.verb} ${challenge.predicate}」後，${challenge.resolvedState}。`;
};
const initialBlocks = (level: LevelDefinition, challenge = challengesFor(level)[0]) => {
  const blocks = [...(challenge?.scattered ?? ["壁垣", "賦有", "隔離作用"])];
  const last = blocks.pop();
  return last ? [last, ...blocks] : blocks;
};
const initialSnapshot = (level: LevelDefinition): WorldSnapshot => ({
  player: { ...level.player },
  shadow: { x: level.player.x, y: Math.min(GRID_SIZE - 1, level.player.y + 1) },
  barrierStatus: "complete",
  turn: 0,
  message: initialMessageFor(level),
  finished: false,
  elapsedMs: 0,
  ruleBlocks: initialBlocks(level),
  isolatedBlocks: [],
  lockedBlocks: [],
  ruleResolved: false,
  activeRuleIndex: 0,
  resolvedRules: [],
});

const clonePoint = (point: GridPoint): GridPoint => ({ ...point });
const cloneSnapshot = (snapshot: WorldSnapshot): WorldSnapshot => ({ ...snapshot, player: clonePoint(snapshot.player), shadow: clonePoint(snapshot.shadow), ruleBlocks: [...snapshot.ruleBlocks], isolatedBlocks: [...snapshot.isolatedBlocks], lockedBlocks: [...snapshot.lockedBlocks], resolvedRules: [...snapshot.resolvedRules] });
const samePoint = (a: GridPoint, b: GridPoint) => a.x === b.x && a.y === b.y;

export class GameWorld {
  private level: LevelDefinition;
  private snapshot: WorldSnapshot;
  private timeline: WorldSnapshot[];
  private timelineIndex = 0;
  private listeners = new Set<Listener>();
  private demoTimers: number[] = [];
  private levelStartedAt = performance.now();

  constructor(initialLevel: LevelDefinition = campaignLevels[0]) {
    this.level = initialLevel;
    this.snapshot = initialSnapshot(initialLevel);
    this.timeline = [cloneSnapshot(this.snapshot)];
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getLevel(): LevelDefinition { return this.level; }
  private getActiveChallenge() { return challengesFor(this.level)[this.snapshot.activeRuleIndex]; }

  canResolveActiveRule(): boolean {
    const challenge = this.getActiveChallenge();
    if (!challenge || this.snapshot.resolvedRules.includes(challenge.title)) return false;
    const phrase = `${challenge.subject}|${challenge.verb}|${challenge.predicate}`;
    const assembled = this.snapshot.ruleBlocks.join("|") === phrase;
    return challenge.requiredOperation === "separate" ? this.snapshot.isolatedBlocks.length > 0 : challenge.requiredOperation === "lock" ? this.snapshot.lockedBlocks.length > 0 : assembled;
  }

  loadLevel(level: LevelDefinition): void {
    assertNoDuplicateRequiredRules(level);
    this.clearDemo();
    this.level = level;
    this.levelStartedAt = performance.now();
    this.snapshot = initialSnapshot(level);
    this.timeline = [cloneSnapshot(this.snapshot)];
    this.timelineIndex = 0;
    this.emit();
  }

  getView(): WorldView {
    const allChallenges = challengesFor(this.level);
    const wallRule = allChallenges.find((challenge) => challenge.blocker === "壁垣");
    const barrierBlocking = wallRule ? !this.snapshot.resolvedRules.includes(wallRule.title) : false;
    const resolvedChallenges = allChallenges.filter((challenge) => this.snapshot.resolvedRules.includes(challenge.title));
    const resolvedNouns = new Set(resolvedChallenges.flatMap((challenge) => challenge.entities));
    const hasLegacyElement = (noun: "焰流" | "潮體") => allChallenges.some((challenge) => challenge.entities.includes(noun));
    const steamBridgeResolved = this.level.order === 13 && this.snapshot.ruleResolved && this.level.challenge?.mechanic === "merge";
    const tideKind: WorldEntity["kind"] = steamBridgeResolved || this.snapshot.ruleResolved && (samePoint(this.level.tide, this.level.ember) || Math.abs(this.level.tide.x - this.level.ember.x) + Math.abs(this.level.tide.y - this.level.ember.y) <= 1) ? "mist" : "tide";
    const emberKind: WorldEntity["kind"] = steamBridgeResolved ? "mist" : this.snapshot.ruleResolved && this.level.challenge?.mechanic === "transform" ? "tide" : "ember";
    const entities: WorldEntity[] = [
      { id: "player", kind: "player", noun: "行者", position: clonePoint(this.snapshot.player) },
      { id: "shadow", kind: "shadow", noun: "影子", position: clonePoint(this.snapshot.shadow) },
      { id: "door", kind: "door", noun: "門印", position: clonePoint(this.level.door) },
      ...(hasLegacyElement("焰流") ? [{ id: "ember", kind: emberKind, noun: "焰流", position: clonePoint(this.level.ember) }] : []),
      ...(hasLegacyElement("潮體") ? [{ id: "tide", kind: tideKind, noun: "潮體", position: clonePoint(this.level.tide) }] : []),
      ...this.level.walls.map((position, index) => ({ id: `wall-${index}`, kind: "wall" as const, noun: "壁垣", position: clonePoint(position) })),
      ...(this.level.hazards ?? []).map((hazard) => {
        const resolved = resolvedNouns.has(hazard.noun);
        const coreHazardKinds: Record<string, WorldEntity["kind"]> = { "火焰": "flame", "雷射": "laser", "水流": "water", "地雷": "mine", "冰塊": "ice", "怪物": "monster", "燈塔": "beacon", "地圖": "darkness" };
        const coreKind = coreHazardKinds[hazard.noun];
        const kind = (coreKind ?? "artifact") as WorldEntity["kind"];
        return { id: hazard.id, kind, noun: hazard.noun, resolved, position: clonePoint(hazard.position) };
      }),
    ];
    return {
      ...cloneSnapshot(this.snapshot), entities, rules: this.getRules(), timelineIndex: this.timelineIndex, timelineLength: this.timeline.length,
      barrierBlocking, levelName: this.level.name, objective: this.level.objective, levelId: this.level.id, levelOrder: this.level.order, levelChapter: this.level.editorEnvironment?.chapter ?? this.level.chapter, totalLevels: campaignLevels.length, customAssets: this.level.customAssets,
    };
  }

  move(direction: Direction): void {
    if (this.snapshot.finished) { this.preview("這一關已完成，請前往下一關或重新遊玩。", false); return; }
    const movementRule = challengesFor(this.level).find((challenge) => challenge.blocker === "行者");
    if (movementRule && !this.snapshot.resolvedRules.includes(movementRule.title)) { this.preview(`行者尚未取得移動權：請先完成「${movementRule.subject} ${movementRule.verb} ${movementRule.predicate}」。`, false); return; }
    const delta: Record<Direction, GridPoint> = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
    const target = { x: this.snapshot.player.x + delta[direction].x, y: this.snapshot.player.y + delta[direction].y };
    if (target.x < 0 || target.y < 0 || target.x >= GRID_SIZE || target.y >= GRID_SIZE) { this.preview("這裡已經是棋盤邊緣，不能再往外走。", false); return; }
    const unresolvedHazard = (this.level.hazards ?? []).find((hazard) => samePoint(hazard.position, target) && !this.snapshot.resolvedRules.some((title) => challengesFor(this.level).some((challenge) => challenge.title === title && challenge.entities.includes(hazard.noun))));
    if (unresolvedHazard) { this.preview(`${unresolvedHazard.noun}正佔據這格並阻擋行者。完成對應文字規則後，它才會改變狀態。`, false); return; }
    const wallRule = challengesFor(this.level).find((challenge) => challenge.blocker === "壁垣");
    if (this.level.walls.some((wall) => samePoint(wall, target)) && wallRule && !this.snapshot.resolvedRules.includes(wallRule.title)) { this.preview("壁垣仍有隔離作用。先讓「壁垣」的對應規則成立，才能穿越。", false); return; }
    const hasLegacyGate = challengesFor(this.level).some((challenge) => challenge.entities.includes("焰流") || challenge.entities.includes("潮體"));
    if (hasLegacyGate && !this.snapshot.ruleResolved && (samePoint(target, this.level.ember) || samePoint(target, this.level.tide))) { this.preview("焰流與潮體的條件尚未被處理，這個元件目前會阻擋行者。先完成規則重組。", false); return; }
    const next: WorldSnapshot = { ...cloneSnapshot(this.snapshot), player: target, shadow: clonePoint(this.snapshot.player), turn: this.snapshot.turn + 1, message: "行者前進了一格，灰色影跡留在上一格。" };
    if (samePoint(target, this.level.door)) {
      if (!this.snapshot.ruleResolved) { this.preview(`門印仍然封閉：還有 ${challengesFor(this.level).length - this.snapshot.resolvedRules.length} 條必要規則尚未成立。`, false); return; }
      next.finished = true;
      next.elapsedMs = Math.max(0, Math.round(performance.now() - this.levelStartedAt));
      next.message = "門印打開了：你先讓壁垣不再擋路，所以現在能走到這裡。";
    }
    this.commit(next);
  }

  detachBarrier(): void {
    if (this.snapshot.barrierStatus === "fragmented") { this.preview("「隔離作用」已經在斷界槽裡，壁垣目前不會擋路。", false); return; }
    const next = cloneSnapshot(this.snapshot);
    next.barrierStatus = "fragmented";
    next.turn += 1;
    next.message = "你把「隔離作用」片移到斷界槽，壁垣現在不再擋路。";
    this.commit(next);
  }

  pushRule(direction: "left" | "right"): void {
    const next = cloneSnapshot(this.snapshot);
    if (next.ruleBlocks.length < 2) { this.preview("工作列上沒有足夠的文字片可以推動。", false); return; }
    if (direction === "left") next.ruleBlocks.push(next.ruleBlocks.shift()!);
    else next.ruleBlocks.unshift(next.ruleBlocks.pop()!);
    next.turn += 1;
    next.message = "你推動了文字片；現在檢查語句是否讀得通。";
    this.commit(next);
  }

  isolateRuleBlock(): void {
    const next = cloneSnapshot(this.snapshot);
    const token = next.ruleBlocks.pop();
    if (!token) { this.preview("工作列已經沒有可隔離的文字片。", false); return; }
    next.isolatedBlocks.push(token);
    next.turn += 1;
    next.message = `「${token}」已暫時放入隔離槽。`;
    this.commit(next);
  }

  restoreRuleBlock(): void {
    const next = cloneSnapshot(this.snapshot);
    const token = next.isolatedBlocks.pop();
    if (!token) { this.preview("隔離槽目前是空的。", false); return; }
    next.ruleBlocks.push(token);
    next.turn += 1;
    next.message = `「${token}」已回到工作列。`;
    this.commit(next);
  }

  lockRuleBlock(): void {
    const next = cloneSnapshot(this.snapshot);
    const token = next.ruleBlocks.includes("不可") ? "不可" : next.ruleBlocks[next.ruleBlocks.length - 1];
    if (!token) { this.preview("沒有可以封鎖的文字片。", false); return; }
    next.lockedBlocks = next.lockedBlocks.includes(token) ? next.lockedBlocks.filter((item) => item !== token) : [...next.lockedBlocks, token];
    next.turn += 1;
    next.message = next.lockedBlocks.includes(token) ? `「${token}」已暫時封鎖。` : `「${token}」已解除封鎖。`;
    this.commit(next);
  }

  resolveRule(): void {
    const challenge = this.getActiveChallenge();
    if (!challenge) return;
    if (!this.canResolveActiveRule()) { this.preview(`這條規則還不能成立。提示：${challenge.prompt}`, true); return; }
    const next = cloneSnapshot(this.snapshot);
    next.barrierStatus = "fragmented";
    next.turn += 1;
    next.resolvedRules.push(challenge.title);
    if (next.activeRuleIndex < challengesFor(this.level).length - 1) {
      next.activeRuleIndex += 1;
      next.ruleBlocks = initialBlocks(this.level, challengesFor(this.level)[next.activeRuleIndex]);
      next.isolatedBlocks = [];
      next.lockedBlocks = [];
      next.message = `「${challenge.title}」已成立。下一個必要條件：${challengesFor(this.level)[next.activeRuleIndex].prompt}`;
    } else {
      next.ruleResolved = true;
      next.message = `所有必要規則已成立：${next.resolvedRules.join("、")}。現在重新觀察地圖。`;
    }
    this.commit(next);
  }

  reconnectBarrier(): void {
    if (this.snapshot.barrierStatus === "complete") { this.preview("規則已經完整，壁垣正在擋路。", false); return; }
    const next = cloneSnapshot(this.snapshot);
    next.barrierStatus = "complete";
    next.turn += 1;
    next.message = "你把「隔離作用」片接回規則，壁垣又會擋路。";
    this.commit(next);
  }

  toggleBarrierLock(): void {
    const next = cloneSnapshot(this.snapshot);
    if (next.barrierStatus === "locked") { next.barrierStatus = "complete"; next.message = "封鎖解除，壁垣又恢復擋路。"; }
    else { next.barrierStatus = "locked"; next.message = "規則暫時封鎖，壁垣目前不會擋路。"; }
    next.turn += 1;
    this.commit(next);
  }

  undo(): void { if (this.timelineIndex === 0) { this.preview("這已經是這一關的起點。", false); return; } this.timelineIndex -= 1; this.snapshot = cloneSnapshot(this.timeline[this.timelineIndex]); this.snapshot.message = "已回到上一步。"; this.emit(); }
  redo(): void { if (this.timelineIndex >= this.timeline.length - 1) { this.preview("沒有可以重做的步驟。", false); return; } this.timelineIndex += 1; this.snapshot = cloneSnapshot(this.timeline[this.timelineIndex]); this.snapshot.message = "已重做一步。"; this.emit(); }
  replayTo(index: number): void { const bounded = Math.max(0, Math.min(index, this.timeline.length - 1)); this.timelineIndex = bounded; this.snapshot = cloneSnapshot(this.timeline[bounded]); this.snapshot.message = `正在查看第 ${bounded} 步。`; this.emit(); }

  reset(): void { this.clearDemo(); this.levelStartedAt = performance.now(); this.snapshot = initialSnapshot(this.level); this.timeline = [cloneSnapshot(this.snapshot)]; this.timelineIndex = 0; this.emit(); }

  startDemo(): void {
    this.reset();
    const steps: Array<() => void> = [() => this.detachBarrier(), () => this.move("up"), () => this.move("up"), () => this.move("up"), () => this.move("right"), () => this.move("right"), () => this.move("right"), () => this.move("right"), () => this.move("up")];
    steps.forEach((step, index) => { const timer = window.setTimeout(step, 80 + index * 180); this.demoTimers.push(timer); });
  }

  /** 電腦AI自動：先拼出界律臺殘句成立規則，再自動移動主角至門印。 */
  aiAutoPlay(): void {
    this.clearDemo();
    this.reset();
    const challenge = this.getActiveChallenge();
    if (!challenge) { this.preview("沒有可執行的界律挑戰。", true); return; }

    const steps: Array<{ fn: () => void; delayMs: number }> = [];
    let delayMs = 0;

    // Phase 1: 界律臺殘句拼組 — 根據 requiredOperation 決定操作策略
    const targetPhrase = `${challenge.subject} ${challenge.verb} ${challenge.predicate}`;
    const currentBlocks = [...this.snapshot.ruleBlocks];

    if (challenge.requiredOperation === "lock") {
      // 鎖定模式：將「不可」片鎖定
      if (currentBlocks.includes("不可")) {
        steps.push({ fn: () => this.lockRuleBlock(), delayMs });
        delayMs += 400;
      } else {
        steps.push({ fn: () => this.resolveRule(), delayMs });
        delayMs += 500;
      }
    } else if (challenge.requiredOperation === "separate") {
      // 分離模式：將最右文字片送入隔離器，再執行規則
      steps.push({ fn: () => this.isolateRuleBlock(), delayMs });
      delayMs += 400;
      steps.push({ fn: () => this.resolveRule(), delayMs });
      delayMs += 500;
    } else {
      // assemble / order / swap / merge：透過 pushRule 旋轉文字片，嘗試湊出目標片語
      let rotated = false;
      const working = [...currentBlocks];
      for (let r = 0; r < working.length; r++) {
        if (working.join(" ") === targetPhrase) { rotated = true; break; }
        // 模擬 pushRule("right")：最後一個元素移到最前
        const last = working.pop();
        if (last) working.unshift(last);
        steps.push({ fn: () => this.pushRule("right"), delayMs });
        delayMs += 300;
      }
      steps.push({ fn: () => this.resolveRule(), delayMs });
      delayMs += 500;
    }

    // Phase 2: 規則成立後，尋找通往門印的最短路徑並自動移動
    steps.push({ fn: () => {
      const path = solveLevelAfterRule(this.level);
      if (path && path.length > 1) {
        for (let i = 1; i < path.length; i++) {
          const prev = path[i - 1];
          const curr = path[i];
          const dx = curr.x - prev.x;
          const dy = curr.y - prev.y;
          let dir: Direction = "right";
          if (dx === 0 && dy === -1) dir = "up";
          else if (dx === 0 && dy === 1) dir = "down";
          else if (dx === -1 && dy === 0) dir = "left";
          else if (dx === 1 && dy === 0) dir = "right";
          steps.push({ fn: () => this.move(dir), delayMs });
          delayMs += 350;
        }
        steps.push({ fn: () => { this.preview("電腦AI自動已抵達門印，過關！", true); }, delayMs });
        delayMs += 300;
      } else {
        steps.push({ fn: () => { this.preview("規則已成立，但目前無法找到通往門印的路徑。", true); }, delayMs });
        delayMs += 300;
      }
    }, delayMs });
    delayMs += 300;

    // Schedule all steps with setTimeout
    steps.forEach(({ fn, delayMs: d }) => {
      const timer = window.setTimeout(fn, d);
      this.demoTimers.push(timer);
    });
  }

  dispose(): void { this.clearDemo(); this.listeners.clear(); }

  private getRules(): RuleView[] {
    const challenge = this.getActiveChallenge();
    const barrierDescription = this.snapshot.ruleResolved ? `規則已成立：${challenge?.effect ?? "通路狀態已更新"}。` : `文字片尚未完成本關操作：${challenge?.prompt ?? "先排列規則"}`;
    return [
      { id: `R-${String(this.snapshot.activeRuleIndex + 1).padStart(2, "0")}`, label: challenge ? `${challenge.subject} ${challenge.verb} ${challenge.predicate}` : this.level.ruleLabel, kind: challenge?.mechanic === "condition" ? "條件" : challenge?.mechanic === "sequence" ? "時序" : challenge?.mechanic === "priority" ? "優先" : "賦有", status: this.snapshot.ruleResolved ? "complete" : "fragmented", description: barrierDescription },
      { id: "條件", label: `${challenge?.subject ?? "地圖元件"} → ${challenge?.predicate ?? "效果"}`, kind: "條件", status: this.snapshot.ruleResolved ? "complete" : "locked", description: this.snapshot.ruleResolved ? "條件已結算，相關元件已改變通行狀態。" : "條件尚未成立：焰流與潮體保持阻擋狀態，門印路徑不可通行。" },
      { id: "工作列", label: this.snapshot.ruleBlocks.join("　"), kind: "賦有", status: this.snapshot.ruleBlocks.length ? "complete" : "fragmented", description: "工作列上的文字片可左右推動，最後一片可送入隔離槽。" },
      { id: "隔離槽", label: this.snapshot.isolatedBlocks.join("　") || "尚未隔離文字片", kind: "條件", status: this.snapshot.isolatedBlocks.length ? "complete" : "locked", description: "隔離槽暫時拔除文字片與句子的接口。" },
      { id: "封鎖", label: this.snapshot.lockedBlocks.join("　") || "尚未封鎖文字片", kind: "優先", status: this.snapshot.lockedBlocks.length ? "locked" : "fragmented", description: "封鎖片不參與優先級裁決。" },
      { id: "影跡", label: "影子 賦有 映照行者", kind: "賦有", status: "complete", description: "影子保留行者剛才站的位置。" },
    ];
  }

  private commit(next: WorldSnapshot): void { this.timeline = this.timeline.slice(0, this.timelineIndex + 1); this.timeline.push(cloneSnapshot(next)); this.timelineIndex = this.timeline.length - 1; this.snapshot = cloneSnapshot(next); this.emit(); }
  private preview(message: string, updateMessage = true): void { if (updateMessage) this.snapshot.message = message; this.emit(); }
  private emit(): void { this.listeners.forEach((listener) => listener()); }
  private clearDemo(): void { this.demoTimers.forEach((timer) => window.clearTimeout(timer)); this.demoTimers = []; }
}
