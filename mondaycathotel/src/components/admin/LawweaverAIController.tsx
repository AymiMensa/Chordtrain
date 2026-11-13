import { useEffect, useState, useRef } from " react\;
export interface LawweaverAIState { isPlaying: boolean; currentLevel: number; levelsCleared: number; totalTurns: number; lastAction: string; }
import { useState } from " react\;
export function useLawweaverAI(initialLevel: LawweaverAIChallenge) {
  const [state, setState] = useState(LawweaverAIState);
  const iterationRef = { current: 0 };
  const MAX_ITERATIONS = 80;

  const takeAITurn = (ruleBlocks) => {
    iterationRef.current++;
    if (iterationRef.current > MAX_ITERATIONS) {
      return { action: "wait", detail: "達到迭代上限", gameFinished: false };
    }
    const subject = initialLevel.subject;
    const verb = initialLevel.verb;
    const predicate = initialLevel.predicate;
    const expectedPhrase = subject + "|" + verb + "|" + predicate;
    const currentPhrase = ruleBlocks.join("|");

    if (currentPhrase !== expectedPhrase) {
      const direction = ruleBlocks.indexOf(subject) >= 2 ? "left" : "right";
      return { action: "rearrange", detail: "推" + direction + "：整理殘句", gameFinished: false };
    }

    const canExecute = initialLevel.requiredOperation === "assemble" ? currentPhrase === expectedPhrase : initialLevel.requiredOperation === "separate";

    if (canExecute) {
      return { action: "execute", detail: "執行規則: " + subject + " " + verb + " " + predicate, gameFinished: false };
    }

    return { action: "move", detail: "檢查移動條件", gameFinished: false };
  };

  return {
    state,
    startAI: function() { setState({ ...state, isPlaying: true, lastAction: "AI 啟動" }); iterationRef.current = 0; },
    stopAI: function() { setState({ ...state, isPlaying: false, lastAction: "已暫停" }); },
    nextLevel: function() { setState({ ...state, currentLevel: (state.currentLevel + 1) % 10, levelsCleared: state.levelsCleared + 1, isPlaying: false, lastAction: "切換下一關" }); },
    resetAI: function() { setState({ isPlaying: false, currentLevel: 0, levelsCleared: 0, totalTurns: 0, lastAction: "已重置" }); iterationRef.current = 0; },
    takeAITurn
  };
}


