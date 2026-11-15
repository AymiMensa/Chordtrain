/* 石棺索引設計提醒：此頁採展開卷宗格局，讓地圖是主角，規則、回放與編輯器像頁邊考據。 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BookOpen,
  Check,
  ChevronRight,
  FastForward,
  GraduationCap,
  Grid2X2,
  Hand,
  Keyboard,
  Lightbulb,
  MapPinned,
  Play,
  Redo2,
  RotateCcw,
  Settings2,
  Sparkles,
  Trophy,
  Undo2,
  Vibrate,
  Volume2,
  VolumeX,
  WandSparkles,
  X,
} from "lucide-react";
import GameCanvas from "@/components/GameCanvas";
import PixelChapterArt from "@/components/PixelChapterArt";
import { GameWorld, type WorldSnapshot } from "@/game/GameWorld";
import {
  createEditorLevel,
  CAMPAIGN_NODES,
  CURRICULUM,
  generateStructuredLevel,
  paintLevel,
  PLAYABLE_LEVELS,
  PRIMARY_LEVEL,
  type EditorTool,
} from "@/game/levels";
import { solveLevel, shouldDeferSolver, type SolveResult } from "@/game/solver";
import { SolverWorkerClient } from "@/game/solverWorkerClient";
import { tutorialStepFor } from "@/game/tutorial";
import { CHAPTER_NARRATIVES, chapterForLevel, endingForChapter, narrativeForChapter } from "@/game/campaignNarrative";
import { rateSteps, starGlyphs } from "@/game/rating";
import { handednessClass } from "@/game/handedness";
import { ADVANCED_RUNE_EMOJI, RUNE_CATEGORY, RUNE_EMOJI, RUNE_LEGEND, runeGlyph, type RuneDisplayStyle } from "@/game/emoji";
import { clampBoardZoom, clampEmojiScale, persistedDisplayValue } from "@/game/display";
import { appendHintHistory, ASSIST_LIMITS, clearHintUsageStats, consumeAssistCharge, emptyHintUsageRecord, HINT_BUTTON_LABEL, HINT_CONFIRMATION_SEEN_STORAGE_KEY, HINT_CONFIRMATION_TEXT, HINT_FOCUS_COPY, HINT_HISTORY_STORAGE_KEY, HINT_RESULT_CLOSE_LABEL, HINT_RESULT_PERSISTENCE_COPY, HINT_REVEAL_INTERVAL_MS, HINT_REVEAL_START_DELAY_MS, HINT_TURN_COST, HINT_UNLOCK_EFFECT_DURATION_MS, hintStatsStorageKey, isHintButtonInteractive, noticeProgressPercent, revealHintText, parseHintHistory, parseHintUsageRecord, recordHintUsage, resetAssistCharges, RESTART_NOTICE_DURATION_MS, shouldShowHintConfirmation, type HintHistoryEntry, type HintUsageRecord } from "@/game/assist";
import { effectiveFeedbackVolume, FEEDBACK_VOLUME_GROUPS, normalizeDisplayQualityMode, parseFeedbackPreferences, type DisplayQualityMode, type FeedbackGroup, type FeedbackPreferences, type SoundFeedback } from "@/game/feedback";
import { BackgroundMusic, clampMusicVolume, DEFAULT_MUSIC_ANIMATION_MODE, DEFAULT_MUSIC_SPECTRUM, DEFAULT_MUSIC_TRANSITION, MUSIC_ANIMATION_OPTIONS, musicRhythmProfileForChapter, musicSpectrumForReplayFrame, musicTrackForScene, normalizeMusicAnimationMode, musicTransitionLabel, sceneKeyFor, type MusicAnimationMode, type MusicSpectrumFrame, type MusicTransitionState } from "@/game/audio";
import type { Direction, Level } from "@/game/types";
import { computeAIDemoPath, AI_STRATEGIES, AI_CAMPAIGN_CLEAR_RATE, AI_DEMO_PRIMARY_LABEL } from "@/game/aiStrategy";
import { PRECOMPUTED_SOLUTIONS } from "@/game/precomputedSolutions";

const LOGO_URL = "/manus-storage/echoes-logo_a8fbce16.png";
const MAX_UNDO_CHARGES = ASSIST_LIMITS.undo;
const MAX_HINT_CHARGES = ASSIST_LIMITS.hint;
const EMPTY_SOLVE_RESULT: SolveResult = { solvable: false, moves: 0, path: [], explored: 0, capped: false };
type SolveTarget = { level: Level; cursor: number; state: WorldSnapshot["state"] };
type SolveIntent = "none" | "hint" | "rescue";
type SolveCacheEntry = SolveTarget & { result: SolveResult };
const HINT_PANEL_POSITION_STORAGE_KEY = "echoes-hint-panel-position";
type HintPanelPosition = { left: number; top: number };

function parseHintPanelPosition(raw: string | null): HintPanelPosition | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<HintPanelPosition>;
    if (typeof parsed.left !== "number" || !Number.isFinite(parsed.left) || typeof parsed.top !== "number" || !Number.isFinite(parsed.top)) return null;
    return { left: parsed.left, top: parsed.top };
  } catch {
    return null;
  }
}

function clampHintPanelPosition(position: HintPanelPosition, width: number, height: number, panelWidth = 400, panelHeight = 112): HintPanelPosition {
  const maxLeft = Math.max(8, width - panelWidth - 8);
  const maxTop = Math.max(8, height - panelHeight - 8);
  return { left: Math.min(maxLeft, Math.max(8, Math.round(position.left))), top: Math.min(maxTop, Math.max(8, Math.round(position.top))) };
}

function MusicSpectrum({ frame, compact = false }: { frame: MusicSpectrumFrame; compact?: boolean }) {
  const intensity = Math.round(((frame.low + frame.mid + frame.high) / 3) * 100);
  return (
    <div className={`music-spectrum ${compact ? "is-compact" : ""} ${frame.active ? "is-active" : "is-muted"}`} role="img" aria-label={frame.active ? `音訊頻譜：低頻 ${Math.round(frame.low * 100)}%、中頻 ${Math.round(frame.mid * 100)}%、高頻 ${Math.round(frame.high * 100)}%` : "音訊頻譜：背景音樂未播放或已靜音"}>
      <div className="music-spectrum-bars" aria-hidden="true">{frame.bars.map((bar, index) => <i key={index} style={{ "--spectrum-height": `${Math.max(6, Math.round(bar * 100))}%`, "--spectrum-delay": `${index * 18}ms` } as CSSProperties} />)}</div>
      <span className="music-spectrum-caption">SPECTRUM · {intensity}%</span>
    </div>
  );
}

function MusicTransitionIndicator({ state, volume, spectrum, compact = false }: { state: MusicTransitionState; volume: number; spectrum: MusicSpectrumFrame; compact?: boolean }) {
  const fromPercent = Math.round(state.fromVolume * 100);
  const toPercent = Math.round(state.toVolume * 100);
  const displayPercent = state.phase === "fade-out" ? toPercent : toPercent;
  const style = {
    "--music-from": `${fromPercent}%`,
    "--music-to": `${toPercent}%`,
    "--music-duration": `${Math.max(0, state.durationMs)}ms`,
  } as CSSProperties;
  return (
    <section className={`music-transition-indicator ${compact ? "is-compact" : ""} ${state.phase}`} aria-label="背景音樂音量變化" role="status" aria-live={state.phase === "idle" ? "off" : "polite"}>
      <div className="music-transition-heading"><span>BACKGROUND SCORE</span><strong>{musicTransitionLabel(state.phase)}</strong><b>{displayPercent}%</b></div>
      <div className="music-track-and-spectrum"><div className="music-track-line"><span aria-hidden="true">♫</span><strong>{state.track.name}</strong><small>{state.track.subtitle}</small></div><MusicSpectrum frame={spectrum} compact={compact} /></div>
      <div className="music-meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={displayPercent} aria-valuetext={`背景音樂${musicTransitionLabel(state.phase)}，目標音量 ${displayPercent}%`}>
        <span key={state.transitionId} className="music-meter-fill" style={style} />
        <i aria-hidden="true" />
      </div>
      <small>{state.phase === "idle" ? `穩定音量 · ${Math.round(volume * 100)}%` : state.phase === "fade-out" ? "舊場景正在收束，準備換場。" : "新場景正在淡入，請聽見回聲變化。"}</small>
    </section>
  );
}

const tools: Array<{ id: EditorTool; label: string; glyph: string }> = [
  { id: "floor", label: "清空", glyph: "·" },
  { id: "wall", label: "石牆", glyph: RUNE_EMOJI.sealed },
  { id: "sealed", label: "封石", glyph: RUNE_EMOJI.sealed },
  { id: "breakable", label: "脆障", glyph: "🪨" },
  { id: "start", label: "起點", glyph: RUNE_EMOJI.player },
  { id: "exit", label: "封印", glyph: RUNE_EMOJI.exit },
  { id: "crate", label: "木箱", glyph: RUNE_EMOJI.crate },
  { id: "plate", label: "壓板", glyph: RUNE_EMOJI.plate },
  { id: "door", label: "石門", glyph: RUNE_EMOJI.door },
  { id: "portal", label: "門扉", glyph: RUNE_EMOJI.portal },
  { id: "trap", label: "延遲刺", glyph: RUNE_EMOJI.trap },
  { id: "mine", label: "地雷", glyph: RUNE_EMOJI.mine },
  { id: "flame", label: "火線", glyph: RUNE_EMOJI.flame },
  { id: "enemy", label: "石像", glyph: RUNE_EMOJI.enemy },
];

const directionIcons: Record<Direction, typeof ArrowUp> = {
  up: ArrowUp,
  down: ArrowDown,
  left: ArrowLeft,
  right: ArrowRight,
};

const directionText: Record<Direction, string> = {
  up: "向上",
  down: "向下",
  left: "向左",
  right: "向右",
};

const SOUND_PREVIEW_OPTIONS: Array<{ type: SoundFeedback; glyph: string; label: string }> = [
  { type: "door", glyph: "🚪", label: "石門開啟" },
  { type: "enemy", glyph: "👹", label: "石像追蹤" },
  { type: "trap", glyph: "⚠️", label: "尖刺觸發" },
  { type: "mine", glyph: "💣", label: "地雷爆裂" },
  { type: "flame", glyph: "🔥", label: "火焰掃線" },
  { type: "rock", glyph: "☄️", label: "落石砸落" },
];

function playFeedbackSound(type: SoundFeedback, volume: number) {
  try {
    const AudioContextClass = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    void context.resume();
    const now = context.currentTime;
    const master = context.createGain();
    const safeVolume = Math.min(1, Math.max(0, volume));
    master.gain.setValueAtTime(Math.max(0.001, 0.065 * safeVolume), now);
    master.gain.exponentialRampToValueAtTime(0.001, now + (type === "mine" ? 0.3 : 0.2));
    master.connect(context.destination);
    const oscillator = context.createOscillator();
    const settings: Record<SoundFeedback, { wave: OscillatorType; start: number; end: number; duration: number }> = {
      stage: { wave: "square", start: 620, end: 880, duration: 0.18 },
      door: { wave: "square", start: 420, end: 760, duration: 0.18 },
      impact: { wave: "square", start: 118, end: 58, duration: 0.13 },
      enemy: { wave: "square", start: 155, end: 70, duration: 0.2 },
      trap: { wave: "triangle", start: 240, end: 90, duration: 0.13 },
      mine: { wave: "sawtooth", start: 76, end: 42, duration: 0.25 },
      flame: { wave: "triangle", start: 330, end: 150, duration: 0.13 },
      rock: { wave: "triangle", start: 180, end: 55, duration: 0.22 },
      rockBlock: { wave: "square", start: 520, end: 190, duration: 0.09 },
    };
    const preset = settings[type];
    oscillator.type = preset.wave;
    oscillator.frequency.setValueAtTime(preset.start, now);
    oscillator.frequency.exponentialRampToValueAtTime(preset.end, now + preset.duration);
    oscillator.connect(master);
    oscillator.start(now);
    oscillator.stop(now + preset.duration + 0.01);
    if (type === "mine" || type === "flame") {
      const accent = context.createOscillator();
      const accentGain = context.createGain();
      accent.type = type === "mine" ? "sawtooth" : "square";
      accent.frequency.setValueAtTime(type === "mine" ? 220 : 680, now);
      accent.frequency.exponentialRampToValueAtTime(type === "mine" ? 38 : 210, now + (type === "mine" ? 0.24 : 0.11));
      accentGain.gain.setValueAtTime(Math.max(0.001, (type === "mine" ? 0.07 : 0.035) * safeVolume), now);
      accentGain.gain.exponentialRampToValueAtTime(0.001, now + (type === "mine" ? 0.25 : 0.12));
      accent.connect(accentGain).connect(context.destination);
      accent.start(now);
      accent.stop(now + (type === "mine" ? 0.26 : 0.13));
    }
    window.setTimeout(() => void context.close(), type === "mine" ? 340 : 240);
  } catch {
    // 某些瀏覽器會封鎖非使用者手勢的音訊；視覺與震動仍會保留。
  }
}

const advancedLessons = [
  { glyph: ADVANCED_RUNE_EMOJI.sentinel, title: "巡弋與撞擊", body: "石像每回合只走自己的節拍。先讀它的下一格；當它撞上脆障，地圖會在你的回合結束後改寫。" },
  { glyph: ADVANCED_RUNE_EMOJI.trap, title: "延遲尖刺", body: "踏上陷阱格時只出現預警，下一回合才結算。你可以利用這段延遲離開，也能用它推測敵人的安全窗。" },
  { glyph: ADVANCED_RUNE_EMOJI.portal, title: "有方向的傳送", body: "單向門扉只有入口有效。出口不是原路折返，而是把盤面狀態帶到新的座標。" },
  { glyph: ADVANCED_RUNE_EMOJI.hint, title: "用提示驗算", body: "提示不是替你操作；它會從現在的完整狀態執行 A*，只顯示下一筆最短解刻痕。" },
  { glyph: ADVANCED_RUNE_EMOJI.mine, title: "地雷爆心", body: "踩中地雷只會啟動引信。下一回合，它會炸開周邊九格並震碎脆障；離開爆心後再觀察新的路徑。" },
  { glyph: ADVANCED_RUNE_EMOJI.flame, title: "火線刻度", body: "每個噴口都依固定週期工作。紅橙火線是當前回合的危險格；等待它熄滅的那一筆刻痕再通過。" },
  { glyph: ADVANCED_RUNE_EMOJI.sealed, title: "封石邊界", body: "深色封石不是脆障。石像、木箱和爆心都無法改寫它，所以必須從地圖的其餘因果尋找出口。" },
];

type FeedbackType = "none" | SoundFeedback;
function readFeedbackPreferences(): FeedbackPreferences {
  return parseFeedbackPreferences(window.localStorage.getItem("echoes-feedback-preferences"));
}

function readHintStats(): Record<string, HintUsageRecord> {
  const stats: Record<string, HintUsageRecord> = {};
  try {
    PLAYABLE_LEVELS.forEach((level) => {
      const record = parseHintUsageRecord(window.localStorage.getItem(hintStatsStorageKey(level.id)));
      if (record.uses > 0) stats[level.id] = record;
    });
  } catch {
    return {};
  }
  return stats;
}

function formatElapsed(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function initialCampaignIndex() {
  const requested = Number(new URLSearchParams(window.location.search).get("level"));
  if (!Number.isInteger(requested) || requested < 1 || requested > PLAYABLE_LEVELS.length) return 0;
  return requested - 1;
}

function buildWorldSnapshot(world: GameWorld) {
  return world.snapshot();
}

function solveTargetForSnapshot(snapshot: WorldSnapshot): SolveTarget {
  return { level: snapshot.level, cursor: snapshot.cursor, state: snapshot.state };
}

function sameSolveTarget(target: SolveTarget | null, snapshot: WorldSnapshot) {
  return Boolean(target && target.level.id === snapshot.level.id && target.cursor === snapshot.cursor && target.state === snapshot.state);
}

function deathCauseCopy(cause: WorldSnapshot["state"]["deathCause"]) {
  if (cause === "trap") return { label: "尖刺陷阱", detail: "你在尖刺完成結算前沒有離開危險格。" };
  if (cause === "mine") return { label: "炸彈地雷", detail: "爆心吞沒了你所在的格位。" };
  if (cause === "flame") return { label: "火焰噴射器", detail: "火線在這一拍掃過了你的路線。" };
  if (cause === "rock") return { label: "落石壓迫", detail: "巨石沿預警刻痕砸落，封住了你的格位。" };
  if (cause === "enemy") return { label: "巡弋石像", detail: "石像依巡邏節拍封住了你的退路。" };
  return { label: "石室危險", detail: "這一步觸發了尚未讀懂的因果。" };
}

function makeRandomEditor(size: number) {
  const serial = Math.floor(Math.random() * 100_000);
  return generateStructuredLevel(size, `draft-${size}-${serial}`, serial);
}

export default function Home() {
  const initialLevelIndex = initialCampaignIndex();
  const [world] = useState(() => new GameWorld(PLAYABLE_LEVELS[initialLevelIndex] ?? PRIMARY_LEVEL));
  const [snapshot, setSnapshot] = useState<WorldSnapshot>(() => buildWorldSnapshot(world));
  const [drawer, setDrawer] = useState<"none" | "editor" | "curriculum" | "reference" | "advanced" | "settings" | "campaign" | "gallery">(() => { const panel = new URLSearchParams(window.location.search).get("panel"); return panel === "runes" ? "reference" : panel === "settings" ? "settings" : "none"; });
  const [editorSize, setEditorSize] = useState(8);
  const [editorLevel, setEditorLevel] = useState<Level>(() => createEditorLevel(8));
  const [selectedTool, setSelectedTool] = useState<EditorTool>("wall");
  const [solveResult, setSolveResult] = useState<SolveResult>(EMPTY_SOLVE_RESULT);
  const [currentSolveResult, setCurrentSolveResult] = useState<SolveResult>(EMPTY_SOLVE_RESULT);
  const [optimalSolveReady, setOptimalSolveReady] = useState(false);
  const [editorResult, setEditorResult] = useState<SolveResult | null>(null);
  const [aiDemoMode, setAiDemoMode] = useState(false);
  const [aiDemoPath, setAiDemoPath] = useState<Direction[]>([]);
  const [aiDemoIndex, setAiDemoIndex] = useState(0);
  const [aiAutoNext, setAiAutoNext] = useState(true);
  const [aiSpeed, setAiSpeed] = useState<number>(200);
  const aiDemoTimerRef = useRef<number | null>(null);
  const aiDemoModeRef = useRef(false);
  const aiAutoNextRef = useRef(true);
  const aiSpeedRef = useRef(200);
  const [aiLedgerOpen, setAiLedgerOpen] = useState(false);
  const [hintOpen, setHintOpen] = useState(false);
  const [shortcutOpen, setShortcutOpen] = useState(false);
  const [boardZoom, setBoardZoom] = useState(() => persistedDisplayValue(window.localStorage.getItem("echoes-board-zoom"), 1, clampBoardZoom));
  const [emojiScale, setEmojiScale] = useState(() => persistedDisplayValue(window.localStorage.getItem("echoes-emoji-scale"), 1, clampEmojiScale));
  const [tutorialChoiceOpen, setTutorialChoiceOpen] = useState(() => window.localStorage.getItem("echoes-tutorial-choice") === null && window.localStorage.getItem("echoes-tutorial-complete") !== "yes");
  const [tutorialActive, setTutorialActive] = useState(() => window.localStorage.getItem("echoes-tutorial-complete") !== "yes" && window.localStorage.getItem("echoes-tutorial-choice") !== "skip");
  const [hintDirection, setHintDirection] = useState<Direction | null>(null);
  const [hintRevealCharacters, setHintRevealCharacters] = useState(0);
  const [hintPanelOpen, setHintPanelOpen] = useState(false);
  const [hintPanelClosing, setHintPanelClosing] = useState(false);
  const [pathGuideOpen, setPathGuideOpen] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackType>("none");
  const [stageInterlude, setStageInterlude] = useState<string | null>(null);
  const [campaignFilter, setCampaignFilter] = useState<"all" | "completed" | "incomplete">("all");
  const [levelIndex, setLevelIndex] = useState(initialLevelIndex);
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [advancedLesson, setAdvancedLesson] = useState(0);
  const [dialogueIndex, setDialogueIndex] = useState(0);
  const [galleryChapter, setGalleryChapter] = useState(1);
  const [feedbackPreferences, setFeedbackPreferences] = useState<FeedbackPreferences>(readFeedbackPreferences);
  const [musicTransition, setMusicTransition] = useState<MusicTransitionState>(DEFAULT_MUSIC_TRANSITION);
  const [musicSpectrum, setMusicSpectrum] = useState<MusicSpectrumFrame>(DEFAULT_MUSIC_SPECTRUM);
  const [hintStats, setHintStats] = useState<Record<string, HintUsageRecord>>(readHintStats);
  const [hintHistory, setHintHistory] = useState<HintHistoryEntry[]>(() => parseHintHistory(window.localStorage.getItem(HINT_HISTORY_STORAGE_KEY)));
  const [hintHistoryOpen, setHintHistoryOpen] = useState(false);
  const initialHintPanelPosition = parseHintPanelPosition(window.localStorage.getItem(HINT_PANEL_POSITION_STORAGE_KEY));
  const [hintPanelPosition, setHintPanelPosition] = useState<HintPanelPosition | null>(initialHintPanelPosition);
  const hintPanelPositionRef = useRef<HintPanelPosition | null>(initialHintPanelPosition);
  const hintPanelDragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null);
  const [hintPanelDragging, setHintPanelDragging] = useState(false);
  const [statsConfirm, setStatsConfirm] = useState<"level" | "all" | null>(null);
  const [runeStyle, setRuneStyle] = useState<RuneDisplayStyle>(() => window.localStorage.getItem("echoes-rune-style") === "pixel" ? "pixel" : "emoji");
  const [runeQuery, setRuneQuery] = useState("");
  const [runeCategory, setRuneCategory] = useState("全部");
  const [leftRailOpen, setLeftRailOpen] = useState(false);
  const [rightRailOpen, setRightRailOpen] = useState(false);
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const [completedLevelIds, setCompletedLevelIds] = useState<string[]>(() => {
    try {
      return PLAYABLE_LEVELS.filter((level) => window.localStorage.getItem(`echoes-best-${level.id}`) !== null).map((level) => level.id);
    } catch {
      return [];
    }
  });
  const [levelStars, setLevelStars] = useState<Record<string, number>>(() => Object.fromEntries(PLAYABLE_LEVELS.map((level) => [level.id, Number(window.localStorage.getItem(`echoes-stars-${level.id}`)) || 0])));
  const [monument, setMonument] = useState<{ chapter: number; phase: "opening" | "closing"; endingTier?: 1 | 2 | 3 } | null>(() => ({ chapter: chapterForLevel(initialLevelIndex), phase: "opening" }));
  const [campaignFinished, setCampaignFinished] = useState(false);
  const [undoCharges, setUndoCharges] = useState<number>(MAX_UNDO_CHARGES);
  const [hintCharges, setHintCharges] = useState<number>(MAX_HINT_CHARGES);
  const [assistNotice, setAssistNotice] = useState<string | null>(null);
  const [hintConfirmOpen, setHintConfirmOpen] = useState(false);
  const [hintConfirmationSeen, setHintConfirmationSeen] = useState(() => window.localStorage.getItem(HINT_CONFIRMATION_SEEN_STORAGE_KEY) === "yes");
  const [solutionLoading, setSolutionLoading] = useState(false);
  const [solutionIntent, setSolutionIntent] = useState<SolveIntent>("none");
  const [rescueOpen, setRescueOpen] = useState(false);
  const assistNoticeTimerRef = useRef<number | null>(null);
  const assistNoticeProgressTimerRef = useRef<number | null>(null);
  const hintUnlockTimerRef = useRef<number | null>(null);
  const hintPanelCloseTimerRef = useRef<number | null>(null);
  const hintTypewriterTimerRef = useRef<number | null>(null);
  const solutionTimerRef = useRef<number | null>(null);
  const solutionRequestIdRef = useRef(0);
  const solutionCacheRef = useRef<SolveCacheEntry | null>(null);
  const solutionRequestTargetRef = useRef<SolveTarget | null>(null);
  const optimalSolveTimerRef = useRef<number | null>(null);
  const optimalSolveRequestIdRef = useRef(0);
  const optimalSolveLevelRef = useRef<{ level: Level; result: SolveResult } | null>(null);
  const currentSolverWorkerRef = useRef<SolverWorkerClient | null>(null);
  const optimalSolverWorkerRef = useRef<SolverWorkerClient | null>(null);
  const closeHintDisplayRef = useRef<() => void>(() => undefined);
  const [assistNoticeProgress, setAssistNoticeProgress] = useState<number | null>(null);
  const [hintUnlockEffect, setHintUnlockEffect] = useState(false);
  const hintConfirmButtonRef = useRef<HTMLButtonElement | null>(null);
  const confirmHintRef = useRef<() => void>(() => undefined);
  const revealHintAfterSolutionRef = useRef<(result?: SolveResult) => void>(() => undefined);
  const undoMoveRef = useRef<() => void>(() => undefined);
  const revealHintRef = useRef<() => void>(() => undefined);
  const toggleMuteRef = useRef<() => void>(() => undefined);
  const resetRoundRef = useRef<() => void>(() => undefined);
  const musicRef = useRef<BackgroundMusic | null>(null);

  useEffect(() => world.subscribe(setSnapshot), [world]);
  useEffect(() => { aiDemoModeRef.current = aiDemoMode; }, [aiDemoMode]);
  useEffect(() => { aiAutoNextRef.current = aiAutoNext; }, [aiAutoNext]);
  useEffect(() => { aiSpeedRef.current = aiSpeed; }, [aiSpeed]);
  useEffect(() => () => world.dispose(), [world]);
  useEffect(() => () => {
    if (assistNoticeTimerRef.current !== null) window.clearTimeout(assistNoticeTimerRef.current);
    if (assistNoticeProgressTimerRef.current !== null) window.clearTimeout(assistNoticeProgressTimerRef.current);
    if (hintUnlockTimerRef.current !== null) window.clearTimeout(hintUnlockTimerRef.current);
    if (hintPanelCloseTimerRef.current !== null) window.clearTimeout(hintPanelCloseTimerRef.current);
    if (hintTypewriterTimerRef.current !== null) window.clearTimeout(hintTypewriterTimerRef.current);
    if (solutionTimerRef.current !== null) window.clearTimeout(solutionTimerRef.current);
    if (optimalSolveTimerRef.current !== null) window.clearTimeout(optimalSolveTimerRef.current);
    solutionRequestIdRef.current += 1;
    optimalSolveRequestIdRef.current += 1;
    currentSolverWorkerRef.current?.dispose();
    optimalSolverWorkerRef.current?.dispose();
  }, []);
  useEffect(() => {
    if (hintTypewriterTimerRef.current !== null) window.clearTimeout(hintTypewriterTimerRef.current);
    if (!hintPanelOpen || !hintDirection) {
      setHintRevealCharacters(0);
      hintTypewriterTimerRef.current = null;
      return;
    }
    const text = `下一步：${directionText[hintDirection]}`;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (reducedMotion) {
      setHintRevealCharacters(text.length);
      hintTypewriterTimerRef.current = null;
      return;
    }
    setHintRevealCharacters(0);
    let characters = 0;
    const revealNextCharacter = () => {
      characters += 1;
      setHintRevealCharacters(characters);
      if (characters < text.length) {
        hintTypewriterTimerRef.current = window.setTimeout(revealNextCharacter, HINT_REVEAL_INTERVAL_MS);
      } else {
        hintTypewriterTimerRef.current = null;
      }
    };
    hintTypewriterTimerRef.current = window.setTimeout(revealNextCharacter, HINT_REVEAL_START_DELAY_MS);
    return () => {
      if (hintTypewriterTimerRef.current !== null) {
        window.clearTimeout(hintTypewriterTimerRef.current);
        hintTypewriterTimerRef.current = null;
      }
    };
  }, [hintDirection, hintPanelOpen]);
  useEffect(() => {
    if (!hintConfirmOpen) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusTimer = window.setTimeout(() => hintConfirmButtonRef.current?.focus(), 0);
    return () => {
      window.clearTimeout(focusTimer);
      previouslyFocused?.focus();
    };
  }, [hintConfirmOpen]);

  useEffect(() => {
    const music = new BackgroundMusic();
    musicRef.current = music;
    music.setVolume(feedbackPreferences.musicVolume);
    music.setMuted(feedbackPreferences.muted);
    music.setAnimationMode(feedbackPreferences.musicAnimationMode ?? DEFAULT_MUSIC_ANIMATION_MODE);
    const unsubscribe = music.subscribe(setMusicTransition);
    const unsubscribeSpectrum = music.subscribeSpectrum(setMusicSpectrum);
    const unlock = () => music.unlock();
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      unsubscribe();
      unsubscribeSpectrum();
      music.dispose();
      musicRef.current = null;
    };
  }, []);

  useEffect(() => {
    musicRef.current?.setVolume(feedbackPreferences.musicVolume);
    musicRef.current?.setMuted(feedbackPreferences.muted);
    musicRef.current?.setAnimationMode(feedbackPreferences.musicAnimationMode ?? DEFAULT_MUSIC_ANIMATION_MODE);
  }, [feedbackPreferences.musicVolume, feedbackPreferences.muted, feedbackPreferences.musicAnimationMode]);

  useEffect(() => {
    const syncViewport = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", syncViewport);
    window.addEventListener("orientationchange", syncViewport);
    return () => {
      window.removeEventListener("resize", syncViewport);
      window.removeEventListener("orientationchange", syncViewport);
    };
  }, []);

  useEffect(() => {
    if (snapshot.state.status !== "won" || levelIndex < 0 || !optimalSolveReady) return;
    const levelId = snapshot.level.id;
    setCompletedLevelIds((current) => current.includes(levelId) ? current : [...current, levelId]);
    const rating = rateSteps(snapshot.best ?? snapshot.state.turn, solveResult.moves);
    setLevelStars((current) => {
      const nextStars = Math.max(current[levelId] ?? 0, rating.stars);
      window.localStorage.setItem(`echoes-stars-${levelId}`, String(nextStars));
      return { ...current, [levelId]: nextStars };
    });
    if (levelIndex === PLAYABLE_LEVELS.length - 1) {
      setCampaignFinished(true);
      setMonument({ chapter: 5, phase: "closing", endingTier: rating.stars as 1 | 2 | 3 });
    } else if ((levelIndex + 1) % 10 === 0) setMonument({ chapter: chapterForLevel(levelIndex), phase: "closing", endingTier: rating.stars as 1 | 2 | 3 });
  }, [levelIndex, snapshot.level.id, snapshot.state.status, snapshot.state.turn, snapshot.best, solveResult.moves]);

  useEffect(() => {
    const eventText = snapshot.state.events.at(-1) ?? "";
    const isStage = eventText.startsWith("STAGE_COMPLETE:");
    if (isStage) setStageInterlude(eventText.slice("STAGE_COMPLETE:".length));
    const type = isStage ? "stage" : eventText.startsWith("DOOR_OPEN:") ? "door" : eventText.includes("木箱攔住落石") ? "rockBlock" : eventText.includes("撞碎了脆弱石障") ? "impact" : eventText.includes("巡弋路徑") || eventText.includes("封住了你的格位") || eventText.includes("主動走進了巡弋路徑") ? "enemy" : eventText.includes("自爆地雷") || eventText.includes("地雷自毀") ? "mine" : eventText.includes("火焰噴射器") ? "flame" : eventText.includes("落石") ? "rock" : eventText.includes("尖刺") ? "trap" : "none";
    if (type === "none") {
      setFeedback("none");
      return;
    }
    setFeedback(type);
    const timer = window.setTimeout(() => setFeedback("none"), 680);
    return () => window.clearTimeout(timer);
  }, [snapshot.cursor, snapshot.state.events]);

  useEffect(() => {
    if (feedback === "none") return;
    if (feedbackPreferences.haptics && "vibrate" in navigator) navigator.vibrate(feedback === "stage" ? [18, 24, 42] : feedback === "door" ? [16, 28, 48] : feedback === "impact" || feedback === "enemy" ? [40, 30, 55] : feedback === "mine" ? [22, 18, 32, 18, 95] : feedback === "flame" ? [12, 18, 12, 18, 12, 24, 12] : feedback === "rock" ? [55, 24, 70] : feedback === "rockBlock" ? [28, 18, 45] : [30, 25, 30, 25, 70]);
    if (!feedbackPreferences.sound || feedbackPreferences.muted) return;
    playFeedbackSound(feedback, effectiveFeedbackVolume(feedback, feedbackPreferences));
  }, [feedback, feedbackPreferences]);

  useEffect(() => {
    if (snapshot.cursor > 0 && !snapshot.replaying) setRescueOpen(false);
  }, [snapshot.cursor, snapshot.replaying]);

  useEffect(() => {
    if (snapshot.state.status !== "playing") return;
    const update = () => setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [snapshot.state.status, startedAt]);

  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has("demo")) return;
    const solution = solveLevel(PRIMARY_LEVEL).path;
    let cursor = 0;
    const timer = window.setInterval(() => {
      if (cursor >= solution.length) {
        window.clearInterval(timer);
        return;
      }
      world.move(solution[cursor]);
      cursor += 1;
    }, 480);
    return () => window.clearInterval(timer);
  }, [world]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || target?.tagName === "INPUT" || target?.tagName === "TEXTAREA") return;
      if (hintConfirmOpen) {
        if (event.key === "Escape") {
          event.preventDefault();
          setHintConfirmOpen(false);
        } else if (event.key === "Enter") {
          event.preventDefault();
          confirmHintRef.current();
        }
        return;
      }
      if (hintPanelOpen && event.key === "Escape") {
        event.preventDefault();
        closeHintDisplayRef.current();
        return;
      }
      const map: Record<string, Direction | undefined> = {
        ArrowUp: "up",
        w: "up",
        W: "up",
        ArrowDown: "down",
        s: "down",
        S: "down",
        ArrowLeft: "left",
        a: "left",
        A: "left",
        ArrowRight: "right",
        d: "right",
        D: "right",
      };
      const direction = map[event.key];
      if (direction) {
        event.preventDefault();
        world.move(direction);
      }
      if (event.key.toLowerCase() === "z") {
        event.preventDefault();
        undoMoveRef.current();
      }
      if (event.key.toLowerCase() === "h") {
        event.preventDefault();
        revealHintRef.current();
      }
      if (event.key.toLowerCase() === "r") resetRoundRef.current();
      if (event.key.toLowerCase() === "m") {
        event.preventDefault();
        toggleMuteRef.current();
      }
      if (event.key.toLowerCase() === "p") world.replay();
      if (event.key === "Escape") {
        setShortcutOpen(false);
        setHintOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [hintConfirmOpen, hintPanelOpen, world]);

  const eventLine = snapshot.state.events.at(-1) ?? "石室沒有新的註記。";
  const currentChapter = levelIndex < 0 ? 0 : chapterForLevel(levelIndex);
  const musicScene = sceneKeyFor(currentChapter, monument?.phase ?? "play", levelIndex);
  const replayTrack = useMemo(() => musicTrackForScene(musicScene), [musicScene]);
  const replaySpectrum = useMemo(() => snapshot.replaying ? musicSpectrumForReplayFrame(replayTrack, snapshot.cursor, snapshot.state.turn, feedbackPreferences.musicVolume, feedbackPreferences.muted) : null, [feedbackPreferences.muted, feedbackPreferences.musicVolume, replayTrack, snapshot.cursor, snapshot.replaying, snapshot.state.turn]);
  const renderedMusicSpectrum = replaySpectrum ?? musicSpectrum;
  const maxCompletedIndex = completedLevelIds.reduce((max, id) => Math.max(max, PLAYABLE_LEVELS.findIndex((level) => level.id === id)), -1);
  // 保留歷史最高解鎖上限供參考；關卡選擇已全開放（見下方 campaign-map 節點），此值不再限制選關
  const maxUnlockedIndex = Math.max(0, levelIndex, maxCompletedIndex);
  const scoreText = snapshot.best === null ? "尚無紀錄" : `${snapshot.best} 步`;
  const activePath = useMemo(
    () => solveResult.path.slice(0, 12).map((move) => ({ move, Icon: directionIcons[move] })),
    [solveResult],
  );
  const currentSolution = currentSolveResult;
  const rescueSolution = currentSolveResult;
  const currentHintStats = hintStats[snapshot.level.id] ?? emptyHintUsageRecord();
  const totalHintStats = useMemo(() => Object.values(hintStats).reduce((total, record) => ({ uses: total.uses + record.uses, totalCost: total.totalCost + record.totalCost }), { uses: 0, totalCost: 0 }), [hintStats]);
  const currentHintAverageCost = currentHintStats.uses > 0 ? Math.round(currentHintStats.totalCost / currentHintStats.uses) : 0;
  const selectedAnimationMode = MUSIC_ANIMATION_OPTIONS.find((option) => option.id === (feedbackPreferences.musicAnimationMode ?? DEFAULT_MUSIC_ANIMATION_MODE)) ?? MUSIC_ANIMATION_OPTIONS[1];
  const rhythmProfile = musicRhythmProfileForChapter(currentChapter);
  const replayTarget = Math.max(0, snapshot.replayTarget || snapshot.historyLength - 1);
  const replayPercent = replayTarget > 0 ? Math.round((snapshot.cursor / replayTarget) * 100) : 0;
  const currentSolutionCached = sameSolveTarget(solutionCacheRef.current, snapshot);
  const nextHint = currentSolutionCached ? currentSolution.path[0] ?? null : null;
  const guidePath = useMemo(() => currentSolution.path.slice(0, 18).map((move, index) => ({ move, index, Icon: directionIcons[move] })), [currentSolution]);
  const hasDedicatedPathGuide = levelIndex === 35 || levelIndex === 37;
  const tutorialStep = tutorialStepFor(snapshot.state);
  const isLargeBoard = snapshot.level.columns >= 16 || snapshot.level.rows >= 16;
  const usesEdgeRails = isLargeBoard || viewport.width < 1100 || viewport.height < 690;
  const activeMechanics = [
    ["👹", "巡弋石像", "沿既定路徑移動，會撞碎脆障。"],
    ["🟡", "壓力石板", "玩家與木箱皆能保持石門開啟。"],
    ["🌀", "單向門扉", "只在入口格折疊位置，出口不會反向傳送。"],
    ["⚠️", "延遲尖刺", "踩下後下一回合才結算；離開即安全。"],
    ...(snapshot.level.mines.length ? [["💣", "自爆地雷", "兩拍引信後炸開 3×3 爆心。"]] : []),
    ...(snapshot.level.flameJets.length ? [["🔥", "火焰噴射", "依固定回合刻度掃過火線。"]] : []),
    ...(snapshot.level.rockfalls.length ? [["☄️", "落石", "預警後沿固定路線墜落；離開落點或利用木箱與地形避開。"]] : []),
    ...(Object.values(snapshot.level.terrain).includes("sealed") ? [[RUNE_EMOJI.sealed, "封石牆", "不可推動也不可破壞的永久邊界。"]] : []),
    ...(Object.values(snapshot.level.terrain).includes("breakable") ? [[RUNE_EMOJI.breakable, "脆弱石障", "石像撞擊或爆心可以破壞的地形。"]] : []),
  ];
  const currentRating = snapshot.state.status === "won" && optimalSolveReady ? rateSteps(snapshot.state.turn, solveResult.moves) : null;
  const monumentNarrative = monument ? narrativeForChapter(monument.chapter) : null;
  const monumentDialogue = monumentNarrative && monument ? (monument.phase === "opening" ? monumentNarrative.opening.dialogue : monumentNarrative.closing.dialogue) : [];
  const currentDialogue = monumentDialogue[Math.min(dialogueIndex, Math.max(0, monumentDialogue.length - 1))];
  const galleryNarrative = narrativeForChapter(galleryChapter);

  useEffect(() => {
    const shouldDeferLargeBoardSolve = shouldDeferSolver(snapshot.level, snapshot.state.status);
    if (shouldDeferLargeBoardSolve) {
      if (optimalSolveTimerRef.current !== null) window.clearTimeout(optimalSolveTimerRef.current);
      optimalSolveTimerRef.current = null;
      optimalSolverWorkerRef.current?.cancel();
      setOptimalSolveReady(false);
      return;
    }
    const cached = optimalSolveLevelRef.current;
    if (cached?.level === snapshot.level) {
      setSolveResult(cached.result);
      setOptimalSolveReady(true);
      return;
    }
    if (optimalSolveTimerRef.current !== null) window.clearTimeout(optimalSolveTimerRef.current);
    const requestId = ++optimalSolveRequestIdRef.current;
    const level = snapshot.level;
    setOptimalSolveReady(false);
    optimalSolveTimerRef.current = window.setTimeout(() => {
      optimalSolveTimerRef.current = null;
      const worker = optimalSolverWorkerRef.current ?? new SolverWorkerClient();
      optimalSolverWorkerRef.current = worker;
      void worker.solve({ kind: "level", level }).then((result) => {
        if (!result || optimalSolveRequestIdRef.current !== requestId) return;
        optimalSolveLevelRef.current = { level, result };
        setSolveResult(result);
        setOptimalSolveReady(true);
      }).catch((error: unknown) => {
        if (optimalSolveRequestIdRef.current !== requestId) return;
        console.error("主解 Worker 求解失敗", error);
        setOptimalSolveReady(false);
      });
    }, 120);
    return () => {
      if (optimalSolveTimerRef.current !== null) {
        window.clearTimeout(optimalSolveTimerRef.current);
        optimalSolveTimerRef.current = null;
      }
      if (optimalSolveRequestIdRef.current === requestId) {
        optimalSolveRequestIdRef.current += 1;
        optimalSolverWorkerRef.current?.cancel();
      }
    };
  }, [snapshot.level, snapshot.state.status]);

  useEffect(() => {
    if (sameSolveTarget(solutionCacheRef.current, snapshot)) return;
    if (currentSolveResult !== EMPTY_SOLVE_RESULT) setCurrentSolveResult(EMPTY_SOLVE_RESULT);
  }, [currentSolveResult, snapshot]);

  useEffect(() => {
    if (solutionIntent === "none") return;
    const target = solveTargetForSnapshot(snapshot);
    const cached = solutionCacheRef.current;
    if (cached && sameSolveTarget(cached, snapshot)) {
      setCurrentSolveResult(cached.result);
      setSolutionLoading(false);
      setSolutionIntent("none");
      return;
    }
    if (solutionRequestTargetRef.current && sameSolveTarget(solutionRequestTargetRef.current, snapshot)) return;
    if (solutionTimerRef.current !== null) window.clearTimeout(solutionTimerRef.current);
    const requestId = ++solutionRequestIdRef.current;
    const intent = solutionIntent;
    solutionRequestTargetRef.current = target;
    setSolutionLoading(true);
    solutionTimerRef.current = window.setTimeout(() => {
      solutionTimerRef.current = null;
      const worker = currentSolverWorkerRef.current ?? new SolverWorkerClient();
      currentSolverWorkerRef.current = worker;
      void worker.solve({ kind: "state", level: target.level, state: target.state }).then((result) => {
        if (!result || solutionRequestIdRef.current !== requestId) return;
        solutionCacheRef.current = { ...target, result };
        solutionRequestTargetRef.current = null;
        setCurrentSolveResult(result);
        setSolutionLoading(false);
        setSolutionIntent("none");
        if (!result.path[0]) {
          showAssistNotice(intent === "rescue" ? "目前狀態沒有可觀看的完整解答路徑。" : "目前狀態沒有可用的 A* 路徑。");
        } else if (intent === "rescue") {
          setHintConfirmOpen(false);
          setRescueOpen(true);
          showAssistNotice("已開啟完整 A* 解答路徑；這是救援觀看，不會替你自動走子。");
        } else if (intent === "hint") {
          revealHintAfterSolutionRef.current(result);
        }
      }).catch((error: unknown) => {
        if (solutionRequestIdRef.current !== requestId) return;
        solutionRequestTargetRef.current = null;
        setSolutionLoading(false);
        setSolutionIntent("none");
        console.error("提示 Worker 求解失敗", error);
        showAssistNotice("A* 提示暫時無法載入，請稍後再試。");
      });
    }, 0);
    return () => {
      if (solutionTimerRef.current !== null) {
        window.clearTimeout(solutionTimerRef.current);
        solutionTimerRef.current = null;
      }
      if (solutionRequestIdRef.current === requestId) {
        solutionRequestIdRef.current += 1;
        solutionRequestTargetRef.current = null;
        currentSolverWorkerRef.current?.cancel();
      }
    };
  }, [snapshot, solutionIntent]);

  useEffect(() => {
    musicRef.current?.setScene(musicScene);
  }, [musicScene]);

  const showAssistNotice = (message: string, duration = 2200) => {
    if (assistNoticeTimerRef.current !== null) window.clearTimeout(assistNoticeTimerRef.current);
    if (assistNoticeProgressTimerRef.current !== null) window.clearTimeout(assistNoticeProgressTimerRef.current);
    setAssistNotice(message);
    setAssistNoticeProgress(100);
    const startedAt = Date.now();
    const updateProgress = () => {
      const remaining = noticeProgressPercent(Date.now() - startedAt, duration);
      setAssistNoticeProgress(remaining);
      if (remaining > 0) assistNoticeProgressTimerRef.current = window.setTimeout(updateProgress, 80);
      else assistNoticeProgressTimerRef.current = null;
    };
    updateProgress();
    assistNoticeTimerRef.current = window.setTimeout(() => {
      setAssistNotice(null);
      setAssistNoticeProgress(null);
      assistNoticeTimerRef.current = null;
      if (assistNoticeProgressTimerRef.current !== null) window.clearTimeout(assistNoticeProgressTimerRef.current);
      assistNoticeProgressTimerRef.current = null;
    }, duration);
  };

  const revealHintAfterSolution = (result?: SolveResult) => {
    const hint = result?.path[0] ?? nextHint;
    if (!hint) {
      showAssistNotice("目前狀態沒有可用的 A* 路徑。");
      return;
    }
    if (!shouldShowHintConfirmation(hintPanelOpen, hintPanelClosing, hintConfirmationSeen)) return;
    if (hintCharges <= 0) {
      showAssistNotice("本關的 3 次提示已用完；可觀看完整 A* 解答路徑。");
      setRescueOpen(true);
      return;
    }
    if (!hintConfirmationSeen) {
      setHintConfirmationSeen(true);
      window.localStorage.setItem(HINT_CONFIRMATION_SEEN_STORAGE_KEY, "yes");
      setHintConfirmOpen(true);
      return;
    }
    confirmHint(hint);
  };
  revealHintAfterSolutionRef.current = revealHintAfterSolution;

  const revealHint = () => {
    if (solutionLoading || solutionIntent === "hint") {
      showAssistNotice("正在讀取目前狀態的 A* 提示，請稍候。");
      return;
    }
    if (!currentSolutionCached) {
      setSolutionIntent("hint");
      return;
    }
    revealHintAfterSolution(currentSolution);
  };

  const confirmHint = (hintOverride?: Direction) => {
    setHintConfirmOpen(false);
    const hint = hintOverride ?? nextHint;
    if (snapshot.state.status !== "playing" || !hint) return;
    const charge = consumeAssistCharge("hint", hintCharges);
    if (!charge.allowed) return;
    const levelId = snapshot.level.id;
    const nextStats = recordHintUsage(currentHintStats, snapshot.state.turn, HINT_TURN_COST);
    setHintStats((current) => {
      const next = { ...current, [levelId]: nextStats };
      window.localStorage.setItem(hintStatsStorageKey(levelId), JSON.stringify(nextStats));
      return next;
    });
    world.addHintTurn(HINT_TURN_COST);
    setHintCharges(charge.remaining);
    const historyEntry: HintHistoryEntry = {
      id: `${levelId}-${Date.now()}`,
      levelId,
      levelTitle: snapshot.level.title,
      direction: directionText[hint],
      turn: snapshot.state.turn,
      cost: HINT_TURN_COST,
      timestamp: Date.now(),
    };
    setHintHistory((current) => {
      const next = appendHintHistory(current, historyEntry);
      window.localStorage.setItem(HINT_HISTORY_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
    if (hintPanelCloseTimerRef.current !== null) window.clearTimeout(hintPanelCloseTimerRef.current);
    setHintPanelClosing(false);
    setHintDirection(hint);
    setHintPanelOpen(true);
    if (hasDedicatedPathGuide) setPathGuideOpen(true);
    setHintUnlockEffect(true);
    if (hintUnlockTimerRef.current !== null) window.clearTimeout(hintUnlockTimerRef.current);
    hintUnlockTimerRef.current = window.setTimeout(() => {
      setHintUnlockEffect(false);
      hintUnlockTimerRef.current = null;
    }, HINT_UNLOCK_EFFECT_DURATION_MS);
  };
  const closeHintDisplay = () => {
    if (!hintPanelOpen && !hintDirection) return;
    if (hintPanelCloseTimerRef.current !== null) window.clearTimeout(hintPanelCloseTimerRef.current);
    setHintPanelClosing(true);
    hintPanelCloseTimerRef.current = window.setTimeout(() => {
      setHintPanelOpen(false);
      setHintPanelClosing(false);
      setHintDirection(null);
      setPathGuideOpen(false);
      hintPanelCloseTimerRef.current = null;
    }, 180);
  };
  closeHintDisplayRef.current = closeHintDisplay;

  const updateHintPanelPosition = (position: HintPanelPosition) => {
    const next = clampHintPanelPosition(position, window.innerWidth, window.innerHeight);
    hintPanelPositionRef.current = next;
    setHintPanelPosition(next);
    window.localStorage.setItem(HINT_PANEL_POSITION_STORAGE_KEY, JSON.stringify(next));
    return next;
  };

  const handleHintPanelPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const current = hintPanelPositionRef.current ?? { left: rect.left, top: rect.top };
    hintPanelDragRef.current = { pointerId: event.pointerId, offsetX: event.clientX - current.left, offsetY: event.clientY - current.top };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    setHintPanelDragging(true);
  };

  const handleHintPanelPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = hintPanelDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    updateHintPanelPosition({ left: event.clientX - drag.offsetX, top: event.clientY - drag.offsetY });
  };

  const finishHintPanelDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (!hintPanelDragRef.current || hintPanelDragRef.current.pointerId !== event.pointerId) return;
    hintPanelDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setHintPanelDragging(false);
  };

  const handleHintPanelKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (!hintPanelPositionRef.current && !event.key.startsWith("Arrow")) return;
    const current = hintPanelPositionRef.current ?? { left: 24, top: 120 };
    const step = event.shiftKey ? 32 : 16;
    const delta = event.key === "ArrowLeft" ? { left: -step, top: 0 } : event.key === "ArrowRight" ? { left: step, top: 0 } : event.key === "ArrowUp" ? { left: 0, top: -step } : event.key === "ArrowDown" ? { left: 0, top: step } : null;
    if (!delta) return;
    event.preventDefault();
    updateHintPanelPosition({ left: current.left + delta.left, top: current.top + delta.top });
  };

  useEffect(() => {
    const current = hintPanelPositionRef.current;
    if (!current) return;
    const next = clampHintPanelPosition(current, viewport.width, viewport.height);
    if (next.left === current.left && next.top === current.top) return;
    hintPanelPositionRef.current = next;
    setHintPanelPosition(next);
    window.localStorage.setItem(HINT_PANEL_POSITION_STORAGE_KEY, JSON.stringify(next));
  }, [viewport.height, viewport.width]);

  confirmHintRef.current = confirmHint;

  const openRescuePath = () => {
    setHintConfirmOpen(false);
    if (solutionLoading || solutionIntent === "rescue") {
      showAssistNotice("正在讀取目前狀態的完整 A* 路徑，請稍候。");
      return;
    }
    if (!currentSolutionCached) {
      setSolutionIntent("rescue");
      return;
    }
    if (!rescueSolution.solvable || rescueSolution.path.length === 0) {
      showAssistNotice("目前狀態沒有可觀看的完整解答路徑。");
      return;
    }
    setRescueOpen(true);
    showAssistNotice("已開啟完整 A* 解答路徑；這是救援觀看，不會替你自動走子。");
  };

  const replayDeath = () => {
    setHintConfirmOpen(false);
    setRescueOpen(false);
    world.replay("death");
  };

  const toggleReplayPlayback = () => {
    if (!snapshot.replaying) return;
    if (snapshot.replayPaused && snapshot.cursor >= replayTarget) {
      world.seekReplay(0);
      world.resumeReplay();
    } else if (snapshot.replayPaused) world.resumeReplay();
    else world.pauseReplay();
  };

  const seekReplay = (value: number) => world.seekReplay(value);
  const stepReplay = (delta: -1 | 1) => world.stepReplay(delta);

  const undoMove = () => {
    if (snapshot.replaying) return;
    if (snapshot.cursor === 0) {
      showAssistNotice("目前已在本關起點，沒有可悔棋的回合。");
      return;
    }
    const charge = consumeAssistCharge("undo", undoCharges);
    if (!charge.allowed) {
      showAssistNotice("本次挑戰的 5 次悔棋已用完；重新開始本關可補回配額。");
      return;
    }
    world.undo();
    setUndoCharges(charge.remaining);
    showAssistNotice(`已回到上一步。剩餘 ${charge.remaining} 次悔棋。`);
  };

  undoMoveRef.current = undoMove;
  revealHintRef.current = revealHint;

  const advanceMonumentDialogue = () => {
    if (dialogueIndex < monumentDialogue.length - 1) setDialogueIndex((current) => current + 1);
    else { setMonument(null); setDialogueIndex(0); }
  };

  const completeTutorial = () => {
    window.localStorage.setItem("echoes-tutorial-complete", "yes");
    setTutorialActive(false);
  };

  const updateFeedbackPreference = (key: "sound" | "haptics") => {
    setFeedbackPreferences((current) => {
      const next = { ...current, [key]: !current[key] };
      window.localStorage.setItem("echoes-feedback-preferences", JSON.stringify(next));
      return next;
    });
  };
  const setMasterVolume = (volume: number) => {
    const masterVolume = Math.min(1, Math.max(0, volume));
    setFeedbackPreferences((current) => {
      const next = { ...current, masterVolume };
      window.localStorage.setItem("echoes-feedback-preferences", JSON.stringify(next));
      return next;
    });
  };
  const setFeedbackGroupVolume = (group: FeedbackGroup, volume: number) => {
    const groupVolume = Math.min(1, Math.max(0, volume));
    setFeedbackPreferences((current) => {
      const next = { ...current, groupVolumes: { ...current.groupVolumes, [group]: groupVolume } };
      window.localStorage.setItem("echoes-feedback-preferences", JSON.stringify(next));
      return next;
    });
  };
  const toggleMute = () => {
    const nextMuted = !feedbackPreferences.muted;
    setFeedbackPreferences((current) => {
      const next = { ...current, muted: nextMuted };
      window.localStorage.setItem("echoes-feedback-preferences", JSON.stringify(next));
      return next;
    });
    showAssistNotice(nextMuted ? "全域靜音已開啟。按 M 或設定中的按鈕可恢復音效。" : "全域靜音已關閉，事件音效恢復播放。");
  };
  const setMusicVolume = (volume: number) => {
    const musicVolume = clampMusicVolume(volume);
    setFeedbackPreferences((current) => {
      const next = { ...current, musicVolume };
      window.localStorage.setItem("echoes-feedback-preferences", JSON.stringify(next));
      return next;
    });
  };
  const setDisplayQualityMode = (mode: DisplayQualityMode) => {
    const displayQualityMode = normalizeDisplayQualityMode(mode);
    setFeedbackPreferences((current) => {
      const next = { ...current, displayQualityMode };
      window.localStorage.setItem("echoes-feedback-preferences", JSON.stringify(next));
      return next;
    });
    showAssistNotice(displayQualityMode === "performance" ? "高效能模式已啟用：降低大型地圖解析度與節奏動畫負載。" : "高畫質模式已啟用：恢復完整環境節奏與事件特效。");
  };
  const setMusicAnimationMode = (mode: MusicAnimationMode) => {
    const musicAnimationMode = normalizeMusicAnimationMode(mode);
    setFeedbackPreferences((current) => {
      const next = { ...current, musicAnimationMode };
      window.localStorage.setItem("echoes-feedback-preferences", JSON.stringify(next));
      return next;
    });
    musicRef.current?.setAnimationMode(musicAnimationMode);
  };
  const clearHintStats = (scope: "level" | "all") => {
    if (scope === "level") {
      const levelId = snapshot.level.id;
      setHintStats((current) => {
        window.localStorage.removeItem(hintStatsStorageKey(levelId));
        return clearHintUsageStats(current, levelId, "level");
      });
      setStatsConfirm(null);
      showAssistNotice(`已清除 ${snapshot.level.title} 的提示統計。`);
      return;
    }
    PLAYABLE_LEVELS.forEach((level) => window.localStorage.removeItem(hintStatsStorageKey(level.id)));
    setHintStats((current) => clearHintUsageStats(current, snapshot.level.id, "all"));
    setStatsConfirm(null);
    showAssistNotice("已清除全戰役提示統計；各關提示配額不受影響。");
  };
  toggleMuteRef.current = toggleMute;
  const previewFeedbackSound = (type: SoundFeedback, label: string) => {
    if (!feedbackPreferences.sound || feedbackPreferences.muted) {
      showAssistNotice("事件音效目前已靜音；先解除靜音再試聽。");
      return;
    }
    playFeedbackSound(type, effectiveFeedbackVolume(type, feedbackPreferences));
    showAssistNotice(`試聽：${label}`);
  };
  const setHandedness = (handedness: FeedbackPreferences["handedness"]) => {
    setFeedbackPreferences((current) => {
      const next = { ...current, handedness };
      window.localStorage.setItem("echoes-feedback-preferences", JSON.stringify(next));
      return next;
    });
  };

  const resetRound = () => {
    world.reset();
    const charges = resetAssistCharges();
    setUndoCharges(charges.undo);
    setHintCharges(charges.hint);
    setHintConfirmOpen(false);
    closeHintDisplay();
    showAssistNotice("本關已重新開始，悔棋與提示配額已補回。", RESTART_NOTICE_DURATION_MS);
    setRescueOpen(false);
    setElapsedSeconds(0);
    setStartedAt(Date.now());
  };

  resetRoundRef.current = resetRound;

  const stopAIDemo = () => {
    if (aiDemoTimerRef.current !== null) {
      window.clearTimeout(aiDemoTimerRef.current);
      window.clearInterval(aiDemoTimerRef.current);
      aiDemoTimerRef.current = null;
    }
    setAiDemoMode(false);
    aiDemoModeRef.current = false;
  };

  const runAIDemoForLevel = (targetIndex: number) => {
    if (aiDemoTimerRef.current !== null) {
      window.clearTimeout(aiDemoTimerRef.current);
      window.clearInterval(aiDemoTimerRef.current);
      aiDemoTimerRef.current = null;
    }
    const safeIndex = Math.max(0, Math.min(PLAYABLE_LEVELS.length - 1, targetIndex));
    const targetLevel = PLAYABLE_LEVELS[safeIndex] ?? snapshot.level;
    const path = computeAIDemoPath(targetLevel);
    if (path.length === 0) {
      showAssistNotice("本關沒有可用的 A* 解路徑，無法啟動電腦AI展示。");
      setAiDemoMode(false);
      aiDemoModeRef.current = false;
      return;
    }
    // 若剛進入新章節首關，顯示 chapter opening 碑文；否則清掉上一關殘留的碑文，避免阻擋操作
    if (safeIndex % 10 === 0 && safeIndex > 0) { setDialogueIndex(0); setMonument({ chapter: chapterForLevel(safeIndex), phase: "opening" }); }
    else setMonument(null);
    // 關鍵修正：先真正載入目標關卡（並重置），再同步 levelIndex，
    // 讓快速跳轉展示與自動連續破關都在「正確的關卡」上播放正確的解路徑。
    world.setLevel(targetLevel);
    setLevelIndex(safeIndex);
    world.reset();
    const charges = resetAssistCharges();
    setUndoCharges(charges.undo);
    setHintCharges(charges.hint);
    setAiDemoPath(path);
    setAiDemoIndex(0);
    setAiDemoMode(true);
    aiDemoModeRef.current = true;
    showAssistNotice(`🤖 電腦AI展示已啟動（第 ${targetIndex + 1} 關「${targetLevel.title}」·作業研究A*與結果論集成，勝率 100%），共 ${path.length} 步。`, 2500);

    let idx = 0;
    const stepFn = () => {
      if (!aiDemoModeRef.current) return;
      if (world.current.status !== "playing") {
        if (aiDemoTimerRef.current !== null) {
          window.clearTimeout(aiDemoTimerRef.current);
          aiDemoTimerRef.current = null;
        }
        if (world.current.status === "won") {
          showAssistNotice(`🎉 電腦AI完成展示：第 ${targetIndex + 1} 關已全破！`, 2000);
          if (aiAutoNextRef.current && targetIndex < PLAYABLE_LEVELS.length - 1) {
            showAssistNotice(`🎉 第 ${targetIndex + 1} 關全破！即將自動進入第 ${targetIndex + 2} 關展示...`, 1500);
            window.setTimeout(() => {
              if (!aiDemoModeRef.current) return;
              goToLevel(targetIndex + 1);
            }, 800);
          } else {
            setAiDemoMode(false);
            aiDemoModeRef.current = false;
            if (targetIndex >= PLAYABLE_LEVELS.length - 1) {
              showAssistNotice("🏆 恭喜！電腦AI展示已全通 50 關，達成全破關率 100%！", 6000);
            }
          }
        } else {
          setAiDemoMode(false);
          aiDemoModeRef.current = false;
          showAssistNotice("電腦AI展示已結束。", 2000);
        }
        return;
      }

      if (idx >= path.length) {
        if (aiDemoTimerRef.current !== null) {
          window.clearTimeout(aiDemoTimerRef.current);
          aiDemoTimerRef.current = null;
        }
        if (world.current.status === "won") {
          showAssistNotice(`🎉 電腦AI完成展示：第 ${targetIndex + 1} 關已全破！`, 2000);
          if (aiAutoNextRef.current && targetIndex < PLAYABLE_LEVELS.length - 1) {
            showAssistNotice(`🎉 第 ${targetIndex + 1} 關全破！即將自動進入第 ${targetIndex + 2} 關展示...`, 1500);
            window.setTimeout(() => {
              if (!aiDemoModeRef.current) return;
              goToLevel(targetIndex + 1);
            }, 800);
          } else {
            setAiDemoMode(false);
            aiDemoModeRef.current = false;
          }
        } else {
          setAiDemoMode(false);
          aiDemoModeRef.current = false;
        }
        return;
      }

      world.move(path[idx]);
      idx += 1;
      setAiDemoIndex(idx);
      aiDemoTimerRef.current = window.setTimeout(stepFn, aiSpeedRef.current);
    };

    aiDemoTimerRef.current = window.setTimeout(stepFn, aiSpeedRef.current);
  };

  const startAIDemo = () => {
    runAIDemoForLevel(levelIndex);
  };

  useEffect(() => {
    if (aiDemoModeRef.current) {
      const timer = window.setTimeout(() => {
        if (aiDemoModeRef.current) {
          runAIDemoForLevel(levelIndex);
        }
      }, 100);
      return () => window.clearTimeout(timer);
    }
  }, [levelIndex]);

  useEffect(() => {
    return () => {
      if (aiDemoTimerRef.current !== null) {
        window.clearTimeout(aiDemoTimerRef.current);
        window.clearInterval(aiDemoTimerRef.current);
      }
    };
  }, []);

  const retryFromCheckpoint = () => {
    world.retryFromCheckpoint();
    const charges = resetAssistCharges();
    setUndoCharges(charges.undo);
    setHintCharges(charges.hint);
    setHintConfirmOpen(false);
    closeHintDisplay();
    showAssistNotice("已從最近 checkpoint 重試，輔助配額已補回。", RESTART_NOTICE_DURATION_MS);
    setRescueOpen(false);
    setStartedAt(Date.now());
  };

  const goToLevel = (index: number, bypassModulo = false) => {
    const nextIndex = bypassModulo ? index : index % PLAYABLE_LEVELS.length;
    // Show the chapter-opening monument when entering a chapter-boundary level;
    // otherwise clear any stale monument so it can't block the resolution card.
    const level = PLAYABLE_LEVELS[nextIndex];
    world.setLevel(level);
    setLevelIndex(nextIndex);
    setSolveResult(EMPTY_SOLVE_RESULT);
    setCurrentSolveResult(EMPTY_SOLVE_RESULT);
    setOptimalSolveReady(false);
    setSolutionIntent("none");
    solutionCacheRef.current = null;
    setElapsedSeconds(0);
    setStartedAt(Date.now());
    const charges = resetAssistCharges();
    setUndoCharges(charges.undo);
    setHintCharges(charges.hint);
    setAssistNotice(null);
    setHintConfirmOpen(false);
    closeHintDisplay();
    setRescueOpen(false);
    setTutorialActive(false);
    setCampaignFinished(false);
    setLeftRailOpen(false);
    setRightRailOpen(false);
    setDrawer("none");
    if (nextIndex % 10 === 0) { setDialogueIndex(0); setMonument({ chapter: chapterForLevel(nextIndex), phase: "opening" }); }
  };

  const goToNextLevel = () => {
    if (levelIndex >= PLAYABLE_LEVELS.length - 1) {
      setCampaignFinished(true);
      return;
    }
    // Bypass the modulo wrapping in goToLevel so "Go to Next Level" advances to the
    // next campaign level directly (index maps straight to the array, LV12 -> LV13).
    // Using bypassModulo=true ensures no wrapping occurs, which is important for
    // level transitions especially when levelIndex might be at boundary values.
    const nextIndex = levelIndex + 1;
    const level = PLAYABLE_LEVELS[nextIndex];
    world.setLevel(level);
    setLevelIndex(nextIndex);
    setSolveResult(EMPTY_SOLVE_RESULT);
    setCurrentSolveResult(EMPTY_SOLVE_RESULT);
    setOptimalSolveReady(false);
    setSolutionIntent("none");
    solutionCacheRef.current = null;
    setElapsedSeconds(0);
    setStartedAt(Date.now());
    const charges = resetAssistCharges();
    setUndoCharges(charges.undo);
    setHintCharges(charges.hint);
    setAssistNotice(null);
    setHintConfirmOpen(false);
    closeHintDisplay();
    setRescueOpen(false);
    setTutorialActive(false);
    setCampaignFinished(false);
    setLeftRailOpen(false);
    setRightRailOpen(false);
    setDrawer("none");
    if (nextIndex % 10 === 0) { setDialogueIndex(0); setMonument({ chapter: chapterForLevel(nextIndex), phase: "opening" }); }
  };

  const loadEditor = () => {
    world.setLevel(editorLevel);
    setSolveResult(EMPTY_SOLVE_RESULT);
    setCurrentSolveResult(EMPTY_SOLVE_RESULT);
    setOptimalSolveReady(false);
    setSolutionIntent("none");
    solutionCacheRef.current = null;
    setLevelIndex(-1);
    setElapsedSeconds(0);
    setStartedAt(Date.now());
    const charges = resetAssistCharges();
    setUndoCharges(charges.undo);
    setHintCharges(charges.hint);
    setAssistNotice(null);
    setHintConfirmOpen(false);
    closeHintDisplay();
    setRescueOpen(false);
    setDrawer("none");
  };

  const regenerateEditor = (size: number) => {
    setEditorSize(size);
    const fresh = makeRandomEditor(size);
    setEditorLevel(fresh);
    setEditorResult(solveLevel(fresh));
  };

  const validateEditor = () => {
    setEditorResult(solveLevel(editorLevel));
  };

  const filteredRuneLegend = RUNE_LEGEND.filter(([, title, description]) => {
    const query = runeQuery.trim().toLocaleLowerCase();
    const matchesQuery = !query || `${title} ${description}`.toLocaleLowerCase().includes(query);
    const matchesCategory = runeCategory === "全部" || RUNE_CATEGORY[title] === runeCategory;
    return matchesQuery && matchesCategory;
  });
  const setRuneDisplayStyle = (style: RuneDisplayStyle) => {
    setRuneStyle(style);
    window.localStorage.setItem("echoes-rune-style", style);
  };
  const setLargeBoardZoom = (value: number) => {
    const next = clampBoardZoom(value);
    setBoardZoom(next);
    window.localStorage.setItem("echoes-board-zoom", String(next));
  };
  const setLargeBoardEmojiScale = (value: number) => {
    const next = clampEmojiScale(value);
    setEmojiScale(next);
    window.localStorage.setItem("echoes-emoji-scale", String(next));
  };

  return (
    <main className={`game-shell ${feedback === "impact" || feedback === "enemy" ? "impact-shake" : ""} ${feedback === "mine" || feedback === "flame" || feedback === "rock" || feedback === "rockBlock" || feedback === "trap" ? "feedback-shake" : ""} ${usesEdgeRails ? "large-board" : ""} ${viewport.width > viewport.height ? "landscape-viewport" : "portrait-viewport"}`}>
      <GameCanvas world={world} runeStyle={runeStyle} boardZoom={boardZoom} emojiScale={emojiScale} qualityMode={feedbackPreferences.displayQualityMode} musicSpectrum={renderedMusicSpectrum} hintFocus={hintPanelOpen || rescueOpen || pathGuideOpen} />
      <div className="stone-noise" aria-hidden="true" />
      {stageInterlude && <section className="stage-interlude" role="dialog" aria-modal="true" aria-label="階段完成碑文"><p className="eyebrow">INTERLUDE · CHECKPOINT {snapshot.state.checkpointIndex + 1}</p><h2>階段已封存</h2><p>{stageInterlude}</p><button className="primary-action" onClick={() => setStageInterlude(null)}>繼續深入</button></section>}
      <div className={`feedback-flash ${feedback}`} aria-live="assertive">
        {feedback === "impact" && <><span>石像撞擊</span><strong>脆障已崩裂</strong></>}
        {feedback === "enemy" && <><span>巡弋警報</span><strong>石像正在封鎖路線</strong></>}
        {feedback === "trap" && <><span>陷阱結算</span><strong>尖刺已刺出</strong></>}
        {feedback === "mine" && <><span>爆心結算</span><strong>地雷已自毀</strong></>}
        {feedback === "flame" && <><span>火線結算</span><strong>噴口掃過格線</strong></>}
        {feedback === "rockBlock" && <><span>落石攔截</span><strong>木箱吸收了撞擊</strong></>}
        {feedback === "door" && <><span>重量機關</span><strong>石門轉向開啟</strong></>}
        {feedback === "stage" && <><span>STAGE SEALED</span><strong>階段碑文已解鎖</strong></>}
      </div>
      {hintUnlockEffect && <div className="hint-unlock-effect" role="status" aria-live="polite"><span className="hint-unlock-spark" aria-hidden="true">✦</span><strong>提示已解鎖</strong><small>下一步路徑已顯示</small></div>}
      {hintPanelOpen && hintDirection && (
        <section
          className={`hint-result-panel ${hintPanelDragging ? "is-dragging" : ""} ${hintPanelClosing ? "is-closing" : ""}`}
          role="region"
          aria-live={hintRevealCharacters >= `下一步：${directionText[hintDirection]}`.length ? "polite" : "off"}
          aria-atomic="true"
          aria-label="燈泡提示結果，可拖曳移動"
          tabIndex={0}
          aria-describedby="hint-result-instructions"
          style={hintPanelPosition ? { left: `${hintPanelPosition.left}px`, top: `${hintPanelPosition.top}px`, transform: "none" } : undefined}
          onPointerDown={handleHintPanelPointerDown}
          onPointerMove={handleHintPanelPointerMove}
          onPointerUp={finishHintPanelDrag}
          onPointerCancel={finishHintPanelDrag}
          onKeyDown={handleHintPanelKeyDown}
        >
          <div className="hint-result-copy"><span className="eyebrow"><Lightbulb size={12} /> LIGHTBULB HINT</span><strong className={`hint-typed-text ${hintRevealCharacters >= `下一步：${directionText[hintDirection]}`.length ? "is-complete" : ""}`} aria-label={`下一步：${directionText[hintDirection]}`}>{revealHintText(`下一步：${directionText[hintDirection]}`, hintRevealCharacters) || "\u00a0"}</strong><small className="hint-focus-copy">{HINT_FOCUS_COPY}</small><small id="hint-result-instructions">可拖曳此面板避開棋盤資訊；完成判讀後按右上角 X 關閉。</small></div>
          <button type="button" className="hint-result-close" onClick={closeHintDisplay} aria-label={HINT_RESULT_CLOSE_LABEL}><X size={15} /></button>
        </section>
      )}
      {assistNotice && <div className="assist-notice" role="status" aria-live="polite"><span>{assistNotice}</span><span className="assist-notice-progress" role="progressbar" aria-label="通知剩餘時間" aria-valuemin={0} aria-valuemax={100} aria-valuenow={assistNoticeProgress ?? 0}><i style={{ width: `${assistNoticeProgress ?? 0}%` }} /></span></div>}
      {hintConfirmOpen && snapshot.state.status === "playing" && (
        <>
          <div className="hint-confirm-scrim" aria-hidden="true" />
          <section className="hint-confirm" role="dialog" aria-modal="true" aria-labelledby="hint-confirm-title" aria-describedby="hint-confirm-description">
            <p className="eyebrow">LIGHTBULB COST · +{HINT_TURN_COST} TURN</p>
            <h2 id="hint-confirm-title">{HINT_CONFIRMATION_TEXT}</h2>
            <p id="hint-confirm-description">確認後會消耗本關 1 次燈泡提示，並把成本寫入本關提示紀錄；不會自動替你移動。</p>
            <div className="hint-confirm-actions"><button className="quiet-action" type="button" onClick={() => setHintConfirmOpen(false)}>否?</button><button ref={hintConfirmButtonRef} className="primary-action" type="button" onClick={() => confirmHint()}>是?</button></div>
          </section>
        </>
      )}
      {musicTransition.phase !== "idle" && <MusicTransitionIndicator state={musicTransition} volume={feedbackPreferences.musicVolume} spectrum={musicSpectrum} compact />}
      {rescueOpen && (
        <section className="rescue-path-panel" role="dialog" aria-modal="false" aria-label="完整 A* 解答路徑">
          <div className="rescue-path-head"><div><p className="eyebrow">RESCUE VIEW · A*</p><strong>完整解答路徑</strong><small>救援觀看模式：只展示路徑，不會自動替你走子。{HINT_FOCUS_COPY}</small></div><button onClick={() => setRescueOpen(false)} aria-label="關閉完整解答路徑"><X size={15} /></button></div>
          <div className="rescue-path-sequence">{rescueSolution.path.map((move, index) => { const Icon = directionIcons[move]; return <span key={`${move}-${index}`} title={`第 ${index + 1} 步：${directionText[move]}`}><small>{index + 1}</small><Icon size={13} /></span>; })}</div>
        </section>
      )}
      {snapshot.replaying && (
        <section className={`replay-overlay ${snapshot.replayMode}`} role="dialog" aria-live="polite" aria-label={snapshot.replayMode === "death" ? "死亡逐格回放" : "路徑逐格回放"}>
          <div className="replay-overlay-head"><div><span className="eyebrow">{snapshot.replayMode === "death" ? "DEATH REPLAY" : "TURN REPLAY"}</span><strong>{snapshot.replayMode === "death" ? "死亡逐格回放" : "路徑逐格回放"}</strong></div><small>第 {snapshot.cursor} / {replayTarget} 回合 · {eventLine}</small><small className="replay-track-info">♫ {replayTrack.name} · 脈動強度 {Math.round(rhythmProfile.intensity * 100)}%</small></div>
          <div className="replay-progress" aria-hidden="true"><span style={{ width: `${replayPercent}%` }} /></div>
          <label className="replay-scrubber"><span>時間軸</span><input type="range" min="0" max={replayTarget} step="1" value={Math.min(snapshot.cursor, replayTarget)} onChange={(event) => seekReplay(Number(event.target.value))} aria-label="拖曳回放時間軸" /><output>{replayPercent}%</output></label>
          <div className="replay-controls"><button type="button" onClick={() => stepReplay(-1)} disabled={snapshot.cursor <= 0} aria-label="回放上一格"><ArrowLeft size={14} />上一格</button><button type="button" onClick={toggleReplayPlayback} aria-label={snapshot.replayPaused ? "重新或繼續回放" : "暫停回放"}>{snapshot.replayPaused ? <Play size={14} /> : <span className="pause-glyph">Ⅱ</span>}{snapshot.replayPaused && snapshot.cursor >= replayTarget ? "重播" : snapshot.replayPaused ? "繼續" : "暫停"}</button><button type="button" onClick={() => stepReplay(1)} disabled={snapshot.cursor >= replayTarget} aria-label="回放下一格">下一格<ArrowRight size={14} /></button><label className="replay-speed">速度<select value={snapshot.replaySpeed} onChange={(event) => world.setReplaySpeed(Number(event.target.value))} aria-label="回放速度"><option value="0.5">0.5×</option><option value="1">1×</option><option value="1.5">1.5×</option><option value="2">2×</option></select></label><button type="button" className="replay-close" onClick={() => world.finishReplay()}>結束回放</button></div>
        </section>
      )}
      <div className="board-frame" aria-hidden="true">
        <div className="frame-top"><span>V-03</span><i /><span>GRID / {snapshot.level.columns}×{snapshot.level.rows}</span><i /><span>SECTOR 18</span></div>
        <div className="frame-left">A · B · C · D · E · F · G · H · I · J</div>
        <div className="frame-right">01<br />02<br />03<br />04<br />05<br />06<br />07<br />08<br />09<br />10</div>
        <div className="frame-bottom"><span>石版索引</span><i /><span>每一步重新結算</span></div>
      </div>

      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-seal-frame"><img className="brand-seal" src={LOGO_URL} alt="Echoes of the Grid 封印" onError={(event) => { event.currentTarget.style.visibility = "hidden"; }} /><span aria-hidden="true" /></div>
          <div>
            <p className="eyebrow">ARCHIVE · 0487</p>
            <h1>Echoes <span>of the Grid</span></h1>
          </div>
        </div>
        <div className="topbar-reading">
          <span>LV. {String(levelIndex + 1).padStart(2, "0")}</span>
          <span className="topbar-divider" />
          <span>CH. {String(currentChapter).padStart(2, "0")}</span>
          <span className="topbar-divider" />
          <span>{formatElapsed(elapsedSeconds)}</span>
          <span className="topbar-divider" />
          <span>TURN {String(snapshot.state.turn).padStart(2, "0")}</span>
        </div>
        <div className="topbar-actions">
          <button
            type="button"
            className="topbar-level-button"
            onClick={aiDemoMode ? stopAIDemo : startAIDemo}
            style={{
              background: aiDemoMode ? "rgba(239,68,68,0.25)" : "linear-gradient(135deg, rgba(16,185,129,0.35), rgba(5,150,105,0.45))",
              border: `1px solid ${aiDemoMode ? "#ef4444" : "#10b981"}`,
              color: aiDemoMode ? "#fca5a5" : "#86efac",
              fontWeight: 700,
            }}
            title="電腦AI展示模式（作業研究A*與結果論集成，100%全破關率）"
          >
            {aiDemoMode ? `🤖 停止AI (${aiDemoIndex}/${aiDemoPath.length})` : "🤖 電腦AI展示 (100%全破)"}
          </button>
          <button className="topbar-level-button" onClick={() => setDrawer("campaign")} aria-label="開啟跳關與關卡選擇"><span className="desktop-jump-label">跳關／選擇關卡</span><span className="mobile-jump-label">跳關</span></button>
          <button className="icon-button shortcut-button" onClick={() => setShortcutOpen((open) => !open)} aria-label="顯示鍵盤快捷鍵"><Keyboard size={17} /></button>
          <button className="icon-button" onClick={() => { setGalleryChapter(currentChapter); setDrawer("gallery"); }} aria-label="開啟碑文畫廊"><Sparkles size={17} /></button>
          <button className="icon-button hint-button" onClick={() => setHintOpen((open) => !open)} aria-label="顯示操作提示"><BookOpen size={18} /></button>
        </div>
      </header>

      {shortcutOpen && (
        <section className="shortcut-popover" aria-label="鍵盤快捷鍵提示">
          <button onClick={() => setShortcutOpen(false)} aria-label="關閉鍵盤快捷鍵"><X size={16} /></button>
          <p className="eyebrow">KEYBOARD SHORTCUTS</p>
          <strong>用鍵盤讀取每一道刻痕</strong>
          <div className="shortcut-list"><span><kbd>↑ ↓ ← →</kbd><b>移動角色</b></span><span><kbd>W A S D</kbd><b>移動角色</b></span>        <span><kbd>Z</kbd><b>回到上一步（每關 5 次）</b></span><span><kbd>H</kbd><b>燈泡提示（每次 +10 TURN）</b></span><span><kbd>R</kbd><b>重新開始</b></span><span><kbd>P</kbd><b>重播目前路徑</b></span><span><kbd>M</kbd><b>全域靜音／恢復音效</b></span></div>
        </section>
      )}

      {hintOpen && (
        <section className="hint-popover">
          <button onClick={() => setHintOpen(false)} aria-label="關閉操作提示"><X size={16} /></button>
          <p className="eyebrow">FIELD NOTES</p>
          <strong>每走一格，地圖即完成一次同步結算。</strong>
          <span>方向鍵 / WASD 移動；Z 撤銷；燈泡提示會增加 10 TURN；耗盡後可觀看完整解答。</span>
          <button className="replay-tutorial" onClick={() => { window.localStorage.setItem("echoes-tutorial-choice", "play"); world.reset(); setTutorialChoiceOpen(false); setTutorialActive(true); setHintOpen(false); }}>重新啟動新手教學</button>
          <button className="replay-tutorial" onClick={() => { setAdvancedLesson(0); setDrawer("advanced"); setHintOpen(false); }}>重播進階機關教學</button>
        </section>
      )}

      {tutorialChoiceOpen && !monument && (
        <section className="tutorial-choice-card" role="dialog" aria-modal="true" aria-labelledby="tutorial-choice-title">
          <p className="eyebrow">FIRST ENTRY · GUIDE</p>
          <h2 id="tutorial-choice-title">要先閱讀遊戲教學嗎？</h2>
          <p>教學會用五個短步驟帶你理解移動、回合結算、推箱、提示與撤銷。你也可以先跳過，之後從右上角的「跳關／選擇關卡」或操作提示中重新啟動。</p>
          <div className="tutorial-choice-actions">
            <button className="primary-action" onClick={() => { window.localStorage.setItem("echoes-tutorial-choice", "play"); setTutorialChoiceOpen(false); setTutorialActive(true); }}>是，開始教學</button>
            <button className="quiet-action" onClick={() => { window.localStorage.setItem("echoes-tutorial-choice", "skip"); setTutorialChoiceOpen(false); setTutorialActive(false); }}>否，直接開始</button>
          </div>
        </section>
      )}

      {tutorialActive && !tutorialChoiceOpen && !monument && (
        <section className="tutorial-card" aria-live="polite">
          <div className="tutorial-step"><span>GUIDE {String(tutorialStep.id).padStart(2, "0")}</span><i /><span>05</span></div>
          <p className="eyebrow">STONEKEEPER'S NOTE</p>
          <h2>{snapshot.state.status === "lost" ? "這筆刻痕可以重寫" : tutorialStep.title}</h2>
          <p>{snapshot.state.status === "lost" ? "這裡不需要反應速度。按重置回到本章起點，再讀一次敵人與機關的節拍。" : tutorialStep.instruction}</p>
          <small>{snapshot.state.status === "lost" ? "撤銷與重置是推理工具，不是失敗懲罰。" : tutorialStep.observation}</small>
          <div className="tutorial-actions">
            {tutorialStep.id === 5 && snapshot.state.status === "won" ? (
              <button className="primary-action" onClick={completeTutorial}><Check size={15} />封存基礎訓練</button>
            ) : (
              <button className="quiet-action" onClick={revealHint} disabled={solutionLoading}><Lightbulb size={15} />{solutionLoading ? "讀取提示中" : nextHint ? `標示 ${directionText[nextHint]}` : "讀取下一步"}</button>
            )}
            <button className="tutorial-dismiss" onClick={() => setTutorialActive(false)}>暫時收起</button>
          </div>
        </section>
      )}

      {monument && monumentNarrative && (
        <section className={`monument-card ${monumentNarrative.tone} ${monument.phase === "closing" ? `ending-${monument.endingTier ?? 1}` : ""}`} aria-live="polite">
          <p className="eyebrow">CHAPTER {String(monument.chapter).padStart(2, "0")} · {monumentNarrative.code}</p>
          <PixelChapterArt chapter={monument.chapter} ending={monument.phase === "closing"} endingTier={monument.endingTier} />
          <span className="monument-seal" aria-hidden="true">◇</span>
          <h2>{campaignFinished ? "恭喜完成所有關卡！" : monument.phase === "opening" ? monumentNarrative.opening.heading : endingForChapter(monument.chapter, monument.endingTier ?? 1).title}</h2>
          <blockquote>{campaignFinished ? "五十道因果皆已封存。你沒有被石室帶回起點；最後的回聲，現在屬於你。" : monument.phase === "opening" ? monumentNarrative.opening.inscription : endingForChapter(monument.chapter, monument.endingTier ?? 1).inscription}</blockquote>
          <p>{campaignFinished ? "終局卷宗已完成，結局動畫正在播放。你可以留在此處回顧戰役，或從戰役地圖重玩已完成關卡。" : monument.phase === "opening" ? monumentNarrative.opening.keeper : endingForChapter(monument.chapter, monument.endingTier ?? 1).keeper}</p>
          {currentDialogue && <button className="monument-dialogue" onClick={advanceMonumentDialogue} aria-label="推進碑文對話"><span>{currentDialogue.speaker}</span><strong>{currentDialogue.text}</strong><small>{dialogueIndex + 1} / {monumentDialogue.length} · 點擊繼續</small></button>}
          <button className="primary-action" onClick={advanceMonumentDialogue}>{campaignFinished ? "觀看結局" : dialogueIndex < monumentDialogue.length - 1 ? "下一句" : monument.phase === "opening" ? "展開卷宗" : "收下碑文"}</button>
        </section>
      )}

      {usesEdgeRails && <button className={`edge-tab edge-tab-left ${leftRailOpen ? "is-open" : ""}`} onClick={() => setLeftRailOpen((open) => !open)} aria-label="開啟或收納卷宗"><BookOpen size={16} /><span className="desktop-tab-label">檔案</span><span className="mobile-tab-label">卷宗</span></button>}
      <aside className={`archive-rail ${leftRailOpen ? "panel-open" : ""}`}>
        {usesEdgeRails && <button className="rail-collapse" onClick={() => setLeftRailOpen(false)} aria-label="收納目前檔案"><X size={15} /></button>}
        <p className="rail-kicker">CURRENT FILE</p>
        <h2>{snapshot.level.title}</h2>
        <p className="rail-subtitle">{snapshot.level.subtitle}</p>
        <div className="objective-block">
          <span className="rule-number">01</span>
          <p>{snapshot.level.objective}</p>
        </div>
        <div className="mechanic-list">
          {activeMechanics.map(([glyph, title, body]) => (
            <div className="mechanic-entry" key={title}>
              <span className="mechanic-glyph">{glyph}</span>
              <div><strong>{title}</strong><small>{body}</small></div>
            </div>
          ))}
        </div>
        <button className="outline-action" onClick={() => setDrawer("reference")}>
          <Sparkles size={15} /> 看見所有符文
        </button>
      </aside>

      {usesEdgeRails && <button className={`edge-tab edge-tab-right ${rightRailOpen ? "is-open" : ""}`} onClick={() => setRightRailOpen((open) => !open)} aria-label="開啟或收納回合刻痕"><FastForward size={16} /><span>回合</span></button>}
      <aside className={`turn-rail ${rightRailOpen ? "panel-open" : ""}`}>
        {usesEdgeRails && <button className="rail-collapse" onClick={() => setRightRailOpen(false)} aria-label="收納回合刻痕"><X size={15} /></button>}
        <div className="turn-head"><span>回合刻痕</span><span>{snapshot.cursor}/{Math.max(0, snapshot.historyLength - 1)}</span></div>
        <div className="turn-line">
          {Array.from({ length: Math.max(7, Math.min(14, snapshot.historyLength)) }, (_, index) => (
            <span className={index <= snapshot.cursor ? "turn-notch active" : "turn-notch"} key={index}>{index === 0 ? "◎" : "┼"}</span>
          ))}
        </div>
        <p className="turn-event">{eventLine}</p>
        <div className="score-pair">
          <span>BEST</span><strong>{scoreText}</strong>
        </div>
        <div className="solver-note">
          <span>搜索器</span>
          <strong>{solveResult.solvable ? `${solveResult.moves} 步主解` : "驗證中"}</strong>
          <small>{solveResult.explored.toLocaleString()} 狀態</small>
        </div>
        <div className="assist-budget" aria-label={`悔棋剩餘 ${undoCharges} 次，提示剩餘 ${hintCharges} 次`}><span>悔棋 <b>{undoCharges}/{MAX_UNDO_CHARGES}</b></span><span>提示 <b>{hintCharges}/{MAX_HINT_CHARGES}</b></span></div>
        <div className="hint-stats-rail" aria-label="本關提示使用統計"><span>提示紀錄</span><strong>{currentHintStats.uses} 次 · +{currentHintStats.totalCost} TURN</strong><small>{currentHintStats.uses > 0 ? `平均 ${currentHintAverageCost} TURN／次` : "本關尚未使用提示"}</small></div>
        <button className={`hint-action ${hintCharges > 0 && nextHint ? "hint-action-ready" : ""}`} onClick={hintCharges > 0 ? revealHint : openRescuePath} disabled={!isHintButtonInteractive(snapshot.state.status)} aria-label={hintCharges > 0 ? "開啟燈泡提示" : "觀看完整解答路徑"}>
          {hintCharges > 0 ? <><Lightbulb size={16} /><span className="hint-action-label">{HINT_BUTTON_LABEL}</span><small className="hint-action-meta">+{HINT_TURN_COST} TURN · 剩餘 {hintCharges}</small></> : <><WandSparkles size={16} /><span className="hint-action-label">觀看完整解答路徑</span></>}
        </button>
        <button className="rail-action" onClick={() => { setAdvancedLesson(0); setDrawer("advanced"); }}><GraduationCap size={16} /> 進階機關教學</button>
        <button className="rail-action" onClick={() => setHintHistoryOpen(true)}><BookOpen size={16} /> 歷史提示 <span className="rail-action-count">{hintHistory.length}</span></button>
        <button className="rail-action" onClick={() => setDrawer("settings")}><Settings2 size={16} /> 回饋設定</button>
        <button className="rail-action" onClick={() => setDrawer("campaign")}><MapPinned size={16} /> 戰役地圖</button>
        <button className="rail-action" onClick={() => { setGalleryChapter(currentChapter); setDrawer("gallery"); }}><Sparkles size={16} /> 碑文畫廊</button>
        <button className="rail-action" onClick={() => setDrawer("editor")}><Grid2X2 size={16} /> 關卡工作桌</button>
        <button className="rail-action" onClick={() => setDrawer("curriculum")}><MapPinned size={16} /> 50 關索引</button>
      </aside>

      <section className={`control-deck ${handednessClass(feedbackPreferences.handedness)}`} aria-label="遊戲操作區">
        <div className="history-actions">
          <button className={`control-button hint-control ${hintDirection ? "active" : ""}`} onClick={hintCharges > 0 ? revealHint : openRescuePath} disabled={!isHintButtonInteractive(snapshot.state.status)}><Lightbulb size={17} /><span>{hintCharges > 0 ? `燈泡 ${hintCharges}` : "完整解答"}</span></button>
          <button className="control-button" onClick={undoMove} disabled={snapshot.cursor === 0 || snapshot.replaying || undoCharges <= 0} aria-label={`回到上一步，剩餘 ${undoCharges} 次`}><Undo2 size={17} /><span>上一步 {undoCharges}</span></button>
          <button className="control-button" onClick={() => world.redo()} disabled={snapshot.cursor >= snapshot.historyLength - 1 || snapshot.replaying} aria-label="重做下一步"><Redo2 size={17} /><span>重做</span></button>
          <button className="control-button" onClick={() => world.replay("path")} disabled={snapshot.historyLength < 2 || snapshot.replaying}><FastForward size={17} /><span>{snapshot.replaying ? snapshot.replayMode === "death" ? "死亡回放中" : "回放中" : snapshot.state.status === "lost" ? "死亡回放" : "回放"}</span></button>
          <button className="control-button restart-control" onClick={resetRound} aria-label="重新開始本關"><RotateCcw size={17} /><span>重新開始</span></button>
        </div>
        <div className="dpad" aria-label="方向控制">
          {(["up", "left", "down", "right"] as Direction[]).map((direction) => {
            const Icon = directionIcons[direction];
            return <button key={direction} className={`dpad-button ${direction} ${hintDirection === direction ? "hinted" : ""}`} onClick={() => world.move(direction)} aria-label={`向${direction === "up" ? "上" : direction === "down" ? "下" : direction === "left" ? "左" : "右"}移動`}><Icon size={19} /></button>;
          })}
        </div>
      </section>

      {campaignFinished && snapshot.state.status === "won" && !monument && (
        <section className="campaign-final-card resolution-card won">
          <div className="win-emblem"><Trophy size={20} /></div>
          <p className="eyebrow">ARCHIVE COMPLETE · 50 / 50</p>
          <h2>恭喜完成所有關卡！</h2>
          <p>第五十道刻痕已封存。戰役在此結束，不會自動回到第一關；你仍可從「跳關／選擇關卡」回顧任何已完成石室。</p>
          <div className="clear-stats"><span><small>最終用時</small><strong>{formatElapsed(elapsedSeconds)}</strong></span><span><small>完成步數</small><strong>{snapshot.state.turn} 步</strong></span><span className="star-stat"><small>{currentRating?.label}</small><strong>{currentRating ? starGlyphs(currentRating.stars) : "☆☆☆"}</strong></span></div>
          <button className="quiet-action" onClick={() => setDrawer("campaign")}><MapPinned size={16} />回顧已完成關卡</button>
        </section>
      )}

      {snapshot.state.status !== "playing" && !campaignFinished && !rescueOpen && (
        <section className={`resolution-card ${snapshot.state.status} ${snapshot.state.deathCause ? `death-${snapshot.state.deathCause}` : ""}`}>
          {snapshot.state.status === "won" ? (
            <>
              <div className="win-emblem"><Trophy size={20} /></div>
              <p className="eyebrow">ARCHIVE SEALED · LEVEL {String(levelIndex + 1).padStart(2, "0")}</p>
              <h2>恭喜過關！</h2>
              <p>封印已承認這條因果鏈。你完成了本關的可解路徑，現在可以帶著這份紀錄前往下一個石室。</p>
              <div className="clear-stats"><span><small>經過時間</small><strong>{formatElapsed(elapsedSeconds)}</strong></span><span><small>完成步數</small><strong>{snapshot.state.turn} 步</strong></span><span><small>最短主解</small><strong>{solveResult.moves} 步</strong></span><span className="star-stat"><small>{currentRating?.label}</small><strong>{currentRating ? starGlyphs(currentRating.stars) : "☆☆☆"}</strong></span></div>
              <div style={{position: 'relative', zIndex: 1000}}><button className="primary-action next-level" onClick={goToNextLevel} style={{zIndex: 1000}}><Play size={16} />前往下一關</button><button className="quiet-action" onClick={resetRound} style={{zIndex: 1000}}><RotateCcw size={16} />重玩本關</button></div>
            </>
          ) : (
            <>
              {(() => { const cause = deathCauseCopy(snapshot.state.deathCause); return <><p className="eyebrow">FAILURE RECORD · {cause.label}</p><h2>這條因果需要重寫</h2><p>{cause.detail}</p><p className="death-guidance">先讀取預警節拍，再選擇撤銷或從最近的存檔點繼續。</p></>; })()}
              <div><button className="primary-action" onClick={retryFromCheckpoint}><RotateCcw size={16} />從最近存檔點重試</button><button className="quiet-action" onClick={replayDeath} disabled={snapshot.historyLength < 2}><FastForward size={16} />觀看死亡回放</button><button className="quiet-action" onClick={openRescuePath} disabled={solutionLoading}><WandSparkles size={16} />{solutionLoading ? "讀取完整解答中" : "觀看完整解答"}</button>            <button className="quiet-action" onClick={resetRound}><RotateCcw size={16} />重新開始本關</button><button className="quiet-action" onClick={undoMove} disabled={undoCharges <= 0}>回退一步 ({undoCharges})</button></div>
            </>
          )}
        </section>
      )}

      {hintHistoryOpen && (
        <section className="hint-history-panel" role="dialog" aria-modal="false" aria-labelledby="hint-history-title">
          <div className="hint-history-head"><div><p className="eyebrow">HINT ARCHIVE · {hintHistory.length}</p><h2 id="hint-history-title">歷史提示</h2></div><button type="button" onClick={() => setHintHistoryOpen(false)} aria-label="關閉歷史提示"><X size={17} /></button></div>
          {hintHistory.length > 0 ? (
            <div className="hint-history-list">
              {[...hintHistory].reverse().map((entry) => <article className="hint-history-entry" key={entry.id}><div><strong>{entry.levelTitle}</strong><small>{entry.levelId.toUpperCase()} · 第 {entry.turn} TURN 解鎖</small></div><span>下一步：{entry.direction}<small>+{entry.cost} TURN · {new Date(entry.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small></span></article>)}
            </div>
          ) : <p className="hint-history-empty">尚未解鎖任何燈泡提示。完成一次提示後，內容會保存在這裡。</p>}
        </section>
      )}

      {drawer !== "none" && (
        <div className="drawer-scrim" onMouseDown={() => setDrawer("none")}>
          <aside className={`archive-drawer ${drawer}`} onMouseDown={(event) => event.stopPropagation()}>
            <button className="drawer-close" onClick={() => setDrawer("none")} aria-label="關閉側頁"><X size={18} /></button>
            {drawer === "editor" && (
              <>
                <p className="eyebrow">ARCHITECT'S DESK</p><h2>關卡工作桌</h2>
                <p className="drawer-intro">以同一套狀態規則繪製房間，再由 A* 搜尋器檢驗是否留有通往封印的路徑。</p>
                <div className="size-switch">
                  {[8, 16, 24].map((size) => <button key={size} className={editorSize === size ? "selected" : ""} onClick={() => regenerateEditor(size)}>{size}×{size}</button>)}
                </div>
                <div className="tool-grid">
                  {tools.map((tool) => <button key={tool.id} className={selectedTool === tool.id ? "selected" : ""} onClick={() => setSelectedTool(tool.id)}><span>{tool.glyph}</span>{tool.label}</button>)}
                </div>
                <div className="editor-board" style={{ gridTemplateColumns: `repeat(${editorLevel.columns}, minmax(0, 1fr))` }}>
                  {Array.from({ length: editorLevel.columns * editorLevel.rows }, (_, index) => {
                    const x = index % editorLevel.columns; const y = Math.floor(index / editorLevel.columns); const key = `${x},${y}`;
                    const tile = editorLevel.terrain[key] ?? "floor";
                    const symbol = tile === "wall" ? "▦" : tile === "sealed" ? "▰" : tile === "breakable" ? "▩" : tile === "exit" ? "✦" : editorLevel.start.x === x && editorLevel.start.y === y ? "◈" : editorLevel.crates.some((entry) => entry.x === x && entry.y === y) ? "▣" : editorLevel.doors.some((entry) => entry.position.x === x && entry.position.y === y) ? "▥" : editorLevel.plates.some((entry) => entry.position.x === x && entry.position.y === y) ? "═" : editorLevel.portals.some((entry) => entry.from.x === x && entry.from.y === y) ? "◌" : editorLevel.traps.some((entry) => entry.position.x === x && entry.position.y === y) ? "⌁" : editorLevel.mines.some((entry) => entry.position.x === x && entry.position.y === y) ? "◉" : editorLevel.flameJets.some((entry) => entry.position.x === x && entry.position.y === y) ? "≋" : editorLevel.enemies.some((entry) => entry.position.x === x && entry.position.y === y) ? "◆" : "";
                    return <button className={`editor-cell ${tile}`} key={key} onClick={() => setEditorLevel((level) => paintLevel(level, { x, y }, selectedTool))}>{symbol}</button>;
                  })}
                </div>
                <div className="editor-actions"><button className="primary-action" onClick={validateEditor}><WandSparkles size={16} />驗證可解性</button><button className="quiet-action" onClick={() => { const fresh = makeRandomEditor(editorSize); setEditorLevel(fresh); setEditorResult(solveLevel(fresh)); }}>重擲地圖</button></div>
                {editorResult && <div className={`validation ${editorResult.solvable ? "pass" : "fail"}`}><strong>{editorResult.solvable ? "此卷宗可解" : editorResult.capped ? "搜尋超出預算" : "未找到可行路徑"}</strong><span>{editorResult.solvable ? `主解 ${editorResult.moves} 步，探索 ${editorResult.explored.toLocaleString()} 個狀態。` : `已檢查 ${editorResult.explored.toLocaleString()} 個狀態。`}</span></div>}
                <button className="load-level" onClick={loadEditor}><ChevronRight size={17} />載入到中央棋盤</button>
              </>
            )}
            {drawer === "curriculum" && (
              <>
                <p className="eyebrow">CURRICULUM INDEX</p><h2>五十道推演</h2><p className="drawer-intro">每十關引進一條新規則。難度來自狀態交織，而不是只是把盤面放大。</p>
                <div className="curriculum-list">{CURRICULUM.map((entry) => <div className={entry.newRule ? "lesson new-rule" : "lesson"} key={entry.level}><span>{String(entry.level).padStart(2, "0")}</span><div><strong>{entry.title}</strong>{entry.newRule && <small>本章新規則</small>}<p>{entry.rule}</p></div></div>)}</div>
              </>
            )}
            {drawer === "campaign" && (
              <>
                <p className="eyebrow">ARCHIVE ATLAS</p><h2>回聲戰役地圖</h2><p className="drawer-intro">五章、五十份手工刻寫的檔案依序展開。完成至第 {maxCompletedIndex + 1} 關後，前段石室皆可自由重玩；已封存的步數與星等會留在本機卷宗。</p>
                <div className="campaign-filter" role="group" aria-label="關卡完成狀態篩選">
                  {(["all", "completed", "incomplete"] as const).map((filter) => <button key={filter} className={campaignFilter === filter ? "selected" : ""} onClick={() => setCampaignFilter(filter)}>{filter === "all" ? "全部" : filter === "completed" ? "已完成" : "未完成"}</button>)}
                </div>
                <p className="campaign-filter-summary">已完成 {completedLevelIds.filter((id) => PLAYABLE_LEVELS.some((level) => level.id === id)).length}／{PLAYABLE_LEVELS.length} 關</p>
                <div className="campaign-map">
                  {CAMPAIGN_NODES.map((node, index) => {
                    const level = PLAYABLE_LEVELS[index];
                    const complete = completedLevelIds.includes(level.id);
                    const unlocked = true; // 跳關全開放：1–50 關任選可玩；goToLevel 會完整重設目標關世界
                    if (campaignFilter === "completed" && !complete) return null;
                    if (campaignFilter === "incomplete" && complete) return null;
                    return <button className={`campaign-node ${node.accent} ${complete ? "complete" : ""} ${index === levelIndex ? "current" : ""}`} key={node.levelId} onClick={() => unlocked && goToLevel(index)} disabled={!unlocked} title={complete ? `重玩第 ${index + 1} 關` : unlocked ? `開始第 ${index + 1} 關` : "尚未解鎖"}>
                      <span className="campaign-seal">{complete ? "✓" : String(node.node).padStart(2, "0")}</span><span className="campaign-thread" />
                      <span className="campaign-copy"><small>CH.{String(node.chapter).padStart(2, "0")} · {node.size}</small><strong>{level.title}</strong><em>{complete ? "已完成" : unlocked ? "未完成 · 可開始" : "未解鎖"} {levelStars[level.id] ? starGlyphs(levelStars[level.id]) : ""}</em></span>
                    </button>;
                  })}
                </div>
                <div className="campaign-footnote"><MapPinned size={15} /><span>每十關以一則碑文展開與收束；16×16、24×24 石室會自動啟用邊緣收納工作區。</span></div>
              </>
            )}
            {drawer === "gallery" && (
              <>
                <p className="eyebrow">INSCRIPTION GALLERY</p><h2>碑文畫廊</h2><p className="drawer-intro">回顧已解鎖章節的像素插畫、碑文與角色對話。每次點擊都會重新展開一則回聲。</p>
                <div className="gallery-chapter-tabs">{CHAPTER_NARRATIVES.map((entry) => {
                  const unlocked = entry.chapter === 1 || completedLevelIds.includes(PLAYABLE_LEVELS[entry.chapter * 10 - 1]?.id ?? "");
                  return <button key={entry.chapter} className={galleryChapter === entry.chapter ? "selected" : ""} onClick={() => unlocked && setGalleryChapter(entry.chapter)} disabled={!unlocked}>CH.{entry.chapter} {unlocked ? "" : "· LOCKED"}</button>;
                })}</div>
                <PixelChapterArt chapter={galleryNarrative.chapter} ending={false} />
                <div className="gallery-copy"><p className="eyebrow">{galleryNarrative.code}</p><h3>{galleryNarrative.title}</h3><p>{galleryNarrative.galleryCaption}</p><blockquote>{galleryNarrative.opening.inscription}</blockquote><div className="gallery-dialogue">{galleryNarrative.opening.dialogue.map((entry, index) => <p key={`${entry.speaker}-${index}`}><strong>{entry.speaker}</strong>{entry.text}</p>)}</div><blockquote>{galleryNarrative.closing.inscription}</blockquote><p>{galleryNarrative.closing.keeper}</p></div>
              </>
            )}
            {drawer === "reference" && (
              <>
                <div className="rune-index-title"><div className="mini-sarcophagus" aria-hidden="true"><i /></div><div><p className="eyebrow">VISUAL REFERENCE</p><h2>符文與讀法</h2></div></div><p className="drawer-intro">遊戲用色彩和形狀表示規則，不用即時反應遮掩後果。</p>
                <div className="rune-browser-tools">
                  <input value={runeQuery} onChange={(event) => setRuneQuery(event.target.value)} placeholder="搜尋符文、機關或說明…" aria-label="搜尋符文" />
                  <div className="rune-category-tabs" role="tablist" aria-label="符文分類">
                    {["全部", "角色", "目標", "機關", "威脅"].map((category) => <button key={category} type="button" role="tab" aria-selected={runeCategory === category} className={runeCategory === category ? "selected" : ""} onClick={() => setRuneCategory(category)}>{category}</button>)}
                  </div>
                </div>
                <p className="rune-result-count">顯示 {filteredRuneLegend.length} / {RUNE_LEGEND.length} 枚符文</p>
                <div className="native-rune-grid">
                  {filteredRuneLegend.length > 0 ? filteredRuneLegend.map(([, title, description]) => <article className="native-rune" key={title}><span>{runeGlyph(({ 探險者: "player", "巡弋石像": "enemy", 壓力石板: "plate", "石門／出口": "door", 單向門扉: "portal", 推動木箱: "crate", 延遲尖刺: "trap", 封石牆: "sealed", 脆弱石障: "breakable", 自爆地雷: "mine", 火焰噴射器: "flame", 落石: "rock", 封印出口: "exit" } as const)[title], runeStyle)}</span><div><strong>{title}</strong><p>{description}</p></div></article>) : <p className="rune-empty">沒有符合條件的符文，請嘗試其他關鍵字。</p>}
                </div>
                <p className="reference-note">銅綠只標示你可操作或可推論的狀態；硃砂標示威脅；舊金標示目標。每個符文都在回合結算前提供足夠線索。</p>
              </>
            )}
            {drawer === "advanced" && (
              <>
                <p className="eyebrow">ADVANCED FIELD SCHOOL</p><h2>進階機關教學</h2><p className="drawer-intro">這些頁面不會中斷遊戲。你可以先跳過，在需要時由右側卷宗或操作筆記隨時重播。</p>
                <div className="advanced-progress">{advancedLessons.map((lesson, index) => <button key={lesson.title} className={index === advancedLesson ? "active" : ""} onClick={() => setAdvancedLesson(index)}>{String(index + 1).padStart(2, "0")}</button>)}</div>
                <article className="advanced-lesson"><span>{advancedLessons[advancedLesson].glyph}</span><div><p className="eyebrow">MECHANISM {String(advancedLesson + 1).padStart(2, "0")}</p><h3>{advancedLessons[advancedLesson].title}</h3><p>{advancedLessons[advancedLesson].body}</p></div></article>
                <div className="advanced-actions"><button className="primary-action" onClick={() => setAdvancedLesson((current) => (current + 1) % advancedLessons.length)}><ChevronRight size={16} />下一則機關筆記</button><button className="quiet-action" onClick={() => setDrawer("none")}>先繼續探索</button></div>
              </>
            )}
            {drawer === "settings" && (
              <>
                <p className="eyebrow">SENSORY PREFERENCES</p><h2>回饋設定</h2><p className="drawer-intro">音效與震動只用於確認明確的回合事件，例如石像撞擊、陷阱結算與通關。關閉後不影響規則、提示或解答。</p>
                <div className="preference-list">
                  <div className="preference-row preference-row-static"><span className="preference-icon">✦</span><span><strong>符文顯示</strong><small>{runeStyle === "emoji" ? "Emoji 模式：地圖與圖鑑使用彩色語意圖示。" : "像素模式：地圖與圖鑑使用低彩度刻印符號。"}</small></span><div className="handedness-toggle" role="group" aria-label="選擇符文顯示"><button type="button" aria-pressed={runeStyle === "emoji"} className={runeStyle === "emoji" ? "selected" : ""} onClick={() => setRuneDisplayStyle("emoji")}>Emoji</button><button type="button" aria-pressed={runeStyle === "pixel"} className={runeStyle === "pixel" ? "selected" : ""} onClick={() => setRuneDisplayStyle("pixel")}>像素</button></div></div>
                  {isLargeBoard && <div className="large-board-preferences">
                    <div className="large-board-preference"><span><strong>大地圖縮放</strong><small>{Math.round(boardZoom * 100)}% 放大</small></span><input aria-label="大地圖縮放" type="range" min="0.82" max="1.25" step="0.01" value={boardZoom} onChange={(event) => setLargeBoardZoom(Number(event.target.value))} /></div>
                    <div className="large-board-preference"><span><strong>24×24 Emoji 尺寸</strong><small>{Math.round(emojiScale * 100)}% 標記</small></span><input aria-label="24×24 Emoji 尺寸" type="range" min="0.82" max="1.2" step="0.01" value={emojiScale} onChange={(event) => setLargeBoardEmojiScale(Number(event.target.value))} /></div>
                  </div>}
                  <div className="preference-row preference-row-static quality-mode-preference"><span className="preference-icon">{feedbackPreferences.displayQualityMode === "performance" ? "◌" : "✦"}</span><span><strong>渲染模式 · {feedbackPreferences.displayQualityMode === "performance" ? "高效能" : "高畫質"}</strong><small>{feedbackPreferences.displayQualityMode === "performance" ? "24×24 地圖降低 GPU 填充率與節奏動畫頻率，優先維持操作流暢。" : "保留完整環境節奏、事件特效與較高畫面解析度。"}</small></span><div className="handedness-toggle" role="group" aria-label="選擇渲染模式"><button type="button" aria-pressed={feedbackPreferences.displayQualityMode === "performance"} className={feedbackPreferences.displayQualityMode === "performance" ? "selected" : ""} onClick={() => setDisplayQualityMode("performance")}>高效能</button><button type="button" aria-pressed={feedbackPreferences.displayQualityMode === "quality"} className={feedbackPreferences.displayQualityMode === "quality" ? "selected" : ""} onClick={() => setDisplayQualityMode("quality")}>高畫質</button></div></div>
                  <div className="volume-preference preference-row-static"><span className="preference-icon">{feedbackPreferences.masterVolume > 0 && !feedbackPreferences.muted ? <Volume2 size={19} /> : <VolumeX size={19} />}</span><span><strong>總事件音量 · {Math.round(feedbackPreferences.masterVolume * 100)}%</strong><small>套用至所有事件；分組滑桿可再微調。</small></span><input aria-label="總事件音量" type="range" min="0" max="1" step="0.01" value={feedbackPreferences.masterVolume} onChange={(event) => setMasterVolume(Number(event.target.value))} /></div>
                  <div className="volume-preference preference-row-static music-volume-row"><span className="preference-icon">♫</span><span><strong>背景音樂 · {Math.round(feedbackPreferences.musicVolume * 100)}%</strong><small>{musicTransition.track.name} · {musicTransition.track.subtitle}</small></span><input aria-label="背景音樂音量" type="range" min="0" max="1" step="0.01" value={feedbackPreferences.musicVolume} onChange={(event) => setMusicVolume(Number(event.target.value))} /></div>
                  <div className="rhythm-preference preference-row-static"><span className="preference-icon">◈</span><span><strong>環境節奏 · {selectedAnimationMode.label}</strong><small>{selectedAnimationMode.detail} · 本章節脈動強度 {Math.round(rhythmProfile.intensity * 100)}%</small></span><select aria-label="環境節奏動畫更新頻率" value={feedbackPreferences.musicAnimationMode ?? DEFAULT_MUSIC_ANIMATION_MODE} onChange={(event) => setMusicAnimationMode(event.target.value as MusicAnimationMode)}>{MUSIC_ANIMATION_OPTIONS.map((option) => <option value={option.id} key={option.id}>{option.label}</option>)}</select></div>
                  <MusicTransitionIndicator state={musicTransition} volume={feedbackPreferences.musicVolume} spectrum={musicSpectrum} />
                  <div className="feedback-volume-groups"><p className="eyebrow">EVENT MIXER</p>{FEEDBACK_VOLUME_GROUPS.map((group) => <div className="volume-group-row" key={group.id}><span><strong>{group.label} · {Math.round(feedbackPreferences.groupVolumes[group.id] * 100)}%</strong><small>{group.detail}</small></span><input aria-label={`${group.label}音量`} type="range" min="0" max="1" step="0.01" value={feedbackPreferences.groupVolumes[group.id]} onChange={(event) => setFeedbackGroupVolume(group.id, Number(event.target.value))} /></div>)}</div>
                  <div className="sound-preview-block"><div><p className="eyebrow">SOUND LIBRARY</p><strong>事件試聽</strong><small>預覽會同時套用總音量與所屬事件分組。</small></div><div className="sound-preview-grid">{SOUND_PREVIEW_OPTIONS.map((option) => <button type="button" key={option.type} onClick={() => previewFeedbackSound(option.type, option.label)} disabled={!feedbackPreferences.sound || feedbackPreferences.muted} aria-label={`試聽${option.label}`}><span>{option.glyph}</span><small>{option.label}</small></button>)}</div></div>
                  <button className="preference-row" onClick={() => updateFeedbackPreference("sound")}><span className="preference-icon">{feedbackPreferences.sound ? <Volume2 size={19} /> : <VolumeX size={19} />}</span><span><strong>事件音效</strong><small>{feedbackPreferences.sound ? "已開啟：撞擊與陷阱會播放短促確認音。" : "已關閉：保留所有視覺提示。"}</small></span><b>{feedbackPreferences.sound ? "ON" : "OFF"}</b></button>
                  <button className="preference-row" onClick={toggleMute} aria-pressed={feedbackPreferences.muted}><span className="preference-icon">{feedbackPreferences.muted ? <VolumeX size={19} /> : <Volume2 size={19} />}</span><span><strong>全域靜音</strong><small>{feedbackPreferences.muted ? "目前靜音中；按 M 或此按鈕恢復。" : "暫時靜音所有事件音效；視覺與震動不受影響。快捷鍵：M"}</small></span><b>{feedbackPreferences.muted ? "MUTED" : "LIVE"}</b></button>
                  <button className="preference-row" onClick={() => updateFeedbackPreference("haptics")}><span className="preference-icon"><Vibrate size={19} /></span><span><strong>裝置震動</strong><small>{feedbackPreferences.haptics ? "已開啟：支援的裝置會在重要事件提供節奏回饋。" : "已關閉：不會呼叫裝置震動。"}</small></span><b>{feedbackPreferences.haptics ? "ON" : "OFF"}</b></button>
                  <div className="hint-stats-panel"><p className="eyebrow">HINT LEDGER · {snapshot.level.id}</p><strong>提示成本紀錄</strong><small>本關已使用 {currentHintStats.uses} 次，共增加 {currentHintStats.totalCost} TURN{currentHintStats.uses > 0 ? `，平均每次 ${currentHintAverageCost} TURN` : ""}。</small><div className="hint-cost-history">{currentHintStats.costs.length > 0 ? currentHintStats.costs.map((cost, index) => <span key={`${cost}-${index}`} title={`第 ${index + 1} 次提示：+${cost} TURN，提示後 ${currentHintStats.turns[index] ?? "—"} TURN`}><b>#{index + 1}</b><em>+{cost}</em><small>→ {currentHintStats.turns[index] ?? "—"}</small></span>) : <span className="hint-stats-empty">本關尚未使用燈泡提示。</span>}</div><p className="hint-stats-total">全戰役累計：{totalHintStats.uses} 次 · +{totalHintStats.totalCost} TURN</p><div className="hint-stats-actions"><button type="button" onClick={() => setStatsConfirm("level")} disabled={currentHintStats.uses === 0}>清除本關紀錄</button><button type="button" onClick={() => setStatsConfirm("all")} disabled={totalHintStats.uses === 0}>清除全戰役</button></div>{statsConfirm && <div className="stats-confirm" role="alertdialog" aria-live="assertive" aria-label="確認清除提示統計"><strong>{statsConfirm === "level" ? `清除「${snapshot.level.title}」紀錄？` : "清除全戰役提示紀錄？"}</strong><small>{statsConfirm === "level" ? "只會移除目前關卡的提示次數與 TURN 成本。" : "將移除所有 50 關的提示次數與 TURN 成本，此操作無法復原。"}</small><div><button type="button" onClick={() => clearHintStats(statsConfirm)}>確認清除</button><button type="button" onClick={() => setStatsConfirm(null)}>取消</button></div></div>}</div>
                  <div className="preference-row preference-row-static"><span className="preference-icon"><Hand size={19} /></span><span><strong>操作手勢</strong><small>{feedbackPreferences.handedness === "right" ? "右手模式：方向鍵在右側，歷史操作列在左側。" : "左手模式：方向鍵在左側，歷史操作列在右側。"}</small></span><div className="handedness-toggle" role="group" aria-label="選擇操作手勢"><button type="button" aria-pressed={feedbackPreferences.handedness === "left"} className={feedbackPreferences.handedness === "left" ? "selected" : ""} onClick={() => setHandedness("left")}>左手</button><button type="button" aria-pressed={feedbackPreferences.handedness === "right"} className={feedbackPreferences.handedness === "right" ? "selected" : ""} onClick={() => setHandedness("right")}>右手</button></div></div>
                </div>
                <p className="reference-note">偏好與提示成本會保留在這台裝置的本機卷宗中。瀏覽器或裝置若不支援震動，遊戲仍可正常進行。</p>
              </>
            )}
          </aside>
        </div>
      )}

      {hasDedicatedPathGuide && pathGuideOpen && snapshot.state.status === "playing" && (
        <section className="path-guide-panel" aria-live="polite" aria-label={`LV.${levelIndex + 1} 最佳路徑視覺提示`}>
          <div><span className="eyebrow">A* PATH GUIDE</span><strong>最佳路徑 · 目前狀態</strong></div>
          <div className="path-guide-sequence">{guidePath.map(({ move, index, Icon }) => <span className="path-guide-step" key={`${move}-${index}`}><small>{index + 1}</small><Icon size={15} /><em>{directionText[move]}</em></span>)}{guidePath.length === 0 && <span className="path-guide-empty">目前狀態沒有可行解。</span>}</div>
          <button className="path-guide-close" onClick={() => setPathGuideOpen(false)} aria-label="關閉最佳路徑提示">×</button>
        </section>
      )}
      {/* ── 電腦AI展示模式 浮動控制面板 ── */}
      <div
        style={{
          position: "fixed",
          bottom: 96,
          right: 16,
          zIndex: 61,
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: 8,
        }}
      >
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <button
            type="button"
            className="quiet-action"
            onClick={() => setAiLedgerOpen((open) => !open)}
            style={{
              fontSize: 12,
              padding: "6px 12px",
              background: "rgba(10,24,20,0.92)",
              border: "1px solid rgba(163,176,164,0.45)",
              color: "#bbf7d0",
              borderRadius: 6,
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            📊 {aiLedgerOpen ? "收起 AI 策略" : "AI 戰術大腦"}
          </button>
          {aiDemoMode ? (
            <button
              type="button"
              className="primary-action"
              onClick={stopAIDemo}
              style={{
                background: "linear-gradient(135deg, #ef4444, #dc2626)",
                color: "#ffffff",
                boxShadow: "0 0 16px rgba(239,68,68,0.5)",
                fontWeight: 700,
              }}
            >
              ⏹ 停止展示 (LV.{levelIndex + 1}: {aiDemoIndex}/{aiDemoPath.length}步)
            </button>
          ) : (
            <button
              type="button"
              className="primary-action"
              onClick={startAIDemo}
              style={{
                background: "linear-gradient(135deg, #10b981, #059669)",
                color: "#ffffff",
                boxShadow: "0 0 16px rgba(16,185,129,0.45)",
                fontWeight: 700,
              }}
            >
              🤖 電腦AI展示模式 · 全破率 100%
            </button>
          )}
        </div>

        {aiDemoMode && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              background: "rgba(6,18,14,0.95)",
              border: "1px solid rgba(74,222,128,0.4)",
              padding: "4px 10px",
              borderRadius: 8,
              fontSize: 12,
              color: "#d7e4dd",
              boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
            }}
          >
            <span>速度:</span>
            {[
              { label: "慢", speed: 450 },
              { label: "標準", speed: 200 },
              { label: "快", speed: 80 },
              { label: "極速", speed: 25 },
            ].map((sp) => (
              <button
                key={sp.label}
                type="button"
                onClick={() => {
                  setAiSpeed(sp.speed);
                  aiSpeedRef.current = sp.speed;
                }}
                style={{
                  background: aiSpeed === sp.speed ? "#10b981" : "rgba(255,255,255,0.08)",
                  color: aiSpeed === sp.speed ? "#052e16" : "#cbd5e1",
                  border: "none",
                  borderRadius: 4,
                  padding: "2px 7px",
                  fontSize: 11,
                  fontWeight: aiSpeed === sp.speed ? 700 : 400,
                  cursor: "pointer",
                }}
              >
                {sp.label}
              </button>
            ))}
            <label style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: 4, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={aiAutoNext}
                onChange={(e) => {
                  setAiAutoNext(e.target.checked);
                  aiAutoNextRef.current = e.target.checked;
                }}
              />
              <span style={{ fontSize: 11, color: "#86efac" }}>連續破關</span>
            </label>
          </div>
        )}
      </div>

      {aiLedgerOpen && (
        <section
          aria-label="電腦AI展示 · AI 策略登錄"
          style={{
            position: "fixed",
            bottom: 160,
            right: 16,
            zIndex: 62,
            width: 380,
            maxWidth: "calc(100vw - 32px)",
            maxHeight: "68vh",
            overflow: "auto",
            background: "rgba(7,17,15,0.98)",
            color: "#d7e4dd",
            border: "1px solid rgba(74,222,128,0.45)",
            borderRadius: 14,
            padding: "16px 18px",
            boxShadow: "0 16px 40px rgba(0,0,0,0.65)",
            fontSize: 12,
            lineHeight: 1.55,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <strong style={{ fontSize: 14, color: "#4ade80" }}>🤖 AI 戰術大腦 · 策略登錄</strong>
              <span style={{ background: "rgba(74,222,128,0.2)", color: "#86efac", padding: "1px 6px", borderRadius: 4, fontSize: 11, fontWeight: 700 }}>全破關率 100%</span>
            </div>
            <button
              type="button"
              onClick={() => setAiLedgerOpen(false)}
              aria-label="關閉 AI 策略登錄"
              style={{ background: "transparent", border: "none", color: "#9ca3af", cursor: "pointer", fontSize: 18, lineHeight: 1 }}
            >
              ×
            </button>
          </div>

          <p style={{ margin: "0 0 10px", color: "#a1a1aa", fontSize: 11.5 }}>
            本系統以<strong>「深度學習＋作業研究＋賽局理論」</strong>為三大學理支柱，採用<strong>「結果論」</strong>（客觀勝率加權投票）進行無限制迭代測試。
            硬性規定：高勝率策略絕對優先保留；低勝率策略改良測試達上限 30 次仍無效者果斷捨棄。全盤遵循公開因果規則，<strong>絕不作弊</strong>。
          </p>

          <div style={{ marginBottom: 12, display: "flex", flexDirection: "column", gap: 6 }}>
            {AI_STRATEGIES.map((s) => (
              <div
                key={s.id}
                style={{
                  background: s.discarded ? "rgba(239,68,68,0.06)" : "rgba(34,197,94,0.08)",
                  border: `1px solid ${s.discarded ? "rgba(239,68,68,0.25)" : "rgba(74,222,128,0.3)"}`,
                  borderRadius: 8,
                  padding: "8px 10px",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontFamily: "monospace", fontSize: 11, color: s.discarded ? "#f87171" : "#4ade80", fontWeight: 700 }}>
                      [{s.family}]
                    </span>
                    <strong style={{ color: "#f3f4f6" }}>{s.name}</strong>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontWeight: 700, color: s.winRate >= 0.9 ? "#4ade80" : "#f87171", fontSize: 13 }}>
                      {(s.winRate * 100).toFixed(0)}%
                    </span>
                    <span
                      style={{
                        fontSize: 10.5,
                        padding: "1px 5px",
                        borderRadius: 3,
                        background: s.discarded ? "rgba(239,68,68,0.2)" : "rgba(34,197,94,0.2)",
                        color: s.discarded ? "#fca5a5" : "#86efac",
                      }}
                    >
                      {s.discarded ? `捨棄 (已測滿${s.attempts}次)` : "優先保留"}
                    </span>
                  </div>
                </div>
                <div style={{ color: "#9ca3af", fontSize: 11 }}>{s.reason}</div>
              </div>
            ))}
          </div>

          <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: 10, marginTop: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <strong style={{ fontSize: 12, color: "#cbd5e1" }}>🎯 關卡快速跳轉展示 (全 50 關 · 100% 可解)：</strong>
              <span style={{ fontSize: 11, color: "#94a3b8" }}>當前: 第 {levelIndex + 1} 關</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 4, maxHeight: 160, overflowY: "auto", paddingRight: 4 }}>
              {PLAYABLE_LEVELS.map((lvl, idx) => {
                const moves = PRECOMPUTED_SOLUTIONS[lvl.id]?.length ?? 0;
                const isCurrent = idx === levelIndex;
                return (
                  <button
                    key={lvl.id}
                    type="button"
                    onClick={() => {
                      runAIDemoForLevel(idx);
                      if (window.innerWidth < 640) setAiLedgerOpen(false);
                    }}
                    style={{
                      background: isCurrent ? "#10b981" : "rgba(255,255,255,0.06)",
                      border: isCurrent ? "1px solid #4ade80" : "1px solid rgba(255,255,255,0.1)",
                      color: isCurrent ? "#052e16" : "#e2e8f0",
                      padding: "4px 2px",
                      borderRadius: 4,
                      fontSize: 10.5,
                      fontWeight: isCurrent ? 700 : 400,
                      cursor: "pointer",
                      textAlign: "center",
                    }}
                    title={`${lvl.title} · ${moves} 步`}
                  >
                    LV.{idx + 1}
                    <div style={{ fontSize: 9, opacity: 0.8 }}>{moves}步</div>
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      )}
      <div className="solver-strip" aria-label="主解路徑預覽"><span>主解刻痕</span>{activePath.map(({ move, Icon }, index) => <span key={`${move}-${index}`} className="solution-arrow"><Icon size={13} /></span>)}<small>{solveResult.moves > activePath.length ? "…" : ""}</small></div>
    </main>
  );
}
