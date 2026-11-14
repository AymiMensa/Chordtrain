/* 霧面工藝棋盤：此元件以可讀性優先的紙質規則片與工作桌資訊層呈現遊戲。 */
/* 霧面工藝棋盤介面：已過關資訊以青綠成績標籤呈現最佳步數與最短時間，兼顧桌機節點與手機選單的可讀性。 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowDownToLine,
  BookOpen,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Footprints,
  Info,
  LockKeyhole,
  MousePointer2,
  Play,
  Redo2,
  RotateCcw,
  SkipForward,
  Sparkles,
  Settings2,
  Undo2,
  Unlock,
  PencilRuler,
  Copy,
  Download,
  Upload,
  X,
  Focus,
  Minimize2,
  MoveVertical,
  ZoomIn,
  BarChart3,
  GripVertical,
  Trash2,
} from "lucide-react";
import { campaignLevels } from "./levels";
import { createDailyChallenge, dailyChallengeDateKey, dailyChallengeDateLabel, getDailyCountdown } from "./dailyChallenge";
import { GameWorld } from "./GameWorld";
import type { GameHandle, RenderQuality } from "./scene";
import { readDevicePerformanceSignals, recommendRenderQuality, type RenderQualityRecommendation } from "./performance";
import type { FrameHealth } from "./performance";
import { exportLevelCode, importLevelCode } from "./share";
import { assertNoDuplicateRequiredRules, requiredChallengesFor } from "./ruleGuards";
import { analyzeEditorSolvability, type EditorSolvabilityReport } from "./editorAnalysis";
import type { CustomNounAsset, Direction, EditorLighting, GridPoint, LevelDefinition, PersonalRecord, RuleStatus, WorldView } from "./types";
import { resolveAssetUrl } from "./assets";

const ASSETS = {
  background: "/manus-storage/lawweaver-paper-background_28f3d5a2.png",
  tile: "/manus-storage/lawweaver-rule-tile-material_1ef3f924.png",
  chapter: "/manus-storage/lawweaver-chapter-illustration_7f2c24de.png",
  logo: "/manus-storage/lawweaver-logo_d7eb1340.png",
};

const statusText: Record<RuleStatus, string> = {
  complete: "成立",
  fragmented: "殘句",
  locked: "封鎖",
};

const statusClass: Record<RuleStatus, string> = {
  complete: "status-active",
  fragmented: "status-fragment",
  locked: "status-locked",
};

type TutorialStep = "offer" | "observe" | "detach" | "cross" | "door" | "replay" | "off";
type FontSizePreference = "small" | "standard" | "large";
type ConsoleDensityPreference = "compact" | "standard" | "relaxed";
type ReadingPreferences = { fontSize: FontSizePreference; consoleDensity: ConsoleDensityPreference };
const defaultReadingPreferences: ReadingPreferences = { fontSize: "standard", consoleDensity: "standard" };
const directionRecommendation = () => {
  const portrait = window.innerHeight > window.innerWidth;
  const handheld = Math.min(window.innerWidth, window.innerHeight) <= 850;
  if (portrait) return handheld ? "建議改為橫向遊玩：大地圖會更完整，規則與控制台也有更寬的操作空間。" : "建議改為橫向視窗：可獲得最完整的棋盤視野與雙側資訊配置。";
  return handheld ? "目前為推薦的橫向遊玩方向：大地圖與操作台會保有最佳可視範圍。" : "目前方向適合完整遊玩；可使用「最大化棋盤」快速專注地圖。";
};

const tutorialIndex: Partial<Record<TutorialStep, number>> = {
  observe: 1,
  detach: 2,
  cross: 3,
  door: 4,
  replay: 5,
};

type EditorKind = "player" | "door" | "wall" | "ember" | "tide";
const editorKinds: Array<{ id: EditorKind; label: string }> = [
  { id: "player", label: "行者" }, { id: "door", label: "門印" }, { id: "wall", label: "壁垣" }, { id: "ember", label: "焰流" }, { id: "tide", label: "潮體" },
];
const editorAssetSpecs: Record<EditorKind, { title: string; model: string; subtitle: string; parts: string[]; glyph: string }> = {
  player: { title: "行者", model: "英雄紙藝・提燈行者", subtitle: "主角模型含貼地陰影；移動位置會沿棋盤表面校正。", parts: ["英雄剪影", "提燈", "貼地陰影"], glyph: "行" },
  door: { title: "門印", model: "裂界傳送門・石質基座", subtitle: "符文環、虛空核心與火花皆以石質基座為接地根節點。", parts: ["石質基座", "符文環", "裂界核心"], glyph: "門" },
  wall: { title: "壁垣", model: "紙雕壁壘・層疊石構", subtitle: "不依賴外部單張貼圖；由紙石層、苔縫、扣件與拱門組成。", parts: ["紙石層", "苔縫", "金屬扣件", "拱門"], glyph: "壁" },
  ember: { title: "焰流", model: "焰流紙藝・危險阻擋", subtitle: "成立規則前為必經阻擋，結算後保留透明的可追溯模型。", parts: ["焰心", "火舌", "餘燼"], glyph: "焰" },
  tide: { title: "潮體", model: "潮體紙藝・流線阻擋", subtitle: "模型的波峰與水紋由棋盤表面起算，結算後轉為可穿越狀態。", parts: ["潮峰", "水紋", "泡沫"], glyph: "潮" },
};
const editorLightingOptions: Array<{ id: EditorLighting; label: string; hint: string }> = [{ id: "day", label: "晨光", hint: "高辨識" }, { id: "dusk", label: "暮光", hint: "暖色陰影" }, { id: "void", label: "裂界", hint: "低光特效" }];
const defaultEditorEnvironment = { chapter: 1, lighting: "day" as EditorLighting };
const readImage = (file: File) => new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(new Error("圖片讀取失敗。")); reader.onload = () => resolve(String(reader.result)); reader.readAsDataURL(file); });
const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error("圖片無法解碼。")); image.src = src; });
async function prepareCustomNounAsset(file: File, noun: string, position: GridPoint): Promise<CustomNounAsset> {
  if (!file.type.startsWith("image/") || file.size > 2_000_000) throw new Error("請上傳 2 MB 以下的 PNG、WebP 或 JPEG 圖片。\n");
  if (!noun.trim() || noun.trim().length > 12) throw new Error("自訂詞彙名稱需為 1 至 12 個字。\n");
  const image = await loadImage(await readImage(file)); let width = Math.min(512, image.naturalWidth); let height = Math.max(1, Math.round(image.naturalHeight * (width / image.naturalWidth))); let dataUrl = ""; let removedPixels = 0; let foregroundRatio = 0;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true }); if (!context) throw new Error("瀏覽器無法建立圖片檢查畫布。\n");
    context.drawImage(image, 0, 0, width, height); const pixels = context.getImageData(0, 0, width, height); removedPixels = 0;
    for (let index = 0; index < pixels.data.length; index += 4) { const r = pixels.data[index]!, g = pixels.data[index + 1]!, b = pixels.data[index + 2]!, a = pixels.data[index + 3]!; const lightness = Math.max(r, g, b); const saturation = lightness - Math.min(r, g, b); if (a < 10 || (lightness > 198 && saturation < 34) || (lightness > 238 && saturation < 58)) { pixels.data[index + 3] = 0; removedPixels += 1; } }
    context.putImageData(pixels, 0, 0); foregroundRatio = (width * height - removedPixels) / (width * height); dataUrl = canvas.toDataURL("image/png");
    if (dataUrl.length <= 92_000) break; width = Math.max(64, Math.floor(width * 0.76)); height = Math.max(64, Math.floor(height * 0.76));
  }
  if (foregroundRatio < 0.04 || foregroundRatio > 0.9 || removedPixels < 1) throw new Error("自動去背未能辨識清楚前景；請使用淺色或純白背景重新上傳。\n");
  if (dataUrl.length > 96_000) throw new Error("圖片去背後仍超過分享限制；請使用更簡潔的圖像。\n");
  return { id: `custom-${Date.now()}`, noun: noun.trim(), dataUrl, position, width, height, foregroundRatio, removedPixels };
}
const samePoint = (a: GridPoint, b: GridPoint) => a.x === b.x && a.y === b.y;
const formatDuration = (ms: number) => `${String(Math.floor(Math.max(0, ms) / 60000)).padStart(2, "0")}:${String(Math.floor(Math.max(0, ms) / 1000) % 60).padStart(2, "0")}`;
const formatShortDuration = (ms: number) => {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  return seconds >= 60 ? `${Math.floor(seconds / 60)}分${seconds % 60}秒` : `${seconds}秒`;
};

const chapterNames: Record<number, string> = {
  1: "接口入門", 2: "距離觀測", 3: "時序推理", 4: "雙線閱讀", 5: "複合語句",
  6: "優先裁決", 7: "影跡映照", 8: "高密織界", 9: "編織試煉", 10: "無界之門",
};

function Tile({ children, accent = false, draggable = false, onClick }: {
  children: ReactNode;
  accent?: boolean;
  draggable?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      className={`rule-tile ${accent ? "rule-tile-accent" : ""}`}
      draggable={draggable}
      onDragStart={(event) => event.dataTransfer.setData("text/lawweaver-rule", "隔離作用")}
      onClick={onClick}
      aria-label={typeof children === "string" ? children : "規則片"}
      type="button"
    >
      {children}
    </button>
  );
}

function RuleStatusDot({ status }: { status: RuleStatus }) {
  return <span className={`status-dot ${statusClass[status]}`}>{statusText[status]}</span>;
}

export function GameOverlay({ world, camera, frameHealth }: { world: GameWorld; camera: GameHandle | null; frameHealth: FrameHealth }) {
  const [view, setView] = useState<WorldView>(() => world.getView());
  const canExecuteRule = world.canResolveActiveRule();
  const requiredChallenges = requiredChallengesFor(world.getLevel());
  const activeChallenge = requiredChallenges[view.activeRuleIndex] ?? requiredChallenges.at(-1);
  const remainingChallenges = requiredChallenges.filter((challenge) => !view.resolvedRules.includes(challenge.title));
  const currentObjective = view.ruleResolved ? view.objective : activeChallenge?.prompt ?? view.objective;
  const activeBlocker = activeChallenge?.blocker ?? "壁垣";
  const activeCounterpart = activeChallenge?.entities.find((noun) => ![activeBlocker, "行者", "門印"].includes(noun));
  const activeRuleDone = activeChallenge ? view.resolvedRules.includes(activeChallenge.title) : view.ruleResolved;
  const [isGuideOpen, setGuideOpen] = useState(false);
  const [mode, setMode] = useState<"play" | "editor">("play");
  const [draft, setDraft] = useState<LevelDefinition>(() => ({ ...world.getLevel(), walls: world.getLevel().walls.map((point) => ({ ...point })) }));
  const [selectedEditorKind, setSelectedEditorKind] = useState<EditorKind>("wall");
  const [shareCode, setShareCode] = useState("");
  const [editorNotice, setEditorNotice] = useState("選擇物件後點棋盤格放置；壁垣再次點選即可移除。");
  const [editorValidation, setEditorValidation] = useState<EditorSolvabilityReport | null>(null);
  const [customNounName, setCustomNounName] = useState("");
  const [assetBusy, setAssetBusy] = useState(false);
  const [draggedAssetId, setDraggedAssetId] = useState<string | null>(null);
  const [progress, setProgress] = useState<string[]>(() => { const preview = new URLSearchParams(window.location.search).get("completed"); return preview ? campaignLevels.filter((level) => preview.split(",").includes(String(level.order))).map((level) => level.id) : JSON.parse(window.localStorage.getItem("lawweaver-progress") || "[]"); });
  const [records, setRecords] = useState<Record<string, PersonalRecord>>(() => JSON.parse(window.localStorage.getItem("lawweaver-records") || "{}"));
  const recordedFinish = useRef<string | null>(null);
  const [isFocusMode, setFocusMode] = useState(() => window.localStorage.getItem("lawweaver-focus-mode") === "true");
  const [isSettingsOpen, setSettingsOpen] = useState(false);
  const [readingPreferences, setReadingPreferences] = useState<ReadingPreferences>(() => {
    try { return { ...defaultReadingPreferences, ...JSON.parse(window.localStorage.getItem("lawweaver-reading-preferences") || "{}") }; } catch { return defaultReadingPreferences; }
  });
  const [qualityRecommendation, setQualityRecommendation] = useState<RenderQualityRecommendation>(() => recommendRenderQuality(readDevicePerformanceSignals()));
  const [renderQuality, setRenderQuality] = useState<RenderQuality>(() => {
    const saved = window.localStorage.getItem("lawweaver-render-quality");
    return saved === "balanced" ? "balanced" : "high";
  });
  const [isRenderQualityManual, setRenderQualityManual] = useState(() => ["balanced", "high"].includes(window.localStorage.getItem("lawweaver-render-quality") || ""));
  const [showFpsWidget, setShowFpsWidget] = useState(() => window.localStorage.getItem("lawweaver-show-fps") !== "false");
  const [slowDeviceWarningOpen, setSlowDeviceWarningOpen] = useState(false);
  const slowDeviceWarningCooldown = useRef(0);
  const [isDiagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [isMobileConsoleCollapsed, setMobileConsoleCollapsed] = useState(false);
  const mobileConsoleTouchY = useRef<number | null>(null);
  const [orientationAdvice, setOrientationAdvice] = useState(() => window.localStorage.getItem("lawweaver-orientation-advice-seen") !== "true" ? directionRecommendation() : "");
  const [mobilePanel, setMobilePanel] = useState<"rules" | "objects" | "camera">("rules");
  const [isLevelPickerOpen, setLevelPickerOpen] = useState(() => new URLSearchParams(window.location.search).has("jumpMenu"));
  const [isChapterSummaryOpen, setChapterSummaryOpen] = useState(() => new URLSearchParams(window.location.search).has("chapterSummary"));
  const [cameraView, setCameraView] = useState<{ height: number; zoom: number }>(() => { const saved = JSON.parse(window.localStorage.getItem("lawweaver-camera") || "{\"height\":0.45,\"zoom\":0.47}"); return new URLSearchParams(window.location.search).has("cameraFar") ? { ...saved, zoom: 1 } : saved; });
  const [desktopPanel, setDesktopPanel] = useState<"closed" | "rules" | "inspector" | "both">(() => {
    const requested = new URLSearchParams(window.location.search).get("desktopPanels");
    if (requested === "rules" || requested === "inspector" || requested === "both") return requested;
    const saved = window.localStorage.getItem("lawweaver-desktop-panel-v2");
    return saved === "rules" || saved === "inspector" || saved === "both" ? saved : "closed";
  });
  const mobileWalkPreview = new URLSearchParams(window.location.search).has("mobileWalk");
  const [isTutorialReceded, setTutorialReceded] = useState(() => new URLSearchParams(window.location.search).has("recedeTutorial"));
  const tutorialIdleTimer = useRef<number | null>(null);
  const previousPlayer = useRef({ ...world.getView().player });
  const [finalePhase, setFinalePhase] = useState<"intro" | "reveal">("intro");
  const finalePreview = new URLSearchParams(window.location.search).has("finalePreview");
  const isFinalClear = finalePreview || (view.finished && view.levelOrder === view.totalLevels && progress.length >= view.totalLevels - 1);
  const isDailyChallenge = view.levelId.startsWith("DAILY-");
  const [dailyNow, setDailyNow] = useState(() => new Date());
  const [dailyReminderEnabled, setDailyReminderEnabled] = useState(() => window.localStorage.getItem("lawweaver-daily-reminder") === "true");
  const [dailyReminderStatus, setDailyReminderStatus] = useState<"idle" | "enabled" | "unsupported" | "denied">("idle");
  const dailyReminderDate = useRef<string | null>(null);
  const dailyCountdown = getDailyCountdown(dailyNow);
  const [tutorialStep, setTutorialStep] = useState<TutorialStep>(() => {
    const params = new URLSearchParams(window.location.search);
    const previewStep = params.get("tutorial");
    const previewSteps: TutorialStep[] = ["offer", "observe", "detach", "cross", "door", "replay"];
    if (world.getLevel().order !== 1 || params.has("skipTutorial")) return "off";
    if (previewStep && previewSteps.includes(previewStep as TutorialStep)) return previewStep as TutorialStep;
    return window.localStorage.getItem("lawweaver-tutorial-seen") ? "off" : "offer";
  });

  useEffect(() => world.subscribe(() => setView(world.getView())), [world]);
  useEffect(() => {
    const refreshOrientationAdvice = () => {
      if (window.localStorage.getItem("lawweaver-orientation-advice-seen") !== "true") setOrientationAdvice(directionRecommendation());
    };
    window.addEventListener("resize", refreshOrientationAdvice);
    return () => window.removeEventListener("resize", refreshOrientationAdvice);
  }, []);
  useEffect(() => { window.localStorage.setItem("lawweaver-reading-preferences", JSON.stringify(readingPreferences)); }, [readingPreferences]);
  useEffect(() => { window.localStorage.setItem("lawweaver-desktop-panel-v2", desktopPanel); }, [desktopPanel]);
  useEffect(() => { window.localStorage.setItem("lawweaver-render-quality", renderQuality); camera?.setRenderQuality(renderQuality); }, [camera, renderQuality]);
  useEffect(() => { window.localStorage.setItem("lawweaver-show-fps", String(showFpsWidget)); }, [showFpsWidget]);
  useEffect(() => {
    if (frameHealth.sustainedJank && renderQuality === "high" && Date.now() >= slowDeviceWarningCooldown.current) setSlowDeviceWarningOpen(true);
  }, [frameHealth.sustainedJank, renderQuality]);
  useEffect(() => {
    const refreshQualityRecommendation = () => {
      const next = recommendRenderQuality(readDevicePerformanceSignals());
      setQualityRecommendation(next);
      if (!isRenderQualityManual) setRenderQuality(next.quality);
    };
    window.addEventListener("resize", refreshQualityRecommendation);
    return () => window.removeEventListener("resize", refreshQualityRecommendation);
  }, [isRenderQualityManual]);
  useEffect(() => {
    const desktopSafeZoom = desktopPanel === "closed" ? cameraView.zoom : Math.max(cameraView.zoom, 0.68);
    camera?.setCamera(cameraView.height, desktopSafeZoom);
    window.localStorage.setItem("lawweaver-camera", JSON.stringify(cameraView));
  }, [camera, cameraView, desktopPanel]);
  useEffect(() => {
    if (!isFinalClear) return;
    setFinalePhase("intro");
    const timer = window.setTimeout(() => setFinalePhase("reveal"), 4200);
    return () => window.clearTimeout(timer);
  }, [isFinalClear, view.levelId]);
  useEffect(() => {
    if (!isDailyChallenge || !dailyReminderEnabled) return;
    const nextDate = dailyChallengeDateKey(new Date(Date.now() + 86400000));
    if (dailyCountdown.remainingMs > 1500 || dailyReminderDate.current === nextDate) return;
    dailyReminderDate.current = nextDate;
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification("界律編織者｜明日織界已開放", { body: "新的每日挑戰已經準備好了，回來試試今天的規則。" });
    }
  }, [dailyCountdown.remainingMs, dailyReminderEnabled, isDailyChallenge]);
  useEffect(() => {
    if (!isDailyChallenge) return;
    const tick = () => {
      const now = new Date();
      setDailyNow(now);
      if (dailyChallengeDateKey(now) !== dailyChallengeDateLabel(world.getLevel())) world.loadLevel(createDailyChallenge(now));
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [isDailyChallenge, world]);

  useEffect(() => {
    if (!view.finished || view.levelOrder <= 0 || progress.includes(view.levelId)) return;
    const next = [...progress, view.levelId];
    setProgress(next);
    window.localStorage.setItem("lawweaver-progress", JSON.stringify(next));
  }, [view.finished, view.levelId, progress]);
  useEffect(() => {
    if (!view.finished) { recordedFinish.current = null; return; }
    const finishKey = `${view.levelId}:${view.turn}:${view.elapsedMs}`;
    if (recordedFinish.current === finishKey) return;
    recordedFinish.current = finishKey;
    setRecords((current) => {
      const old = current[view.levelId];
      const next: PersonalRecord = { bestSteps: old ? Math.min(old.bestSteps, view.turn) : view.turn, bestTimeMs: old ? Math.min(old.bestTimeMs, view.elapsedMs) : view.elapsedMs, completions: (old?.completions || 0) + 1 };
      const all = { ...current, [view.levelId]: next };
      window.localStorage.setItem("lawweaver-records", JSON.stringify(all));
      return all;
    });
  }, [view.finished, view.levelId, view.turn, view.elapsedMs]);

  useEffect(() => {
    if (tutorialStep === "detach" && view.ruleResolved) setTutorialStep("cross");
    if (tutorialStep === "cross" && view.player.y <= 2) setTutorialStep("door");
    if (tutorialStep === "door" && view.finished) setTutorialStep("replay");
  }, [tutorialStep, view.barrierStatus, view.finished, view.player.y]);

  const restoreTutorial = () => {
    if (tutorialIdleTimer.current !== null) window.clearTimeout(tutorialIdleTimer.current);
    tutorialIdleTimer.current = null;
    setTutorialReceded(false);
  };

  const recedeTutorialForMovement = () => {
    if (tutorialStep !== "cross" && tutorialStep !== "door") return;
    setTutorialReceded(true);
    if (tutorialIdleTimer.current !== null) window.clearTimeout(tutorialIdleTimer.current);
    tutorialIdleTimer.current = window.setTimeout(() => {
      tutorialIdleTimer.current = null;
      setTutorialReceded(false);
    }, 1400);
  };

  useEffect(() => {
    const playerMoved = previousPlayer.current.x !== view.player.x || previousPlayer.current.y !== view.player.y;
    previousPlayer.current = { ...view.player };
    if (playerMoved) recedeTutorialForMovement();
  }, [tutorialStep, view.player.x, view.player.y]);

  useEffect(() => {
    if (tutorialStep !== "cross" && tutorialStep !== "door") restoreTutorial();
  }, [tutorialStep]);

  useEffect(() => () => {
    if (tutorialIdleTimer.current !== null) window.clearTimeout(tutorialIdleTimer.current);
  }, []);

  const launchTutorial = () => {
    restoreTutorial();
    world.reset();
    setTutorialStep("observe");
  };

  const leaveTutorial = (resetWorld = true) => {
    restoreTutorial();
    if (resetWorld) world.reset();
    window.localStorage.setItem("lawweaver-tutorial-seen", "true");
    setTutorialStep("off");
  };

  const openEditor = () => {
    setDraft({ ...world.getLevel(), id: "custom-draft", name: "我的織界", author: "", thumbnailStyle: "mist", concept: "自訂關卡", editorEnvironment: defaultEditorEnvironment, customAssets: [], walls: world.getLevel().walls.map((point) => ({ ...point })) });
    setEditorValidation(null); setCustomNounName("");
    setFinalePhase("reveal");
    setTutorialStep("off");
    setMode("editor");
  };
  const enableDailyReminder = async () => {
    if (typeof Notification === "undefined") { setDailyReminderStatus("unsupported"); return; }
    const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
    if (permission !== "granted") { setDailyReminderEnabled(false); window.localStorage.removeItem("lawweaver-daily-reminder"); setDailyReminderStatus("denied"); return; }
    setDailyReminderEnabled(true); window.localStorage.setItem("lawweaver-daily-reminder", "true"); setDailyReminderStatus("enabled");
  };
  const playDailyChallenge = () => {
    const now = new Date();
    setDailyNow(now);
    world.loadLevel(createDailyChallenge(now));
    setTutorialStep("off");
    setLevelPickerOpen(false);
    setChapterSummaryOpen(false);
    setMode("play");
  };
  const updateDraftCell = (point: GridPoint) => {
    setDraft((current) => selectedEditorKind === "wall"
      ? { ...current, walls: current.walls.some((wall) => samePoint(wall, point)) ? current.walls.filter((wall) => !samePoint(wall, point)) : [...current.walls, point] }
      : { ...current, [selectedEditorKind]: point });
  };
  const testDraft = () => {
    try {
      assertNoDuplicateRequiredRules(draft);
      const report = analyzeEditorSolvability(draft);
      if (report.issues.length) { setEditorValidation(report); setEditorNotice("可解性驗證未通過；請先處理下方問題。\n"); return; }
      world.loadLevel({ ...draft, id: `custom-${Date.now()}`, chapter: 0, order: 0, objective: draft.objective || "隔離「隔離作用」，再讓行者碰到門印。" });
      setMode("play");
    } catch (error) { setEditorNotice(error instanceof Error ? error.message : "關卡規則檢查失敗。"); }
  };
  const makeShareCode = () => {
    try {
      assertNoDuplicateRequiredRules(draft);
      const code = exportLevelCode({ ...draft, id: "shared", chapter: 0, order: 0 });
      setShareCode(code);
      navigator.clipboard?.writeText(code).catch(() => undefined);
      setEditorNotice("分享碼已產生；可直接傳給朋友，或讓朋友貼到下方匯入。\n");
    } catch (error) { setEditorNotice(error instanceof Error ? error.message : "無法產生分享碼。"); }
  };
  const loadShareCode = () => {
    try { world.loadLevel(importLevelCode(shareCode.trim())); setMode("play"); }
    catch (error) { setEditorNotice(error instanceof Error ? error.message : "分享碼無法讀取。\n"); }
  };
  const verifyDraft = () => { const report = analyzeEditorSolvability(draft); setEditorValidation(report); setEditorNotice(report.issues.length ? "找到會讓自訂關卡無法完成的條件；請依可解性報告調整。" : `驗證通過：規則成立後可於 ${Math.max(0, report.pathLength - 1)} 步抵達門印；難度為 ${report.difficulty?.stars ?? 0} 星。`); };
  const applyEditorEnvironment = (chapter: number, lighting: EditorLighting) => { const editorEnvironment = { chapter, lighting }; setDraft((current) => ({ ...current, editorEnvironment, chapter })); camera?.setEnvironment(chapter, lighting); };
  const addCustomAsset = async (file: File | undefined) => {
    if (!file) return; setAssetBusy(true);
    try {
      const occupied = new Set([draft.player, draft.door, draft.ember, draft.tide, ...draft.walls, ...(draft.hazards ?? []).map((hazard) => hazard.position)].map((point) => `${point.x},${point.y}`));
      const position = Array.from({ length: 49 }, (_, index) => ({ x: index % 7, y: Math.floor(index / 7) })).find((point) => !occupied.has(`${point.x},${point.y}`)) ?? { x: 3, y: 3 };
      const asset = await prepareCustomNounAsset(file, customNounName, position);
      setDraft((current) => ({ ...current, customAssets: [...(current.customAssets ?? []), asset], hazards: [...(current.hazards ?? []), { id: asset.id, noun: asset.noun, position: asset.position, blocked: false, resolvedState: "紙藝資產已貼地" }] }));
      setEditorNotice(`「${asset.noun}」已完成白灰底去背與完整性檢查，並放入第 ${position.x + 1} 欄、第 ${position.y + 1} 列。`); setCustomNounName("");
    } catch (error) { setEditorNotice(error instanceof Error ? error.message : "自訂資產處理失敗。\n"); } finally { setAssetBusy(false); }
  };
  const reorderCustomAsset = (sourceId: string, targetId: string) => {
    if (sourceId === targetId) return;
    setDraft((current) => {
      const assets = [...(current.customAssets ?? [])];
      const sourceIndex = assets.findIndex((asset) => asset.id === sourceId);
      const targetIndex = assets.findIndex((asset) => asset.id === targetId);
      if (sourceIndex < 0 || targetIndex < 0) return current;
      const [source] = assets.splice(sourceIndex, 1);
      assets.splice(targetIndex, 0, source!);
      const customIds = new Set(assets.map((asset) => asset.id));
      const priorHazards = new Map((current.hazards ?? []).filter((hazard) => customIds.has(hazard.id)).map((hazard) => [hazard.id, hazard]));
      const fixedHazards = (current.hazards ?? []).filter((hazard) => !customIds.has(hazard.id));
      return { ...current, customAssets: assets, hazards: [...fixedHazards, ...assets.map((asset) => priorHazards.get(asset.id)!).filter(Boolean)] };
    });
    setEditorNotice("自訂資產順序已更新；預覽、測試關卡與分享碼會使用相同順序。");
  };
  const removeCustomAsset = (assetId: string) => {
    setDraft((current) => ({ ...current, customAssets: (current.customAssets ?? []).filter((asset) => asset.id !== assetId), hazards: (current.hazards ?? []).filter((hazard) => hazard.id !== assetId) }));
    setEditorNotice("已刪除自訂資產及其對應棋盤元件；請再次執行可解性驗證。\n");
  };
  const nextLevel = () => {
    const next = campaignLevels[view.levelOrder];
    world.loadLevel(next ?? campaignLevels[0]);
  };
  const railStart = Math.floor(Math.max(0, view.levelOrder - 1) / 5) * 5;
  const completedLevels = campaignLevels.filter((level) => progress.includes(level.id));
  const jumpToCompleted = (level: LevelDefinition) => { if (progress.includes(level.id)) { world.loadLevel(level); setLevelPickerOpen(false); } };
  const railLevels = campaignLevels.slice(railStart, railStart + 5);
  const currentRecord = records[view.levelId];
  const chapterSummaries = Array.from({ length: 10 }, (_, index) => {
    const chapter = index + 1;
    const levels = campaignLevels.filter((level) => level.chapter === chapter);
    const completed = levels.filter((level) => progress.includes(level.id));
    const scored = completed.filter((level) => records[level.id]);
    const bestSteps = scored.reduce((total, level) => total + records[level.id].bestSteps, 0);
    return {
      chapter,
      title: chapterNames[chapter],
      total: levels.length,
      completed: completed.length,
      scored: scored.length,
      bestSteps,
      completionRate: levels.length ? Math.round((completed.length / levels.length) * 100) : 0,
    };
  });
  const totalCompleted = chapterSummaries.reduce((total, chapter) => total + chapter.completed, 0);
  const totalScored = chapterSummaries.reduce((total, chapter) => total + chapter.scored, 0);
  const totalBestSteps = chapterSummaries.reduce((total, chapter) => total + chapter.bestSteps, 0);
  const draftPresentNames = new Set(["行者", "門印", "焰流", "潮體", ...(draft.walls.length ? ["壁垣"] : [])]);
  const editorMissingNames = (draft.challenge?.entities ?? []).filter((name) => !draftPresentNames.has(name));
  const selectedAsset = editorAssetSpecs[selectedEditorKind];
  const toggleFocus = () => setFocusMode((current) => { const next = !current; window.localStorage.setItem("lawweaver-focus-mode", String(next)); return next; });
  const applyRenderQuality = (quality: RenderQuality, manual = true) => { setRenderQuality(quality); setRenderQualityManual(manual); };
  const applyRecommendedQuality = () => applyRenderQuality(qualityRecommendation.quality, false);
  const suggestedLowerQuality: RenderQuality = "balanced";
  const acceptSlowDeviceWarning = () => { applyRenderQuality(suggestedLowerQuality); setSlowDeviceWarningOpen(false); slowDeviceWarningCooldown.current = Date.now() + 60_000; };
  const dismissSlowDeviceWarning = () => { setSlowDeviceWarningOpen(false); slowDeviceWarningCooldown.current = Date.now() + 5 * 60_000; };
  const fpsStatus = frameHealth.sampleDurationMs < 1000 ? "sampling" : frameHealth.averageFps >= 52 ? "steady" : frameHealth.averageFps >= 35 ? "strained" : "slow";
  const fpsStatusLabel = fpsStatus === "sampling" ? "取樣中" : fpsStatus === "steady" ? "穩定" : fpsStatus === "strained" ? "負載中" : "卡頓";
  const requestedDesktopPanel = new URLSearchParams(window.location.search).get("desktopPanels");
  const effectiveDesktopPanel = requestedDesktopPanel === "closed" || requestedDesktopPanel === "rules" || requestedDesktopPanel === "inspector" || requestedDesktopPanel === "both" ? requestedDesktopPanel : desktopPanel;
  const desktopRulesOpen = effectiveDesktopPanel === "rules" || effectiveDesktopPanel === "both";
  const desktopInspectorOpen = effectiveDesktopPanel === "inspector" || effectiveDesktopPanel === "both";
  const toggleDesktopPanel = (panel: "rules" | "inspector") => setDesktopPanel((current) => current === panel ? "closed" : panel);

  const handleDrop = (event: React.DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (event.dataTransfer.getData("text/lawweaver-rule") === "隔離作用") world.detachBarrier();
  };

  const directionButton = (direction: Direction, label: string) => (
    <button className={`dpad-button dpad-${direction}`} onClick={() => { recedeTutorialForMovement(); world.move(direction); }} type="button" aria-label={label}>
      {direction === "up" && <ChevronUp size={18} />}
      {direction === "down" && <ChevronDown size={18} />}
      {direction === "left" && <span>←</span>}
      {direction === "right" && <span>→</span>}
    </button>
  );

  return (
    <div className={`game-overlay ${orientationAdvice ? "orientation-advice-active" : ""} ${isMobileConsoleCollapsed ? "mobile-console-collapsed" : ""} text-size-${readingPreferences.fontSize} console-density-${readingPreferences.consoleDensity} desktop-panel-${effectiveDesktopPanel} ${tutorialStep !== "off" ? "tutorial-active" : ""} ${isFocusMode ? "focus-mode" : ""} tutorial-step-${tutorialStep} ${(view.ruleResolved && tutorialStep === "off") || mobileWalkPreview ? "mobile-walk-mode" : ""}`}>
      {orientationAdvice && <aside className="orientation-advice glass-panel" role="status"><span><b>建議遊玩方向</b>{orientationAdvice}</span><button onClick={() => { window.localStorage.setItem("lawweaver-orientation-advice-seen", "true"); setOrientationAdvice(""); }} type="button" aria-label="關閉方向建議">×</button></aside>}
      <header className="game-header">
        <div className="brand-lockup">
          <img src={resolveAssetUrl(ASSETS.logo)} alt="界律編織者標誌" className="brand-logo" />
          <div>
            <p className="eyebrow">LAWWEAVER / 織界檔案 01</p>
            <h1>界<span className="law-mark">律</span>編織者</h1>
          </div>
        </div>
        <div className="header-meta">
          <span className="chapter-badge">第一章　{view.levelName}</span>
          <button className="turn-badge level-jump-trigger" disabled={!completedLevels.length} onClick={() => setLevelPickerOpen((open) => !open)} type="button" aria-expanded={isLevelPickerOpen}>{view.levelOrder || "自訂"} / {view.totalLevels}<span aria-hidden="true">⌄</span></button>
          {isLevelPickerOpen && (
            <div className="completed-level-menu" role="menu">
              <b>已過關・直接跳關</b>
              {completedLevels.map((level) => {
                const record = records[level.id];
                return (
                  <button key={`jump-${level.id}`} onClick={() => jumpToCompleted(level)} type="button" role="menuitem" aria-label={`${level.name}${record ? `，最佳 ${record.bestSteps} 步，最短 ${formatDuration(record.bestTimeMs)}` : "，尚無已保存成績"}`}>
                    <span className="completed-level-order">{String(level.order).padStart(2, "0")}</span>
                    <span className="completed-level-details"><strong>{level.name}</strong><small>{record ? <>最佳 <b>{record.bestSteps} 步</b><i>·</i>最短 <b>{formatDuration(record.bestTimeMs)}</b></> : "尚無已保存成績"}</small></span>
                  </button>
                );
              })}
            </div>
          )}
          <div className="desktop-panel-actions" role="group" aria-label="桌機資訊面板">
            <button className={desktopRulesOpen ? "is-selected" : ""} onClick={() => toggleDesktopPanel("rules")} type="button" aria-pressed={desktopRulesOpen}>規則</button>
            <button className={desktopInspectorOpen ? "is-selected" : ""} onClick={() => toggleDesktopPanel("inspector")} type="button" aria-pressed={desktopInspectorOpen}>因果</button>
          </div>
          <button className="tutorial-reopen chapter-summary-trigger" onClick={() => { setLevelPickerOpen(false); setChapterSummaryOpen(true); }} type="button" aria-haspopup="dialog" aria-expanded={isChapterSummaryOpen}><BarChart3 size={14} />成績</button>
          <button className="tutorial-reopen daily-challenge-trigger" onClick={playDailyChallenge} type="button" title="每日織界採UTC日期固定種子生成；同日所有玩家面對相同且可解的獨立題目。"><Sparkles size={14} />每日織界</button>
          <button className="tutorial-reopen" onClick={openEditor} type="button"><PencilRuler size={14} />編輯器</button>
          <button className="tutorial-reopen" onClick={launchTutorial} type="button"><BookOpen size={14} />教學</button>
          <button className="tutorial-reopen board-maximize-header" onClick={toggleFocus} type="button">{isFocusMode ? <Minimize2 size={14} /> : <Focus size={14} />}{isFocusMode ? "還原介面" : "最大化棋盤"}</button>
          <button className="tutorial-reopen settings-trigger" onClick={() => setSettingsOpen((open) => !open)} type="button" aria-expanded={isSettingsOpen} aria-haspopup="dialog"><Settings2 size={14} />設定</button>
          {isSettingsOpen && <section className="reading-settings glass-panel" role="dialog" aria-label="閱讀、效能與控制台設定">
            <div className="reading-settings-heading"><div><p className="eyebrow">個人化遊玩</p><b>閱讀、效能與控制台</b></div><button onClick={() => setSettingsOpen(false)} type="button" aria-label="關閉設定">×</button></div>
            <p>偏好會儲存在此裝置；畫質切換不會改變規則或關卡解法。</p>
            <div className="quality-recommendation"><span><b>自動建議：{qualityRecommendation.label}</b><small>{qualityRecommendation.reasons.join("・")}</small></span><button onClick={applyRecommendedQuality} type="button">{isRenderQualityManual ? "採用建議" : "自動套用中"}</button></div>
            <div className="reading-setting-row"><span>手機畫質</span><div className="quality-tier-control">{(["balanced", "high"] as const).map((quality) => <button className={renderQuality === quality ? "is-selected" : ""} onClick={() => applyRenderQuality(quality)} key={quality} type="button">{quality === "high" ? "精細紙雕" : "平衡紙雕"}</button>)}</div></div>
            <div className="reading-setting-row"><span>FPS 顯示</span><div className="fps-setting-control"><button className={showFpsWidget ? "is-selected" : ""} onClick={() => setShowFpsWidget((shown) => !shown)} type="button">{showFpsWidget ? "顯示中・點此隱藏" : "已隱藏・點此顯示"}</button></div></div>
            <div className="reading-setting-row"><span>字體大小</span><div>{(["small", "standard", "large"] as const).map((size) => <button className={readingPreferences.fontSize === size ? "is-selected" : ""} onClick={() => setReadingPreferences((current) => ({ ...current, fontSize: size }))} key={size} type="button">{size === "small" ? "小" : size === "large" ? "大" : "標準"}</button>)}</div></div>
            <div className="reading-setting-row"><span>控制台密度</span><div>{(["compact", "standard", "relaxed"] as const).map((density) => <button className={readingPreferences.consoleDensity === density ? "is-selected" : ""} onClick={() => setReadingPreferences((current) => ({ ...current, consoleDensity: density }))} key={density} type="button">{density === "compact" ? "緊湊" : density === "relaxed" ? "寬鬆" : "標準"}</button>)}</div></div>
            <button className="diagnostics-open" onClick={() => { setDiagnosticsOpen(true); setSettingsOpen(false); }} type="button"><Info size={13} />開啟裝置診斷</button>
          </section>}
        </div>
      </header>

      <button className="board-maximize-fab" onClick={toggleFocus} type="button" aria-label={isFocusMode ? "還原介面" : "最大化棋盤"}>{isFocusMode ? <Minimize2 size={17} /> : <Focus size={17} />}<span>{isFocusMode ? "還原" : "最大化棋盤"}</span></button>
      {isDailyChallenge && <div className="daily-countdown" role="status" aria-label={`明日挑戰將在 ${dailyCountdown.label} 後更新，UTC午夜切換`}><span>明日織界</span><b>{dailyCountdown.label}</b><small>UTC 00:00 更新</small><button className="daily-reminder-mini" onClick={enableDailyReminder} type="button">{dailyReminderEnabled ? "提醒已開啟" : "開啟提醒"}</button></div>}
      {showFpsWidget && <output className={`fps-widget fps-${fpsStatus}`} aria-label={`目前效能：${fpsStatusLabel}${frameHealth.sampleDurationMs >= 1000 ? `，${frameHealth.averageFps} FPS` : ""}`}><b>{frameHealth.sampleDurationMs >= 1000 ? frameHealth.averageFps : "—"}</b><span>FPS</span><small>{fpsStatusLabel}</small></output>}
      {slowDeviceWarningOpen && <aside className="slow-device-warning glass-panel" role="alert"><span><b>偵測到持續卡頓</b><small>近四秒約 {frameHealth.averageFps} FPS；切換平衡紙雕不會影響規則或進度。</small></span><button className="slow-device-apply" onClick={acceptSlowDeviceWarning} type="button">切換至平衡紙雕</button><button className="slow-device-dismiss" onClick={dismissSlowDeviceWarning} type="button">稍後再說</button></aside>}
      {isDiagnosticsOpen && <section className="device-diagnostics glass-panel" role="dialog" aria-label="裝置診斷"><div className="reading-settings-heading"><div><p className="eyebrow">裝置診斷</p><b>目前遊玩狀態</b></div><button onClick={() => setDiagnosticsOpen(false)} type="button" aria-label="關閉裝置診斷">×</button></div><dl><div><dt>畫布</dt><dd>{camera ? "3D畫布已啟動" : "正在初始化"}</dd></div><div><dt>畫質</dt><dd>{camera?.getRenderQuality().label ?? "讀取中"}{isRenderQualityManual ? "・手動" : "・自動"}</dd></div><div><dt>效能</dt><dd>{frameHealth.sampleDurationMs < 1000 ? "正在取樣" : `${frameHealth.averageFps} FPS・慢幀 ${Math.round(frameHealth.slowFrameRatio * 100)}%`}</dd></div><div><dt>建議</dt><dd>{qualityRecommendation.label}・{qualityRecommendation.reasons.join("、")}</dd></div><div><dt>視窗</dt><dd>{window.innerWidth} × {window.innerHeight} ・{window.innerWidth > window.innerHeight ? "橫式" : "直式"}</dd></div><div><dt>介面</dt><dd>{Math.min(window.innerWidth, window.innerHeight) <= 850 || window.innerHeight <= 620 ? "行動裝置棋盤優先" : "寬螢幕工作桌"}</dd></div><div><dt>控制台</dt><dd>{isMobileConsoleCollapsed ? "已收合" : "已展開"} ・{readingPreferences.consoleDensity === "compact" ? "緊湊" : readingPreferences.consoleDensity === "relaxed" ? "寬鬆" : "標準"}</dd></div><div><dt>像素比例</dt><dd>{window.devicePixelRatio.toFixed(1)}×</dd></div></dl><p>若畫面仍不完整，請先改選「平衡紙雕」並重新整理；診斷資訊不會上傳。</p></section>}

      <section className="camera-dock glass-panel" aria-label="鏡頭控制">
        <button className="camera-focus" onClick={toggleFocus} type="button">{isFocusMode ? <Minimize2 size={15} /> : <Focus size={15} />}<span>{isFocusMode ? "結束專注" : "專注棋盤"}</span></button>
        <label><MoveVertical size={14} /><span>高度</span><input aria-label="鏡頭高度" type="range" min="0" max="100" value={Math.round(cameraView.height * 100)} onChange={(event) => setCameraView((current) => ({ ...current, height: Number(event.target.value) / 100 }))} /></label>
        <label><ZoomIn size={14} /><span>縮放</span><input aria-label="鏡頭縮放" type="range" min="0" max="100" value={Math.round(cameraView.zoom * 100)} onChange={(event) => setCameraView((current) => ({ ...current, zoom: Number(event.target.value) / 100 }))} /></label>
      </section>

      {desktopRulesOpen && <aside className={`rule-desk glass-panel ${tutorialStep === "detach" ? "tutorial-target" : ""}`} aria-label="界律臺">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">界律臺</p>
            <h2>{activeChallenge?.title ?? "規則工作列"}</h2>
          </div>
          <RuleStatusDot status={view.barrierStatus} />
        </div>

        <p className="desk-copy">{activeChallenge?.prompt ?? "推動、拆開或重新排列文字片；只有符合本關條件的完整規則才會改變地圖。"}</p>
        <div className="sentence-row rule-workline" aria-label="可重新組合的文字規則">
          {view.ruleBlocks.map((block, index) => <Tile accent={index === 0} key={`${block}-${index}`}>{block}</Tile>)}
        </div>

        <button
          className={`break-slot ${view.isolatedBlocks.length ? "is-filled" : ""}`}
          onClick={() => world.isolateRuleBlock()}
          type="button"
        >
          <ArrowDownToLine size={16} />
          {view.isolatedBlocks.length ? <span>{view.isolatedBlocks.join("、")}　·　接口已隔離</span> : <span>將最右文字片送入隔離器</span>}
        </button>
        <p className="slot-rationale">可推動、分離、重組或暫時封鎖文字片；目前規則需要的操作是「{activeChallenge?.requiredOperation ?? "assemble"}」。</p>

        <div className="rule-actions">
          <button className="small-action" onClick={() => world.pushRule("left")} type="button">← 推動</button>
          <button className="small-action" onClick={() => world.pushRule("right")} type="button">推動 →</button>
          <button className="small-action" onClick={() => world.restoreRuleBlock()} type="button">接回文字片</button>
          <button className="small-action" onClick={() => world.lockRuleBlock()} type="button"><LockKeyhole size={15} />封鎖片</button>
          <button className={`small-action rule-execute ${canExecuteRule ? "is-ready" : ""}`} onClick={() => world.resolveRule()} type="button" aria-label={canExecuteRule ? "規則已成立，執行規則" : "規則尚未成立，執行規則"}>{canExecuteRule ? "規則已成立 · 執行" : "執行規則"}</button>
        </div>

        <div className="rule-list" aria-label="其他可觀測規則">
          {view.rules.slice(1).map((rule) => (
            <div className="rule-list-row" key={rule.id}>
              <div className="rule-index">{rule.id}</div>
              <div>
                <p>{rule.label}</p>
                <span>{rule.kind}</span>
              </div>
              <RuleStatusDot status={rule.status} />
            </div>
          ))}
        </div>
      </aside>}

      <main className={`board-caption ${tutorialStep === "observe" ? "tutorial-target" : ""}`} aria-live="polite">
        <div className="board-label">織界 {view.levelOrder ? `#${String(view.levelOrder).padStart(2, "0")} / ${view.totalLevels}` : "自訂"}　07 × 07　遠端 ↑　近端 ↓</div>
        <div className="objective-card">
          <span>目標</span>
          <strong>{currentObjective}</strong>
          {view.levelOrder === 4 && <div className="board-key" aria-label="第四關棋盤物件圖例"><span className="key-ember">橙色焰柱＝焰流（堵住缺口）</span><span className="key-tide">藍色水盤＝潮體（門印前）</span></div>}
        </div>
        <div className="causal-toast">
          <span className="causal-pin" />
          {view.message}
        </div>
      </main>

      <div className="causal-thread" aria-hidden="true">
        <span className="thread-origin">{activeChallenge ? `${activeChallenge.subject} ${activeChallenge.verb} ${activeChallenge.predicate}` : "規則"}</span>
        <span className="thread-knot" />
        <span className="thread-destination">{activeChallenge?.blocker ?? "阻擋物"}</span>
      </div>

      {desktopInspectorOpen && <aside className="inspector glass-panel" aria-label="因果觀測">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">因果觀測</p>
            <h2>當前解析</h2>
          </div>
          <Info size={18} strokeWidth={1.7} />
        </div>
        <p className="map-object-strip">地圖元件：<b>{activeChallenge?.entities.join("、") ?? "行者、門印"}</b></p>
        <div className="object-statuses" aria-label="地圖物件狀態">
          <span className={activeRuleDone ? "status-ready" : "status-blocked"}>{activeBlocker}：{activeRuleDone ? "已轉化" : "阻擋中"}</span>
          {activeCounterpart && <span className={activeRuleDone ? "status-ready" : "status-blocked"}>{activeCounterpart}：{activeRuleDone ? "已回應" : "等待結算"}</span>}
          <span className={view.ruleResolved ? "status-ready" : "status-blocked"}>門印：{view.ruleResolved ? "可回應" : "封閉"}</span>
        </div>
        <div className={`causal-map ${view.ruleResolved ? "is-resolved" : ""}`} aria-label="關卡因果圖">
          <div><b>阻擋物</b><span>{view.ruleResolved ? "已解除" : activeChallenge?.blocker ?? "壁垣"}</span></div><i>→</i>
          <div><b>所需規則</b><span>{activeChallenge ? `${activeChallenge.subject} ${activeChallenge.verb} ${activeChallenge.predicate}` : world.getLevel().ruleLabel}</span></div><i>→</i>
          <div><b>結果</b><span>{view.ruleResolved ? "門印可達" : activeChallenge?.resolvedState ?? "門印封閉"}</span></div>
        </div>
        <section className="causal-report" aria-label="因果驗證報告">
          <b>因果驗證報告</b>
          <span>名詞元件：{activeChallenge?.entities.join("、")}</span>
          <span>阻擋來源：{view.ruleResolved ? "全部阻擋已解除" : activeChallenge?.blocker}</span>
          {remainingChallenges.length > 1 ? <span>後續必要規則：{remainingChallenges.filter((challenge) => challenge !== activeChallenge).map((challenge) => `${challenge.subject} ${challenge.verb} ${challenge.predicate}`).join("；")}</span> : null}
          <span>規則成立前：無通關路徑</span>
          <span>規則成立後：門印可達</span>
        </section>

        <div className="causal-entry active-entry">
          <span className="entry-line teal-line" />
          <div>
            <b>{view.ruleResolved ? "所有必要規則已成立" : `目前規則：${activeChallenge?.title ?? "尚未成立"}`}</b>
            <p>{view.ruleResolved ? "所有受規則指定的元件已轉化，阻擋路徑已解除。" : `${activeChallenge?.blocker ?? "受規則指定的元件"}仍在阻擋必經路徑；先完成目前文字規則。`}</p>
          </div>
        </div>
        <div className="causal-entry">
          <span className="entry-line graphite-line" />
          <div>
            <b>R-24 映射中</b>
            <p>影跡保留行者的上一格位置。</p>
          </div>
        </div>
        <div className={`causal-entry ${view.barrierBlocking ? "conflict-entry" : "active-entry"}`}>
          <span className="entry-line amber-line" />
          <div>
            <b>{view.barrierBlocking ? "移動權與阻隔權相遇" : "阻隔權未參與裁決"}</b>
            <p>{view.barrierBlocking ? "壁垣仍可攔下你的移動意圖。" : "可穿越壁垣；保持觀察門印。"}</p>
          </div>
        </div>

        <button className="guide-toggle" onClick={() => setGuideOpen((value) => !value)} type="button">
          <span>解析提示</span>
          {isGuideOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        {isGuideOpen && (
          <p className="guide-copy">提示不提供答案：請先檢查語句是否完整，再觀察壁垣是否仍具有阻隔權。</p>
        )}

        <div className="chapter-card" style={{ backgroundImage: `url(${resolveAssetUrl(ASSETS.chapter)})` }}>
          <span>下一個概念</span>
          <b>距離可以觸發轉化。</b>
        </div>
      </aside>}

      <section className={`mobile-console glass-panel ${tutorialStep === "detach" ? "tutorial-target" : ""}`} aria-label="手機遊戲面板" onTouchStart={(event) => { mobileConsoleTouchY.current = event.touches[0]?.clientY ?? null; }} onTouchEnd={(event) => { const startY = mobileConsoleTouchY.current; const endY = event.changedTouches[0]?.clientY; mobileConsoleTouchY.current = null; if (startY === null || endY === undefined || Math.abs(endY - startY) < 28) return; setMobileConsoleCollapsed(endY > startY); }}>
        <button className="mobile-console-handle" onClick={() => setMobileConsoleCollapsed((collapsed) => !collapsed)} type="button" aria-expanded={!isMobileConsoleCollapsed}><span /><b>{isMobileConsoleCollapsed ? "向上滑動或點擊展開規則" : "向下滑動收合控制台"}</b></button>
        <div className="mobile-console-tabs" role="tablist" aria-label="手機面板切換">
          <button className={mobilePanel === "rules" ? "is-active" : ""} onClick={() => setMobilePanel("rules")} type="button" role="tab" aria-selected={mobilePanel === "rules"}>規則 <span>{view.resolvedRules.length}/{requiredChallengesFor(world.getLevel()).length}</span></button>
          <button className={mobilePanel === "objects" ? "is-active" : ""} onClick={() => setMobilePanel("objects")} type="button" role="tab" aria-selected={mobilePanel === "objects"}>物件 <span>{activeChallenge?.blocker ?? "門印"}</span></button>
          <button className={mobilePanel === "camera" ? "is-active" : ""} onClick={() => setMobilePanel("camera")} type="button" role="tab" aria-selected={mobilePanel === "camera"}>鏡頭 <span>調整</span></button>
        </div>
        {mobilePanel === "rules" && (
          <div className="mobile-console-body mobile-rule-panel">
            <p className="mobile-panel-kicker">目前規則片</p>
            <div className={`mobile-stash ${view.isolatedBlocks.length ? "is-filled" : ""}`}>
              <div className="mobile-stash-heading"><span>暫存區</span><b>{view.isolatedBlocks.length ? view.isolatedBlocks.join("、") : "空白"}</b></div>
              <div className="mobile-stash-actions">
                <button onClick={() => world.isolateRuleBlock()} type="button">暫存最右文字片</button>
                <button disabled={!view.isolatedBlocks.length} onClick={() => world.restoreRuleBlock()} type="button">接回暫存片</button>
              </div>
            </div>
            <div className="mobile-rule-tiles">{view.ruleBlocks.map((block, index) => <Tile accent={index === 0} key={`${block}-mobile-${index}`}>{block}</Tile>)}</div>
            <div className="mobile-rule-actions">
              <button onClick={() => world.pushRule("left")} type="button">← 推動</button>
              <button onClick={() => world.pushRule("right")} type="button">推動 →</button>
              <button onClick={() => world.restoreRuleBlock()} type="button">接回</button>
              <button onClick={() => world.lockRuleBlock()} type="button">封鎖</button>
              <button className={canExecuteRule ? "is-ready" : ""} onClick={() => world.resolveRule()} type="button">{canExecuteRule ? "執行規則" : "執行規則"}</button>
            </div>
            <p className="mobile-rule-status">{canExecuteRule ? "規則已成立，可以改變對應物件。" : "先把文字片排成完整規則，再執行。"}</p>
          </div>
        )}
        {mobilePanel === "objects" && (
          <div className="mobile-console-body mobile-object-panel">
            <p className="mobile-panel-kicker">地圖因果</p>
            <p className="mobile-object-copy">{activeChallenge?.prompt ?? view.objective}</p>
            <div className="mobile-object-grid">
              <span><b>關鍵元件</b>{activeChallenge?.entities.join("、") ?? "行者、門印"}</span>
              <span><b>目前阻擋</b>{view.ruleResolved ? "已解除" : activeChallenge?.blocker ?? "壁垣"}</span>
              <span><b>規則結果</b>{view.ruleResolved ? activeChallenge?.resolvedState ?? "通路開啟" : "尚未改變"}</span>
            </div>
            <p className="mobile-rule-status">{view.message}</p>
          </div>
        )}
        {mobilePanel === "camera" && (
          <div className="mobile-console-body mobile-camera-panel">
            <div className="mobile-camera-heading"><p className="mobile-panel-kicker">鏡頭控制</p><button onClick={toggleFocus} type="button">{isFocusMode ? "結束專注" : "專注棋盤"}</button></div>
            <label><span>高度</span><input aria-label="手機鏡頭高度" type="range" min="0" max="100" value={Math.round(cameraView.height * 100)} onChange={(event) => setCameraView((current) => ({ ...current, height: Number(event.target.value) / 100 }))} /></label>
            <label><span>縮放</span><input aria-label="手機鏡頭縮放" type="range" min="0" max="100" value={Math.round(cameraView.zoom * 100)} onChange={(event) => setCameraView((current) => ({ ...current, zoom: Number(event.target.value) / 100 }))} /></label>
          </div>
        )}
      </section>

      <section className={`mobile-controls glass-panel ${tutorialStep === "cross" || tutorialStep === "door" || tutorialStep === "replay" ? "tutorial-target" : ""}`} aria-label="手機移動與回放控制">
        <div className="mobile-control-row">
          <div className="mobile-dpad" aria-label="方向控制">
            {directionButton("up", "向上移動")}
            {directionButton("left", "向左移動")}
            <span className="dpad-core">行</span>
            {directionButton("right", "向右移動")}
            {directionButton("down", "向下移動")}
          </div>
          <div className="mobile-transport-controls">
            <button onClick={() => world.undo()} type="button" aria-label="撤銷"><Undo2 size={18} /></button>
            <button onClick={() => world.redo()} type="button" aria-label="重做"><Redo2 size={18} /></button>
            <button onClick={() => world.reset()} type="button" aria-label="重設"><RotateCcw size={18} /></button>
            <button className="demo-button" onClick={() => world.startDemo()} type="button"><Play size={16} fill="currentColor" />展示</button>
          <button className="demo-button ai-auto-button" onClick={() => world.aiAutoPlay()} type="button"><Sparkles size={14} fill="currentColor" />電腦AI自動</button>
          </div>
        </div>
        <div className="mobile-replay-control">
          <div className="replay-meta"><span>回放時間軸</span><span>{view.timelineIndex} / {view.timelineLength - 1}</span></div>
          <input aria-label="手機回放時間軸" type="range" min="0" max={Math.max(0, view.timelineLength - 1)} value={view.timelineIndex} onChange={(event) => world.replayTo(Number(event.target.value))} />
        </div>
      </section>

      <section className={`control-dock glass-panel ${tutorialStep === "cross" || tutorialStep === "door" || tutorialStep === "replay" ? "tutorial-target" : ""}`} aria-label="移動與回放控制">
        <div className="dpad" aria-label="方向控制">
          {directionButton("up", "向上移動")}
          {directionButton("left", "向左移動")}
          <span className="dpad-core">行</span>
          {directionButton("right", "向右移動")}
          {directionButton("down", "向下移動")}
        </div>
        <div className="transport-controls">
          <button onClick={() => world.undo()} type="button" aria-label="撤銷"><Undo2 size={18} /></button>
          <button onClick={() => world.redo()} type="button" aria-label="重做"><Redo2 size={18} /></button>
          <button onClick={() => world.reset()} type="button" aria-label="重設"><RotateCcw size={18} /></button>
          <button className="demo-button" onClick={() => world.startDemo()} type="button"><Play size={16} fill="currentColor" />展示</button>
          <button className="demo-button ai-auto-button" onClick={() => world.aiAutoPlay()} type="button"><Sparkles size={14} fill="currentColor" />電腦AI自動</button>
        </div>
        <div className="replay-control">
          <div className="replay-meta"><span>回放</span><span>{view.timelineIndex} / {view.timelineLength - 1}</span></div>
          <input
            aria-label="回放時間軸"
            type="range"
            min="0"
            max={Math.max(0, view.timelineLength - 1)}
            value={view.timelineIndex}
            onChange={(event) => world.replayTo(Number(event.target.value))}
          />
        </div>
      </section>

      <nav className="chapter-rail" aria-label="章節選擇">
        {railLevels.map((level) => {
          const isCompleted = progress.includes(level.id);
          const isCurrent = level.id === view.levelId;
          const canJump = isCompleted || isCurrent;
          const record = records[level.id];
          const recordLabel = record ? `最佳 ${record.bestSteps} 步，最短 ${formatDuration(record.bestTimeMs)}` : "已過關，尚無已保存成績";
          return (
            <button key={level.id} disabled={!canJump} onClick={() => { if (canJump && !isCurrent) world.loadLevel(level); }} className={`chapter-node ${isCompleted ? "is-completed" : ""} ${isCurrent ? "is-current" : ""} ${canJump ? "is-unlocked" : "is-locked"}`} type="button" title={canJump ? (isCompleted ? `已完成：${level.name}；${recordLabel}` : `目前關卡：${level.name}`) : `尚未完成：先完成前置關卡後才能前往 ${level.name}`} aria-label={canJump && isCompleted ? `${level.name}，${recordLabel}` : undefined}>
              <span>{String(level.order).padStart(2, "0")}</span>
              <i>{level.name}</i>
              {isCompleted && <small className="chapter-node-record">{record ? <>{record.bestSteps}步 · {formatShortDuration(record.bestTimeMs)}</> : "已過關"}</small>}
              {isCompleted && !isCurrent ? <b aria-hidden="true">✓</b> : null}
            </button>
          );
        })}
      </nav>

      {mode === "editor" && (
        <section className="editor-layer" aria-label="關卡編輯器">
          <div className="editor-sheet">
            <div className="editor-heading"><div><p className="eyebrow">自訂織界</p><h2>關卡編輯器</h2></div><button onClick={() => setMode("play")} type="button" aria-label="關閉編輯器"><X size={18} /></button></div>
            <p className="editor-copy">選擇物件後點棋盤格放置。壁垣可以再點一次移除；完成後先測試，再把分享碼傳給朋友。</p>
            <label className="editor-field">關卡名稱<input value={draft.name} maxLength={20} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
            <label className="editor-field">作者署名<input value={draft.author || ""} maxLength={24} placeholder="例如：小林" onChange={(event) => setDraft({ ...draft, author: event.target.value })} /></label>
            <label className="editor-field">縮圖色調<select value={draft.thumbnailStyle || "mist"} onChange={(event) => setDraft({ ...draft, thumbnailStyle: event.target.value as LevelDefinition["thumbnailStyle"] })}><option value="mist">霧白紙藝</option><option value="teal">編織青綠</option><option value="amber">暖琥珀</option></select></label>
            <section className="editor-environment" aria-label="地形與光照預覽"><div><p className="eyebrow">環境預覽</p><h3>章節地形與光照</h3><small>只改變編輯預覽與測試關卡氛圍，不更動規則因果。</small></div><label>地形<select value={draft.editorEnvironment?.chapter ?? 1} onChange={(event) => applyEditorEnvironment(Number(event.target.value), draft.editorEnvironment?.lighting ?? "day")}>{Array.from({ length: 10 }, (_, index) => <option value={index + 1} key={index}>{`第${index + 1}章・${chapterNames[index + 1]}`}</option>)}</select></label><div className="editor-lighting">{editorLightingOptions.map((option) => <button type="button" className={(draft.editorEnvironment?.lighting ?? "day") === option.id ? "is-selected" : ""} onClick={() => applyEditorEnvironment(draft.editorEnvironment?.chapter ?? 1, option.id)} key={option.id}><b>{option.label}</b><small>{option.hint}</small></button>)}</div></section>
            <div className="editor-tools">{editorKinds.map((kind) => <button type="button" className={selectedEditorKind === kind.id ? "is-selected" : ""} onClick={() => { setSelectedEditorKind(kind.id); setEditorNotice(`已選擇「${kind.label}」。請先確認下方模型預覽與接地指示，再點擊棋盤格放置。`); }} key={kind.id}>{kind.label}</button>)}</div>
            <section className={`editor-model-inspector inspector-${selectedEditorKind}`} aria-label={`${selectedAsset.title}模型預覽與接地指示`}>
              <div className="editor-model-stage" aria-hidden="true"><i className="preview-spark preview-spark-a" /><i className="preview-spark preview-spark-b" /><b>{selectedAsset.glyph}</b><span className="editor-ground-plane" /></div>
              <div className="editor-model-copy"><p className="eyebrow">模型預覽・已驗證</p><h3>{selectedAsset.title}<small>{selectedAsset.model}</small></h3><p>{selectedAsset.subtitle}</p><div className="editor-model-parts">{selectedAsset.parts.map((part) => <span key={part}>{part}</span>)}</div></div>
              <div className="editor-ground-readout"><span className="ground-indicator" aria-hidden="true" /><div><b>貼地校正完成</b><small>底面 → 棋盤 0.00；場景會依實際包圍盒自動對齊。</small></div><em>安全</em></div>
            </section>
            <section className="editor-asset-uploader" aria-label="自訂詞彙資產上傳"><div><p className="eyebrow">自訂詞彙資產</p><h3>上傳、去背與完整性檢查</h3><p>圖片僅在瀏覽器處理；系統移除白／灰底、壓縮為分享安全 PNG，並檢查尺寸、前景比例與棋盤座標。</p></div><label>詞彙名稱<input value={customNounName} maxLength={12} placeholder="例如：月桂獸" onChange={(event) => setCustomNounName(event.target.value)} /></label><label className={`asset-file-picker ${assetBusy ? "is-busy" : ""}`}>選擇圖片<input type="file" accept="image/png,image/webp,image/jpeg" disabled={assetBusy} onChange={(event) => { void addCustomAsset(event.target.files?.[0]); event.currentTarget.value = ""; }} /><span>{assetBusy ? "處理去背中…" : "上傳並檢查（≤ 2 MB）"}</span></label><div className="custom-asset-list" aria-label="自訂資產排序清單">{(draft.customAssets ?? []).length ? (draft.customAssets ?? []).map((asset, index, assets) => <div className={`custom-asset-row ${draggedAssetId === asset.id ? "is-dragging" : ""}`} key={asset.id} draggable onDragStart={() => setDraggedAssetId(asset.id)} onDragOver={(event) => event.preventDefault()} onDrop={() => { if (draggedAssetId) reorderCustomAsset(draggedAssetId, asset.id); setDraggedAssetId(null); }} onDragEnd={() => setDraggedAssetId(null)}><button className="asset-drag-handle" type="button" aria-label={`拖曳排序 ${asset.noun}`}><GripVertical size={16} /></button><img src={asset.dataUrl} alt={`${asset.noun}預覽`} /><span><b>{asset.noun}</b><small>{asset.width}×{asset.height}・前景 {Math.round(asset.foregroundRatio * 100)}%・已去背・排序 {index + 1}</small></span><div className="asset-row-actions"><button type="button" disabled={index === 0} onClick={() => reorderCustomAsset(asset.id, assets[index - 1]!.id)} aria-label={`將 ${asset.noun} 上移`}>↑</button><button type="button" disabled={index === assets.length - 1} onClick={() => reorderCustomAsset(asset.id, assets[index + 1]!.id)} aria-label={`將 ${asset.noun} 下移`}>↓</button><button className="asset-delete" type="button" onClick={() => removeCustomAsset(asset.id)} aria-label={`刪除 ${asset.noun}`}><Trash2 size={15} /></button></div></div>) : <small>尚未加入自訂詞彙資產。</small>}</div></section>
            <div className="editor-grid" aria-label="7乘7關卡格">
              {Array.from({ length: 49 }, (_, index) => { const point = { x: index % 7, y: Math.floor(index / 7) }; const kind = samePoint(draft.player, point) ? "player" : samePoint(draft.door, point) ? "door" : samePoint(draft.ember, point) ? "ember" : samePoint(draft.tide, point) ? "tide" : draft.walls.some((wall) => samePoint(wall, point)) ? "wall" : "empty"; return <button type="button" onClick={() => updateDraftCell(point)} className={`editor-cell cell-${kind} is-grounded`} aria-label={`${point.x + 1}, ${point.y + 1}`} key={index}>{kind === "player" ? "▲" : kind === "door" ? "◇" : kind === "wall" ? "■" : kind === "ember" ? "●" : kind === "tide" ? "○" : ""}</button>; })}
            </div>
            <div className={`share-preview preview-${draft.thumbnailStyle || "mist"}`}><div><span>LW1 / 分享預覽</span><b>{draft.name || "未命名織界"}</b><i>編織者：{draft.author || "未署名"}</i></div><div className="preview-grid">{Array.from({ length: 49 }, (_, index) => { const point = { x: index % 7, y: Math.floor(index / 7) }; const kind = samePoint(draft.player, point) ? "player" : samePoint(draft.door, point) ? "door" : draft.walls.some((wall) => samePoint(wall, point)) ? "wall" : "empty"; return <span className={`preview-cell preview-${kind}`} key={index} />; })}</div></div>
            {editorMissingNames.length > 0 && <p className="editor-warning">規則名詞缺失：地圖中尚未放入「{editorMissingNames.join("、")}」。請補齊元件後再測試或分享。</p>}
            <section className={`editor-solvability ${editorValidation ? (editorValidation.issues.length ? "has-issues" : "is-solved") : ""}`} aria-live="polite"><div><p className="eyebrow">一鍵可解性驗證</p><h3>{editorValidation ? editorValidation.issues.length ? "尚不可解" : "可順利通關" : "先檢查再分享"}</h3><p>{editorValidation ? editorValidation.issues.length ? "請處理下列因果或路徑問題。" : `規則成立後的最短可達路徑為 ${Math.max(0, editorValidation.pathLength - 1)} 步。` : "系統會檢查必要規則、名詞實體、阻擋因果與門印路徑。"}</p></div><button type="button" onClick={verifyDraft}><Sparkles size={15} />驗證可解性</button>{editorValidation?.difficulty && <div className="editor-difficulty" aria-label={`難度 ${editorValidation.difficulty.stars} 星，分數 ${editorValidation.difficulty.score}`}><div><span>{"★".repeat(editorValidation.difficulty.stars)}{"☆".repeat(5 - editorValidation.difficulty.stars)}</span><b>{editorValidation.difficulty.stars} 星・{editorValidation.difficulty.summary}</b></div><small>評分 {editorValidation.difficulty.score}/100：路徑 {editorValidation.difficulty.pathSteps} 步・轉折 {editorValidation.difficulty.turns}・必要規則 {editorValidation.difficulty.ruleCount}・機制 {editorValidation.difficulty.mechanismCount}・阻擋 {editorValidation.difficulty.blockerCount}</small></div>}{editorValidation?.issues.length ? <ul>{editorValidation.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul> : null}</section>
            <p className="editor-notice">{editorNotice}</p>
            <div className="editor-actions"><button onClick={testDraft} type="button"><PencilRuler size={15} />測試關卡</button><button onClick={makeShareCode} type="button"><Copy size={15} />產生分享碼</button></div>
            <textarea value={shareCode} onChange={(event) => setShareCode(event.target.value)} placeholder="分享碼會出現在這裡，也可以貼上朋友給你的分享碼。" />
            <div className="editor-actions"><button onClick={loadShareCode} type="button"><Upload size={15} />載入分享碼</button><button onClick={makeShareCode} type="button"><Download size={15} />複製分享碼</button></div>
          </div>
        </section>
      )}

      {isChapterSummaryOpen && (
        <section className="chapter-summary-layer" role="dialog" aria-modal="true" aria-labelledby="chapter-summary-title">
          <div className="chapter-summary-sheet glass-panel">
            <header className="chapter-summary-heading">
              <div>
                <p className="eyebrow">PERSONAL CAMPAIGN RECORD</p>
                <h2 id="chapter-summary-title">章節成績總覽</h2>
                <p>完成率統計所有已過關關卡；總步數只加總已保存的各關最佳紀錄。</p>
              </div>
              <button onClick={() => setChapterSummaryOpen(false)} type="button" aria-label="關閉章節成績總覽"><X size={18} /></button>
            </header>
            <div className="campaign-summary-total" aria-label="戰役整體成績">
              <div><span>已完成</span><b>{totalCompleted}<small> / {campaignLevels.length} 關</small></b></div>
              <div><span>累計最佳</span><b>{totalScored ? `${totalBestSteps}` : "—"}<small>{totalScored ? " 步" : " 尚無紀錄"}</small></b></div>
              <div><span>完成率</span><b>{Math.round((totalCompleted / campaignLevels.length) * 100)}<small>%</small></b></div>
            </div>
            <div className="chapter-summary-grid">
              {chapterSummaries.map((chapter) => {
                const missingRecords = chapter.completed - chapter.scored;
                const remaining = chapter.total - chapter.completed;
                const nextUnfinishedLevel = campaignLevels.find((level) => level.chapter === chapter.chapter && !progress.includes(level.id));
                return (
                  <article className={`chapter-score-card ${chapter.completed === chapter.total ? "is-complete" : ""}`} key={`chapter-score-${chapter.chapter}`}>
                    <div className="chapter-score-topline"><span>第 {chapter.chapter} 章</span><b>{chapter.title}</b><em>{chapter.completed} / {chapter.total}</em></div>
                    <div className="chapter-score-progress" aria-label={`第 ${chapter.chapter} 章完成率 ${chapter.completionRate}%`}><i style={{ width: `${chapter.completionRate}%` }} /></div>
                    {nextUnfinishedLevel ? (
                      <button className="chapter-score-callout" onClick={() => { world.loadLevel(nextUnfinishedLevel); setChapterSummaryOpen(false); setLevelPickerOpen(false); }} type="button" aria-label={`前往第 ${chapter.chapter} 章下一個未完成關卡：${nextUnfinishedLevel.name}`}>
                        <span>下一步</span><b>還差 {remaining} 關即可完成本章・前往「{nextUnfinishedLevel.name}」</b><ChevronRight size={14} aria-hidden="true" />
                      </button>
                    ) : (
                      <div className="chapter-score-callout is-complete"><span>本章全破</span><b>已完成全部 {chapter.total} 關</b></div>
                    )}
                    <div className="chapter-score-metrics"><div><span>完成率</span><b>{chapter.completionRate}%</b></div><div><span>累計最佳</span><b>{chapter.scored ? `${chapter.bestSteps} 步` : "—"}</b></div></div>
                    <small>{missingRecords ? `另有 ${missingRecords} 關舊進度尚未留存步數` : chapter.completed ? `已保存 ${chapter.scored} 關最佳紀錄` : "尚未完成本章關卡"}</small>
                  </article>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {tutorialStep !== "off" && (
        <section className={`tutorial-card tutorial-step-${tutorialStep} ${isTutorialReceded ? "is-receded" : ""}`} role="dialog" aria-modal={tutorialStep === "offer" || tutorialStep === "replay"} aria-label="電腦引導教學">
          <div className="tutorial-card-topline">
            <span className="tutorial-orb"><Sparkles size={15} /></span>
            <span>電腦引導</span>
            {tutorialStep !== "offer" && <b>{tutorialIndex[tutorialStep]} / 5</b>}
          </div>

          {tutorialStep === "offer" && (
            <>
              <h2>先讓我帶你走一次。</h2>
              <p>你會親手推離一塊規則片、穿越原本無法通過的壁垣，再用自己的路徑讓門印回應。</p>
              <div className="tutorial-actions">
                <button className="tutorial-secondary" onClick={() => leaveTutorial()} type="button"><SkipForward size={15} />直接進入關卡</button>
                <button className="tutorial-primary" onClick={launchTutorial} type="button">開始教學</button>
              </div>
            </>
          )}

          {tutorialStep === "observe" && (
            <>
              <h2>先看工作桌。</h2>
              <p>左邊是可被推動的界律片，中央是受規則影響的棋盤，右邊記錄因果；下方則是移動、撤銷與回放。</p>
              <div className="tutorial-actions"><button className="tutorial-primary" onClick={() => setTutorialStep("detach")} type="button">我看到了</button></div>
            </>
          )}

          {tutorialStep === "detach" && (
            <>
              <span className="tutorial-icon"><MousePointer2 size={18} /></span>
              <h2>讓壁垣失去阻隔權。</h2>
              <p>請在下方教學操作列按一次「推動 ←」，讓文字排成「壁垣 賦有 可通過」，再執行規則。</p>
              <p className="tutorial-note">規則成立後，壁垣才不會擋路；按鈕會在正確順序時亮起。</p>
              <p className="tutorial-rule-preview">目前規則：{view.ruleBlocks.join("　")}</p>
              <div className="tutorial-step-actions">
                <button className="tutorial-secondary" onClick={() => world.pushRule("left")} type="button">推動 ←</button>
                <button className={`tutorial-primary ${canExecuteRule ? "is-ready" : ""}`} onClick={() => world.resolveRule()} type="button">執行規則</button>
                <button className="tutorial-skip" onClick={() => leaveTutorial()} type="button">略過教學</button>
              </div>
            </>
          )}

          {tutorialStep === "cross" && (
            <>
              <span className="tutorial-icon"><Footprints size={18} /></span>
              <h2>現在穿過壁垣。</h2>
              <p>壁垣變成淡青，代表它現在不會擋路。請用下方方向鍵連續按 <b>↑</b> 三次，讓行者走過中間那一列。</p>
              <p className="tutorial-note">每走一步，灰色影跡會留在你剛才站的位置，方便你看清自己走過的路。</p>
            </>
          )}

          {tutorialStep === "door" && (
            <>
              <span className="tutorial-icon"><Footprints size={18} /></span>
              <h2>把行者送到門印。</h2>
              <p>你已經走到壁垣上方。現在按 <b>→</b> 四次，再按 <b>↑</b> 一次，就能碰到門印。</p>
              <p className="tutorial-note">走錯也沒關係，按底部的撤銷按鈕就能回到上一步。</p>
            </>
          )}

          {tutorialStep === "replay" && (
            <>
              <span className="tutorial-icon"><Play size={18} fill="currentColor" /></span>
              <h2>你完成了第一關。</h2>
              <p>剛剛你把「隔離作用」片暫時拿離規則，所以壁垣不再擋路。底部回放條會記住每一步，拖曳它就能回看自己的解法。</p>
              <div className="tutorial-actions">
                <button className="tutorial-secondary" onClick={() => leaveTutorial(false)} type="button">保留這次解法</button>
                <button className="tutorial-primary" onClick={() => leaveTutorial(true)} type="button">開始正式關卡</button>
              </div>
            </>
          )}

          {tutorialStep !== "offer" && tutorialStep !== "replay" && (
            <button className="tutorial-skip" onClick={() => leaveTutorial()} type="button">略過教學，直接進入關卡</button>
          )}
        </section>
      )}

      {view.finished && tutorialStep === "off" && mode === "play" && (
        isFinalClear ? (
          <div className={`completion-layer finale-layer finale-${finalePhase}`} role="dialog" aria-modal="true" aria-label="全破終章">
            <div className="finale-constellation" aria-hidden="true">{["界", "律", "編", "織", "者"].map((mark, index) => <i key={mark} style={{ "--finale-index": index } as React.CSSProperties}>{mark}</i>)}</div>
            <div className="completion-card finale-card">
              <p className="eyebrow">LAWWEAVER · FINAL WEAVE</p>
              {finalePhase === "intro" ? (
                <>
                  <div className="finale-seal" aria-hidden="true"><span>50</span><small>／50</small></div>
                  <h2>五十道界律，正在合為一扇門。</h2>
                  <p>你沒有摧毀規則，而是逐條理解、重排，讓整座世界學會新的通路。最後一道門印已回應你的編織。</p>
                  <button onClick={() => setFinalePhase("reveal")} type="button">揭開終章</button>
                </>
              ) : (
                <>
                  <div className="finale-seal finale-seal-revealed" aria-hidden="true"><span>完成</span><small>50／50</small></div>
                  <h2>全破了。</h2>
                  <p>你已完成《界律編織者》全部 50 關，不必回到第一關。現在，換你創造一座只屬於自己的織界。</p>
                  <div className="completion-time"><span>終章完成時間</span><b>{formatDuration(view.elapsedMs)}</b></div>
                  <div className="personal-record"><span>本關紀錄</span><div><b>{currentRecord?.bestSteps ?? view.turn}</b><small>步數</small></div><div><b>{formatDuration(currentRecord?.bestTimeMs ?? view.elapsedMs)}</b><small>時間</small></div><em>完成 {currentRecord?.completions ?? 1} 次</em></div>
                  <button onClick={openEditor} type="button">創造我的獨特關卡</button>
                  <button className="finale-replay" onClick={() => setFinalePhase("intro")} type="button">再看一次終章動畫</button>
                </>
              )}
            </div>
          </div>
        ) : isDailyChallenge ? (
          <div className="completion-layer daily-completion-layer" role="dialog" aria-modal="true" aria-label="每日織界完成">
            <div className="completion-card daily-completion-card">
              <p className="eyebrow">DAILY WEAVE · {dailyChallengeDateLabel(world.getLevel())}</p>
              <h2>今日的織界已解開。</h2>
              <p>你已完成一座由日期固定種子生成的獨立關卡。明日會有不同的界帶與阻擋組合；原始50關的戰役進度不受影響。</p>
              <p className="daily-completion-countdown">下一座織界將於 <b>{dailyCountdown.label}</b> 後展開（UTC午夜）。</p>
              <div className="daily-reminder-row"><span>{dailyReminderEnabled ? "已開啟每日提醒" : "想在此頁開啟時收到更新提示？"}</span><button className="finale-replay" onClick={enableDailyReminder} type="button">{dailyReminderEnabled ? "提醒已開啟" : "開啟瀏覽器提醒"}</button></div>
              {dailyReminderStatus === "unsupported" && <small className="daily-reminder-note">此瀏覽器不支援通知，頁面上的UTC倒數仍會正常提醒你。</small>}
              {dailyReminderStatus === "denied" && <small className="daily-reminder-note">通知權限未開啟；請從瀏覽器網站設定允許通知，或直接依照頁面倒數回來挑戰。</small>}
              <div className="completion-time"><span>今日完成時間</span><b>{formatDuration(view.elapsedMs)}</b></div>
              <div className="personal-record"><span>今日紀錄</span><div><b>{currentRecord?.bestSteps ?? view.turn}</b><small>步數</small></div><div><b>{formatDuration(currentRecord?.bestTimeMs ?? view.elapsedMs)}</b><small>時間</small></div><em>完成 {currentRecord?.completions ?? 1} 次</em></div>
              <button onClick={() => world.reset()} type="button">再挑戰今日織界</button>
              <button className="finale-replay" onClick={openEditor} type="button">用編輯器創造新織界</button>
            </div>
          </div>
        ) : (
          <div className="completion-layer" role="dialog" aria-modal="true" aria-label="關卡完成">
            <div className="completion-card">
              <p className="eyebrow">過關了</p>
              <h2>你成功打開門印。</h2>
              <p>你把「隔離作用」片暫時移出規則，壁垣就不再擋路。接著走過壁垣，碰到門印，所以這一關完成了。</p>
              <div className="completion-time"><span>花費時間</span><b>{formatDuration(view.elapsedMs)}</b></div>
              <div className="personal-record"><span>個人最佳</span><div><b>{currentRecord?.bestSteps ?? view.turn}</b><small>步數</small></div><div><b>{formatDuration(currentRecord?.bestTimeMs ?? view.elapsedMs)}</b><small>時間</small></div><em>完成 {currentRecord?.completions ?? 1} 次</em></div>
              <button onClick={nextLevel} type="button">前往下一關</button>
            </div>
          </div>
        )
      )}
    </div>
  );
}
