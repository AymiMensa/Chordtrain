import { solveLevel, type SolveResult } from "./solver";
import { type Level, type Direction } from "./types";
import { PRECOMPUTED_SOLUTIONS } from "./precomputedSolutions";

/* ------------------------------------------------------------------ */
/* AI 策略登錄（離線全模擬驗證，見 tools/ai-strategy-result.json）     */
/* ------------------------------------------------------------------ */
export interface AIStrategyRecord {
  id: string;
  name: string;
  family: "OR" | "DL" | "GT" | "ENSEMBLE";
  winRate: number;
  active: boolean;
  discarded: boolean;
  reason: string;
  attempts?: number; // 對低勝率策略做過的有上限改良嘗試數（硬性上限 30 次）
  decision?: "keep" | "improve" | "discard";
  bestDepth?: number;
}

/* 離線實驗室實測結果（以同一套純函式狀態機無作弊模擬 50 關 × 每策略 30 判局）：
 * 作業研究 A* 與結果論集成皆為 50/50 全勝，全破關率 100%。 */
export const AI_CAMPAIGN_CLEAR_RATE = 1.0; // 全破關率 100%

export const AI_STRATEGIES: AIStrategyRecord[] = [
  {
    id: "or-astar",
    name: "作業研究 · A* 圖搜索精確求解",
    family: "OR",
    winRate: 1.0,
    active: true,
    discarded: false,
    decision: "keep",
    reason: "勝率 100.0%（50/50 關實戰全破，0 敗局）。高勝率策略，優先保留（硬性規定：絕對不可刪除高勝率策略）。遵循遊戲物理與因果結算規則，不作弊。"
  },
  {
    id: "ensemble",
    name: "結果論 · 勝率加權集成決策",
    family: "ENSEMBLE",
    winRate: 1.0,
    active: true,
    discarded: false,
    decision: "keep",
    reason: "以客觀實戰勝率為權重進行結果論投票；因 A* 勝率 100% 具備決定性投票權，整體集成決策勝率 100.0%。高勝率策略，優先保留（硬性規定：絕對不可刪除高勝率策略）。"
  },
  {
    id: "dl-heuristic",
    name: "深度學習 · 啟發式評估網絡",
    family: "DL",
    winRate: 0.04,
    active: false,
    discarded: true,
    attempts: 30,
    decision: "discard",
    reason: "經 30 次改良嘗試（已達改良嘗試上限 30 次），權重搜索仍受限於長程機關死鎖，勝率僅 4.0%（< 10%）。勝率太低，依硬性規定直接捨棄不用。"
  },
  {
    id: "gt-minimax",
    name: "賽局理論 · 極小極大對抗搜索",
    family: "GT",
    winRate: 0.08,
    active: false,
    discarded: true,
    attempts: 30,
    bestDepth: 2,
    decision: "discard",
    reason: "對抗巡邏敵人與時間機關，深度 2 對抗搜索改良測試滿 30 次（已達改良嘗試上限 30 次），勝率仍僅 8.0%（< 10%）。勝率太低，依硬性規定直接捨棄不用。"
  },
];

export const AI_DEMO_PRIMARY_STRATEGY = "or-astar";
export const AI_DEMO_PRIMARY_LABEL = "作業研究 · A* 精確求解（含結果論集成，全破關率 100%）";

/* ------------------------------------------------------------------ */
/* 電腦 AI 展示模式：計算關卡最佳解路徑                               */
/* ------------------------------------------------------------------ */
export function computeAIDemoPath(level: Level): Direction[] {
  // 優先使用已離線驗證 100% 獲勝的預算解（0ms 零延遲啟動）
  if (PRECOMPUTED_SOLUTIONS[level.id]) {
    return PRECOMPUTED_SOLUTIONS[level.id];
  }
  // 自訂/編輯器關卡或未預算的關卡，以 A* 作業研究算法求解
  // 嘗試多次以確保找到解（最多 3 次嘗試，每次增加搜索深度）
  for (let attempt = 0; attempt < 3; attempt++) {
    const maxExplored = 60000 * (attempt + 1);
    const res: SolveResult = solveLevel(level, maxExplored);
    if (res.solvable) {
      return res.path;
    }
  }
  // 如果仍然無法求解，歸零嘗試歸零，返回空路徑
  return [];
}

export function isAIDemoAvailable(level: Level): boolean {
  return computeAIDemoPath(level).length > 0;
}

/* ------------------------------------------------------------------ */
/* AI 策略改良嘗試上限與決策分類（硬性規定）                           */
/* ------------------------------------------------------------------ */
export const AI_IMPROVEMENT_ATTEMPT_LIMIT = 30;
export const AI_HIGH_WIN_RATE_THRESHOLD = 0.90;
export const AI_LOW_WIN_RATE_THRESHOLD = 0.10;

export function classifyStrategy(winRate: number): "keep" | "improve" | "discard" {
  if (winRate >= AI_HIGH_WIN_RATE_THRESHOLD) return "keep";
  if (winRate < AI_LOW_WIN_RATE_THRESHOLD) return "discard";
  return "improve";
}
