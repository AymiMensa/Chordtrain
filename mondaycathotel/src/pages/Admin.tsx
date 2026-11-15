import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { LogOut, Cat, AlertTriangle, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import AdminBookings from "@/components/admin/AdminBookings";
import AdminCRM from "@/components/admin/AdminCRM";
import CabinetAssignmentTable from "@/components/admin/CabinetAssignmentTable";
import CabinetCalendar from "@/components/admin/CabinetCalendar";
import AdminScheduleGenerator from "@/components/admin/AdminScheduleGenerator";
import AdminPhotos from "@/components/admin/AdminPhotos";
import AdminFinance from "@/components/admin/AdminFinance";
import AdminFlipClock from "@/components/admin/AdminFlipClock";
import AdminShiftTracker from "@/components/admin/AdminShiftTracker";
import AdminBackup from "@/components/admin/AdminBackup";
import AdminLongTermAgreement from "@/components/admin/AdminLongTermAgreement";
import AdminStoreClosure from "@/components/admin/AdminStoreClosure";
import { useLawweaverAI } from "@/components/admin/LawweaverAIController";
import { WorkLogBoard } from "@/components/admin/WorkLogBoard";

const useLawweaverGameAI = (iframeRef) => {
  const [isAIPlaying, setIsAIPlaying] = useState(false);
  const [aiTurns, setAITurns] = useState(0);
  
  useEffect(() => {
    if (!iframeRef.current) return;
    
    const iframe = iframeRef.current;
    let intervalId = null;
    
    const startAI = () => {
      setIsAIPlaying(true);
      intervalId = setInterval(() => {
        try {
          const doc = iframe.contentDocument || iframe.contentWindow.document;
          if (!doc) return;
          
          // 檢查遊戲是否就緒
          const ruleBlocks = doc.querySelectorAll('.tile[data-role="rule"]');
          const challengeElem = doc.querySelector('.challenge-info');
          
          if (ruleBlocks.length < 3 || !challengeElem) return;
          
          // 獲取目標 phrases
          const targetPhrase = challengeElem.getAttribute('data-target') || '';
          const currentPhrases = Array.from(ruleBlocks).map(rb => rb.textContent.trim()).filter(s => s);
          
          // 檢查是否已組成目標
          if (currentPhrases.join("|") === targetPhrase) {
            // 檢查是否可以執行規則
            const executeBtn = doc.querySelector('.rule-execute.is-ready');
            if (executeBtn && !executeBtn.disabled) {
              executeBtn.click();
              setAITurns(prev => prev + 1);
              
              // 等待規則生效後移動
              setTimeout(() => {
                const moveBtn = doc.querySelector('.move-button[direction="up"]');
                if (moveBtn && !moveBtn.disabled) {
                  moveBtn.click();
                  setIsAIPlaying(false);
                  clearInterval(intervalId);
                }
              }, 1500);
            }
          } else {
            // 未組成，進行排列
            const direction = currentPhrases[0] && currentPhrases[0].indexOf("焰流") >= 0 
              ? "left" : "right";
              const moveBtn = doc.querySelector(`.break-slot[data-direction="${direction}"]`);
              if (moveBtn && !moveBtn.disabled) {
                moveBtn.click();
              }
          }
        } catch (e) {
          console.error("AI 遊戲錯誤:", e);
        }
      }, 800);
    };
    
    const checkGameLoad = setInterval(() => {
      try {
        const doc = iframe.contentDocument || iframe.contentWindow.document;
        if (doc && doc.querySelector('.lawweaver-board')) {
          clearInterval(checkGameLoad);
          startAI();
        }
      } catch (e) {}
    }, 300);
    
    return () => {
      clearInterval(intervalId);
      clearInterval(checkGameLoad);
    };
  }, [iframeRef]);
  
  return isAIPlaying;
};
import CatEasterEgg from "@/components/CatEasterEgg";

const games = [
                       { name: "經典 2048", path: "2048-master/index.html", color: "#B6A6A0" },
                      { name: "超酷立體 Hextris", path: "hextris-gh-pages/index.html", color: "#A0B0A6" },
                      { name: "單人立體迷宮 RPG", path: "cat.html", color: "#9C9EAE" },
                      { name: "星際大戰", path: "fly.html", color: "#C3B5A2" },
                      { name: "決戰俄羅斯 (單/雙人)", path: "FTF.html", color: "#A8B3B8" },
                      { name: "四色牌", path: "Gemini手機版四色牌.html", color: "#B79C9D" },
                      { name: "打磚塊遊戲", path: "neon-breaker.html", color: "#B0B39C" },
                      { name: "貓咪吃罐罐", path: "cat-breaker.html", color: "#B28F7D" },
                      { name: "空氣曲棍球", path: "Neon Pro Air Hockey.html", color: "#A49DB0" },
                      { name: "迷宮塔防", path: "Maze TD.html", color: "#C4AD9D" },
                      { name: "神級AI象棋大戰", path: "xq-ai-battle.html", color: "#94A5A6" },
                      { name: "超立方體迷宮", path: "matrix-maze.html", color: "#C0A4A8" },
                      { name: "大老二", path: "big-two.html", color: "#A9B195" },
                      { name: "極緻骰寶", path: "sic-bo.html", color: "#9FA8BC" },
                      { name: "3D迷宮大逃殺", path: "arpg.html", color: "#C2B095" },
                      { name: "立體魔術方塊", path: "rubik.html", color: "#8FA29F" },
                      { name: "小瑪莉水果機台", path: "fruit_machine.html", color: "#B5A1B3" },
                      { name: "五張牌梭哈", path: "hong_kong_five_card_stud.html", color: "#BEAB9C" },
                      { name: "K機幫死動普", path: "kgbsdp.html", color: "#93A39A" },
                      { name: "超級彈珠檯", path: "standalone-pinball/index.html", color: "#9A8FB0" },
                      { name: "超級炸彈超人", path: "Bug_Bomb/index.html", color: "#B5A1B3" },
                      { name: "易經金錢卦", path: "preview.html", color: "#B8A89A" },
                      { name: "雙人對戰美少女夢工廠", path: "princess-maker_-duel-edition/dist/index.html", color: "#BFA5A0" },
                      { name: "貓咪排序遊戲", path: "Sort.html", color: "#B8A89A" },
                      { name: "格智", path: "lattice-mind/dist/public/index.html", color: "#9AAFA8" },
                      { name: "Echoes of the Grid 迴音網格", path: "echoes-of-the-grid/dist/public/index.html", color: "#A3B0A4" },
                      { name: "Lawweaver 界律編織者", path: "lawweaver/dist/public/index.html", color: "#A8A5A2", onLoad: (e) => useLawweaverGameAI(lawweaverRef) },
                      { name: "Starweave Duet 星紗雙譜", path: "Starweave Duet/index.html", color: "#8E9DA6" },
                      { name: "Starweave Duet 星紗雙譜 · 雙界協奏", path: "starweave-duet/index.html", color: "#9AA8B8" },
                      { name: "Meowdoku 貓咪數獨", path: "meowdoku/dist/index.html", color: "#B7AAA2" },
                      { name: "華容道之厭世打工貓", path: "catwork.html", color: "#C4939E" },
                      { name: "星糖塔羅屋", path: "Tcard.html", color: "#A79BB8" },
                      { name: "高複雜雙陀飛輪機芯", path: "complex-double-tourbillon/index.html", color: "#B5A08B" },
                      { name: "萬能骰子模擬器", path: "DICE.html", color: "#A8BFA3" },
                      { name: "緋紅星艦", path: "crimson-sky-fleet/dist/index.html", color: "#A98185" },
                       { name: "貓咪數獨花園", path: "meowdokuplus/index.html", color: "#8FAF9F" },
                       { name: "排序視覺化模擬器", path: "Sorting Visualizer/index.html", color: "#8895A8" },
                       { name: "全3D孔明標準九連環", path: "9_Rings/dist/index.html", color: "#B09A6E" },
                       { name: "3D多米諾骨牌推倒模擬器", path: "domino3d.html", color: "#9C8F9F" },
                    { name: "模擬湯姆熊", path: "last-arcade/index.html", color: "#A9A0B8" },
                    { name: "逃離莫哈維沙漠", path: "camel_race.html", color: "#B89B8A" },
                    { name: "恐懼岩地牢", path: "Dungeons_of_Dreadrock.html", color: "#8F9E8B" },
                    { name: "和弦樹狀進行與考試", path: "chord-tree.html", color: "#A68E83" },
                    { name: "和弦節奏練習與考試", path: "chord-train/", color: "#9E8F7A" },
                     { name: "樂理考卷亂數出題器", path: "shaoyun_music_theory_FINAL.html", color: "#A59A84" },
                     { name: "三元陽宅盤", path: "San_Yuan.html", color: "#92A7A8" },
                      { name: "3D 指尖陀螺設計與測試模擬器", path: "Fidget_Spinner.html", color: "#7E8FA0" },
                      { name: "反身語義實驗室 2.0", path: "vajra_dsl.html", color: "#CBB6D6" },
                      { name: "22種罕見語言翻譯機", path: "translator_morandi_elvish.html", color: "#BECDBE" },
                    { name: "日語發音教室 · 3D 口型", path: "JP.html", color: "#B69AA8" },
                    { name: "奇幻珍稀樂器3D音樂博物館", path: "Music_Museum/dist/index.html", color: "#A6A08D" },
                    { name: "開源占星工具包", path: "Astrology-Pro-main/index.html", color: "#9B8B7A" },
                      { name: "kerykeion星盤", path: "kerykeion-main/scripts/glyph_playground.html", color: "#8FA0B0" },
                       { name: "3D 奇珍 樂器館", path: "3D_INSTRUMENTS.html", color: "#B8A0A8" },
                      { name: "星盤模擬器", path: "stellarium-web-master/index.html", color: "#8FA8B8" },
                       { name: "實時星空天文模擬器", path: "stellarium-web-sky/index.html", color: "#B89495" },
                      { name: "台灣瘋狂大賽車", path: "TaiwanRun-main/index.html", color: "#A88FBB" },
                    ];

const Admin = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [siteBackground, setSiteBackground] = useState<string>(localStorage.getItem("admin_bg_color") || "#E8E5DF");
  const [overdueBookings, setOverdueBookings] = useState<any[]>([]);
  const [showOverdueDialog, setShowOverdueDialog] = useState(false);
  const [overdueLongTerm, setOverdueLongTerm] = useState<any[]>([]);
  const [showOverdueLongTermDialog, setShowOverdueLongTermDialog] = useState(false);
  const [activeTab, setActiveTab] = useState("bookings");
  const [selectedGame, setSelectedGame] = useState<{ name: string, path: string } | null>(null);
  const lawweaverAI = useLawweaverAI({ subject: "壁垣", verb: "賦有", predicate: "可通過", requiredOperation: "assemble" });
  const { toast } = useToast();
  
  // AI iframe ref for Lawweaver game
  const lawweaverRef = { current: null as HTMLIFrameElement | null };

  // Load background color from Supabase on mount
  useEffect(() => {
    const loadBgFromSupabase = async () => {
      const { data } = await supabase
        .from("site_settings")
        .select("value")
        .eq("key", "admin_bg_color")
        .single();
      if (data?.value && typeof data.value === "string") {
        localStorage.setItem("admin_bg_color", data.value);
        setSiteBackground(data.value);
        applyBackground(data.value);
      }
    };
    loadBgFromSupabase().catch(() => { });
  }, []);

  const applyBackground = (color: string) => {
    document.body.style.background = color;
    document.body.style.backgroundAttachment = "fixed";
    document.documentElement.style.background = color;
    document.documentElement.style.backgroundAttachment = "fixed";
  };



  useEffect(() => {
    const syncSiteBackground = (event?: Event | StorageEvent) => {
      const nextColor = event && "detail" in event && (event as CustomEvent).detail?.page === "admin"
        ? (event as CustomEvent).detail.color
        : localStorage.getItem("admin_bg_color") || "#E8E5DF";
      setSiteBackground(nextColor);
      applyBackground(nextColor);
    };

    syncSiteBackground();
    window.addEventListener("storage", syncSiteBackground);
    window.addEventListener("page-bg-color-updated", syncSiteBackground as EventListener);

    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        navigate("/admin-login");
      } else {
        await checkOverdueBookings();
      }
      setLoading(false);
    };
    checkAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!session) navigate("/admin-login");
    });

    // Global back-button trap for the Admin dashboard
    const handleGlobalPopState = (e: PopStateEvent) => {
      if (!window.history.state || !window.history.state.adminRoot) {
        window.history.pushState({ adminRoot: true }, '', window.location.href);
      }
    };
    window.history.pushState({ adminRoot: true }, '', window.location.href);
    window.addEventListener('popstate', handleGlobalPopState);

    return () => {
      subscription.unsubscribe();
      window.removeEventListener('popstate', handleGlobalPopState);
      window.removeEventListener('storage', syncSiteBackground);
      window.removeEventListener('page-bg-color-updated', syncSiteBackground as EventListener);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate]);

  useEffect(() => {
    if (!selectedGame) return;

    const html = document.documentElement;
    const body = document.body;
    const previousHtmlOverscroll = html.style.overscrollBehavior;
    const previousBodyOverscroll = body.style.overscrollBehavior;
    const previousBodyOverflow = body.style.overflow;
    const previousBodyTouchAction = body.style.touchAction;
    const previousBodyHeight = body.style.height;

    html.style.overscrollBehavior = "none";
    body.style.overscrollBehavior = "none";
    body.style.overflow = "hidden";
    body.style.touchAction = "none";
    body.style.height = "100dvh";

    // Instead of forcing the game to stay open, we allow popstate to close it.
    // The global popstate trap handles pushing state.
    // We just need a way to close the game when Escape or popstate fires.

    return () => {
      html.style.overscrollBehavior = previousHtmlOverscroll;
      body.style.overscrollBehavior = previousBodyOverscroll;
      body.style.overflow = previousBodyOverflow;
      body.style.touchAction = previousBodyTouchAction;
      body.style.height = previousBodyHeight;
    };
  }, [selectedGame]);

  const checkOverdueBookings = async () => {
    // Find bookings that are checked_in or confirmed but past checkout date + 24 hours
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const cutoffDate = yesterday.toISOString().split("T")[0];

    const { data } = await supabase
      .from("bookings")
      .select("*")
      .in("status", ["checked_in", "confirmed"])
      .lt("check_out_date", cutoffDate);

    if (data && data.length > 0) {
      setOverdueBookings(data);
      setShowOverdueDialog(true);
    }

    // Also check for today's checkout payment reminders
    await checkPaymentReminders();
  };

  const checkPaymentReminders = async () => {
    const todayStr = new Date().toISOString().split("T")[0];

    // Find bookings checking out today with unpaid payment status
    const { data } = await supabase
      .from("bookings")
      .select("*")
      .eq("check_out_date", todayStr)
      .eq("payment_status", "unpaid")
      .in("status", ["checked_in", "confirmed"]);

    if (data && data.length > 0) {
      const webhookUrl = localStorage.getItem("google_calendar_webhook") || "https://script.google.com/macros/s/AKfycbwRnIcx9Qn4DA3EPJnzFR8b369ip5y22H4CqHd_ObFKPb-A3zMUze0grC4PjRnEb5Qr/exec";
      try {
        await fetch(webhookUrl, {
          method: "POST",
          mode: "no-cors",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "checkout_payment_reminder",
            bookings: data.map(b => ({
              owner_name: b.owner_name,
              cat_name: b.cat_name,
              total_price: (b as any).total_price,
              check_out_date: b.check_out_date,
              check_in_time: b.check_in_time,
            }))
          })
        });
      } catch (e) {
        console.error("Payment reminder webhook error:", e);
      }
    }

    // Check overdue long term payments
    const { data: ltData } = await supabase
      .from("bookings")
      .select("*")
      .eq("status", "long_term")
      .eq("long_term_payment_status", "unpaid")
      .eq("long_term_notify", true)
      .lte("long_term_collection_date", todayStr);

    if (ltData && ltData.length > 0) {
      setOverdueLongTerm(ltData);
      setShowOverdueLongTermDialog(true);
    }
  };

  const handleMarkOverdueAsCheckedOut = async () => {
    const ids = overdueBookings.map(b => b.id);
    const chunkSize = 100;
    let hasError = false;

    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      const { error } = await supabase
        .from("bookings")
        .update({ status: "checked_out" })
        .in("id", chunk);
      if (error) {
        console.error("Batch update error:", error);
        hasError = true;
      }
    }

    if (hasError) {
      toast({ title: "部分更新失敗", variant: "destructive" });
    } else {
      toast({ title: `已將 ${ids.length} 筆預約狀態更新為已退宿` });
    }
    setShowOverdueDialog(false);
    setOverdueBookings([]);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/admin-login");
  };

  const [isBackupOverdue, setIsBackupOverdue] = useState(false);

  useEffect(() => {
    const checkBackupStatus = () => {
      const lastBackupStr = localStorage.getItem("last_backup_time");
      if (!lastBackupStr) {
        setIsBackupOverdue(true);
      } else {
        const lastBackup = parseInt(lastBackupStr, 10);
        const now = new Date().getTime();
        // 7 days in milliseconds
        if (now - lastBackup > 7 * 24 * 60 * 60 * 1000) {
          setIsBackupOverdue(true);
        } else {
          setIsBackupOverdue(false);
        }
      }
    };

    checkBackupStatus();
    // Re-check periodically or when tab changes
    const interval = setInterval(checkBackupStatus, 60000);
    return () => clearInterval(interval);
  }, [activeTab]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">載入中...</p>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen transition-colors duration-300"
      style={{ background: siteBackground, backgroundAttachment: "fixed" }}
    >

      {/* 遊戲 iframe 容器 */}
      <div className={selectedGame ? "hidden" : ""}>
        <WorkLogBoard />
      </div>

      {isBackupOverdue && !selectedGame && (
        <div className="bg-destructive/10 border-b border-destructive/20 px-6 py-3 flex flex-wrap items-center justify-center gap-2 animate-pulse">
          <AlertTriangle className="w-5 h-5 text-destructive" />
          <span className="text-sm font-medium text-destructive">
            ⚠️ 距離上次備份已超過 7 天（或尚未建立），請立即前往「資料備份與還原」建立新備份，確保資料安全！
          </span>
          <Button variant="outline" size="sm" className="ml-2 h-7 text-xs border-destructive text-destructive hover:bg-destructive hover:text-white" onClick={() => setActiveTab("backup")}>
            立即前往備份
          </Button>
        </div>
      )}

      {/* Header - Hidden when game is active */}
      {!selectedGame && (
        <header className="sticky top-0 z-20 border-b border-border bg-background/90 backdrop-blur-md px-6 py-4">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 flex items-center justify-center">
                <img src="https://api.iconify.design/twemoji/cat-face.svg" alt="Cute Cat" className="w-8 h-8 drop-shadow-sm" />
              </div>
              <div>
                <h1 className="text-base sm:text-lg font-bold whitespace-nowrap tracking-tight">星期一貓旅舍 3.0 管理後台</h1>
                <p className="text-xs text-muted-foreground">星期一貓旅舍 管理後台</p>
              </div>
            </div>
            <div className="flex items-center gap-2">

              <Button variant="outline" size="sm" onClick={handleLogout} className="rounded-full">
                <LogOut className="w-4 h-4 mr-2" />
                登出
              </Button>
            </div>
          </div>
        </header>
      )}

      {/* Content */}
      <main className={`${selectedGame ? 'p-0' : 'max-w-7xl mx-auto px-6 py-8'}`}>
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          {!selectedGame && (
            <div className="mb-6 space-y-2">
              <TabsList className="w-full grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 h-auto gap-1">
                <TabsTrigger value="bookings" className="text-xs sm:text-sm px-1 py-1.5 whitespace-nowrap">住宿管理</TabsTrigger>
                <TabsTrigger value="cabinets" className="text-xs sm:text-sm px-1 py-1.5 whitespace-nowrap">住宿櫃安排表</TabsTrigger>
                <TabsTrigger value="calendar" className="text-xs sm:text-sm px-1 py-1.5 whitespace-nowrap">住退宿行事曆</TabsTrigger>
                <TabsTrigger value="crm" className="text-xs sm:text-sm px-1 py-1.5 whitespace-nowrap">客戶關係管理</TabsTrigger>
                <TabsTrigger value="schedule" className="text-xs sm:text-sm px-1 py-1.5 whitespace-nowrap">週班表產生器</TabsTrigger>
                <TabsTrigger value="photos" className="text-xs sm:text-sm px-1 py-1.5 whitespace-nowrap">環境與住宿照片</TabsTrigger>
              </TabsList>
              <TabsList className="w-full grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 h-auto gap-1">
                <TabsTrigger value="finance" className="text-xs sm:text-sm px-1 py-1.5 whitespace-nowrap">月收支損益表</TabsTrigger>
                <TabsTrigger value="flipclock" className="text-xs sm:text-sm px-1 py-1.5 whitespace-nowrap">全螢幕翻頁鐘</TabsTrigger>
                <TabsTrigger value="shift" className="text-xs sm:text-sm px-1 py-1.5 whitespace-nowrap">打卡出勤系統</TabsTrigger>
                <TabsTrigger value="agreement" className="text-xs sm:text-sm px-1 py-1.5 whitespace-nowrap">店休設定與充電</TabsTrigger>
                <TabsTrigger value="long-agreement" className="text-xs sm:text-sm px-1 py-1.5 whitespace-nowrap">長宿合約書</TabsTrigger>
                <TabsTrigger value="backup" className="text-xs sm:text-sm px-1 py-1.5 whitespace-nowrap">資料備份與還原</TabsTrigger>
              </TabsList>
            </div>
          )}

          <TabsContent value="bookings">
            <AdminBookings />
          </TabsContent>
          <TabsContent value="cabinets">
            <CabinetAssignmentTable />
          </TabsContent>
          <TabsContent value="calendar">
            <CabinetCalendar />
          </TabsContent>
          <TabsContent value="crm">
            <AdminCRM onNavigate={setActiveTab} />
          </TabsContent>
          <TabsContent value="schedule">
            <AdminScheduleGenerator />
          </TabsContent>
          <TabsContent value="photos">
            <AdminPhotos />
          </TabsContent>
          <TabsContent value="finance">
            <AdminFinance />
          </TabsContent>
          <TabsContent value="flipclock">
            <AdminFlipClock />
          </TabsContent>
          <TabsContent value="shift">
            <AdminShiftTracker />
          </TabsContent>
          <TabsContent value="agreement">
            <div className="space-y-6">
              {!selectedGame && (
                <div className="flex items-center justify-between">
                  <h2 className="text-2xl font-bold text-primary">店休設定與充電</h2>
                </div>
              )}

              {selectedGame ? (
                <div
                  className="fixed inset-0 z-[50] bg-black flex flex-col overflow-hidden overscroll-none touch-none"
                  style={{ overscrollBehavior: "none", touchAction: "none" }}
                >
                  {/* Top navigation bar for game mode */}
                  <div className={`game-top-nav ${selectedGame.path === "cat-breaker.html" || selectedGame.path === "crimson-sky-fleet/dist/index.html" || selectedGame.path === "meowdokuplus/index.html" || selectedGame.path === "Sorting Visualizer/index.html" || selectedGame.path === "9_Rings/dist/index.html" || selectedGame.path === "domino3d.html" || selectedGame.path === "last-arcade/index.html" || selectedGame.path === "Fidget_Spinner.html" || selectedGame.path === "San_Yuan.html" || selectedGame.path === "translator_morandi_elvish.html" || selectedGame.path === "JP.html" || selectedGame.path === "Music_Museum/dist/index.html" || selectedGame.path === "Astrology-Pro-main/index.html" || selectedGame.path === "TaiwanRun-main/index.html" ? "game-compact-nav h-9 px-2" : "h-12 px-4"} bg-zinc-900 border-b border-zinc-800 flex items-center justify-between shrink-0 z-10 transition-all`}>
                    <div className="game-title-container flex items-center gap-2 text-white/80 font-bold text-sm truncate">
                      <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse shrink-0"></span>
                      <span className="truncate">{selectedGame.name}</span>
                    </div>
                    <div className="game-buttons-container flex items-center gap-2 shrink-0">
                      <Button
                        variant="secondary"
                        size="sm"
                        className={`game-btn-admin ${selectedGame.path === "cat-breaker.html" || selectedGame.path === "crimson-sky-fleet/dist/index.html" || selectedGame.path === "meowdokuplus/index.html" || selectedGame.path === "Sorting Visualizer/index.html" || selectedGame.path === "9_Rings/dist/index.html" || selectedGame.path === "domino3d.html" || selectedGame.path === "last-arcade/index.html" || selectedGame.path === "Fidget_Spinner.html" || selectedGame.path === "San_Yuan.html" || selectedGame.path === "translator_morandi_elvish.html" || selectedGame.path === "JP.html" || selectedGame.path === "Music_Museum/dist/index.html" || selectedGame.path === "Astrology-Pro-main/index.html" || selectedGame.path === "TaiwanRun-main/index.html" || selectedGame.path === "stellarium-web-sky/dist/index.html" ? "h-7 px-2" : "h-8"} text-xs font-bold bg-white/10 hover:bg-white/20 text-white border-0`}
                        onClick={() => {
                          setSelectedGame(null);
                          setActiveTab("bookings");
                        }}
                      >
                        管理後台
                      </Button>
                      <Button
                        variant="default"
                        size="sm"
                        className={`game-btn-list ${selectedGame.path === "cat-breaker.html" || selectedGame.path === "crimson-sky-fleet/dist/index.html" || selectedGame.path === "meowdokuplus/index.html" || selectedGame.path === "Sorting Visualizer/index.html" || selectedGame.path === "9_Rings/dist/index.html" || selectedGame.path === "domino3d.html" || selectedGame.path === "last-arcade/index.html" || selectedGame.path === "Fidget_Spinner.html" || selectedGame.path === "San_Yuan.html" || selectedGame.path === "translator_morandi_elvish.html" || selectedGame.path === "JP.html" || selectedGame.path === "Music_Museum/dist/index.html" || selectedGame.path === "Astrology-Pro-main/index.html" || selectedGame.path === "TaiwanRun-main/index.html" || selectedGame.path === "stellarium-web-sky/dist/index.html" ? "h-7 px-2" : "h-8"} text-xs font-bold`}
                        onClick={() => setSelectedGame(null)}
                      >
                        遊戲列表
                      </Button>
                    </div>
                  </div>

                  <style>
                    {`
                      @media (max-width: 1024px) and (orientation: landscape) {
                        .game-top-nav:not(.game-compact-nav) {
                          position: absolute;
                          top: 0;
                          left: 0;
                          width: 100%;
                          height: 0 !important;
                          overflow: visible;
                          border: none !important;
                          background: transparent !important;
                          z-index: 50;
                          pointer-events: none;
                        }
                        .game-top-nav:not(.game-compact-nav) .game-title-container {
                          display: none !important;
                        }
                        .game-top-nav:not(.game-compact-nav) .game-buttons-container {
                          position: fixed;
                          top: 50%;
                          left: 0;
                          width: 100%;
                          transform: translateY(-50%);
                          display: flex;
                          justify-content: space-between;
                          padding: 0 10px;
                          pointer-events: none;
                        }
                        .game-top-nav:not(.game-compact-nav) .game-btn-admin,
                        .game-top-nav:not(.game-compact-nav) .game-btn-list {
                          pointer-events: auto;
                          opacity: 0.5;
                          background: rgba(0,0,0,0.4) !important;
                          border: 1px solid rgba(255,255,255,0.1) !important;
                          backdrop-filter: blur(4px);
                        }
                        .game-top-nav:not(.game-compact-nav) .game-btn-admin:hover,
                        .game-top-nav:not(.game-compact-nav) .game-btn-list:hover {
                          opacity: 1;
                        }
                      }
                    `}
                  </style>

                  {(() => {
                    // 內容高於視窗或需上下捲動的頁面，必須允許內部捲動與顯示 scrollbar
                    const gameScrollable = selectedGame.path === "preview.html" || selectedGame.path.startsWith("lattice-mind") || selectedGame.path.startsWith("princess-maker") || selectedGame.path.startsWith("Starweave Duet") || selectedGame.path === "catwork.html" || selectedGame.path === "meowdokuplus/index.html" || selectedGame.path === "Sorting Visualizer/index.html" || selectedGame.path === "camel_race.html" || selectedGame.path === "Dungeons_of_Dreadrock.html" || selectedGame.path.includes("shaoyun_music_theory") || selectedGame.path === "vajra_dsl.html" || selectedGame.path === "translator_morandi_elvish.html" || selectedGame.path === "JP.html" || selectedGame.path === "kerykeion-main/scripts/glyph_playground.html" || selectedGame.path === "Astrology-Pro-main/index.html" || selectedGame.path === "TaiwanRun-main/index.html";
                    return (
                      <div
                        className={`flex-1 w-full relative flex items-center justify-center ${gameScrollable ? "overflow-y-auto overflow-x-hidden" : "overflow-hidden overscroll-none touch-none"}`}
                        style={gameScrollable ? { WebkitOverflowScrolling: "touch" } : { overscrollBehavior: "none", touchAction: "none" }}
                      >
                        <iframe
                          src={(() => {
                            // path 可能自帶查詢參數（如 fly.html?ai=demo），
                            // 直接在後面接 ?v= 會產生雙問號，所以先拆開再組。
                            const [file, query] = selectedGame.path.split('?');
                            const params = new URLSearchParams(query || '');
                            params.set('v', String(Date.now()));
                            return `/games/${file}?${params.toString()}`;
                          })()}
                          className="w-full h-full border-none max-w-full max-h-full absolute inset-0"
                          title={selectedGame.name}
                          scrolling={gameScrollable ? "auto" : "no"}
                          style={{ overflow: gameScrollable ? 'auto' : 'hidden', minHeight: selectedGame.path.includes('stellarium') ? '400px' : undefined }}
                        />
                      </div>
                    );
                  })()}
                </div>
              ) : (
                <>
                  <AdminStoreClosure />
                  {/* Lawweaver AI 控制面板 */}
                  <div className="mt-6 p-4 bg-indigo-50 rounded border border-indigo-200">
                    <h4 className="font-medium mb-3 flex items-center gap-2">
                      <Zap className="w-4 h-4 text-purple-400" /> Lawweaver AI 自動玩家
                    </h4>
                    <div className="space-y-2 text-sm">
                      <div className="flex gap-2">
                        <Button
                          onClick={() => setLawweaverAIState(prev => ({ ...prev, isPlaying: true }))}
                          disabled={lawweaverAI.state.isPlaying}
                          className="flex-1 py-2">
                          <Play className="w-4 h-4 mr-2" /> 啟動 AI
                        </Button>
                        <Button
                          onClick={() => setLawweaverAIState(prev => ({ ...prev, isPlaying: false }))}
                          disabled={!lawweaverAI.state.isPlaying}
                          variant="outline"
                          className="flex-1 py-2">
                          <Pause className="w-4 h-4 mr-2" /> 停止
                        </Button>
                      </div>
                      <div className="p-2 bg-white rounded border border-gray-200">
                        <p className="font-medium">關卡: {lawweaverAI.state.currentLevel + 1}</p>
                        <p className="font-medium">過關: {lawweaverAI.state.levelsCleared} 個</p>
                        <p className="font-medium">回合: {lawweaverAI.state.totalTurns}</p>
                      </div>
                    </div>
                  </div>
                  
                  <h3 className="mt-8 text-xl font-bold text-primary">遊戲區</h3>
                  <div className={`mx-auto mt-5 w-fit max-w-full rounded-full px-4 py-2 text-center text-sm sm:text-base font-bold text-[#635F6D] bg-[#D7D2DC] ${games.length >= 100 ? "animate-pulse bg-gradient-to-r from-[#D8C8A8] via-[#D8B8C8] to-[#AFC5B8] shadow-[0_0_18px_rgba(180,160,190,0.9)]" : ""}`}>{games.length >= 100 ? "Aymi設計100款小遊戲合集(完成!)" : `Aymi設計100款(目前${games.length}款)小遊戲合集(目前尚未達標!)`}</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 mt-6">
                    {games.map((game, i) => {
                      const landscapeGames = ['cat.html', 'fly.html', 'FTF.html', 'Gemini手機版四色牌.html', 'big-two.html', 'sic-bo.html', 'arpg.html', 'hong_kong_five_card_stud.html', 'kgbsdp.html', 'stellarium-web-master/index.html'];
                      const portraitGames = ['neon-breaker.html', 'Neon Pro Air Hockey.html', 'xq-ai-battle.html'];
                      const needsLandscape = landscapeGames.includes(game.path.split('?')[0]);
                      const needsPortrait = portraitGames.includes(game.path);
                      return (
                        <button
                          key={i}
                          onClick={() => {
                            const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || window.innerWidth < 768;
                            if (isMobile && needsLandscape) {
                              if (confirm('📱 建議將手機轉為橫向顯示，以獲得最佳遊戲體驗！\n\n按「確定」繼續進入遊戲。')) {
                                setSelectedGame(game);
                              }
                            } else if (isMobile && needsPortrait) {
                              if (confirm('📱 建議將手機轉為直向顯示，以獲得最佳遊戲體驗！\n\n按「確定」繼續進入遊戲。')) {
                                setSelectedGame(game);
                              }
                            } else {
                              setSelectedGame(game);
                            }
                          }}
                          className="group p-6 shadow-sm rounded-xl hover:shadow-md hover:-translate-y-1 active:shadow-md active:-translate-y-1 transition-all text-center flex flex-col items-center justify-center gap-2 h-32 border border-black/5"
                          style={{ backgroundColor: (game as any).color || '#E8E5DF' }}
                        >
                          <span className="font-bold text-lg text-gray-800 drop-shadow-[0_1px_1px_rgba(255,255,255,0.5)] group-hover:[text-shadow:1px_1px_0px_#b3b3b3] group-active:[text-shadow:1px_1px_0px_#b3b3b3] transition-all duration-300">{game.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </TabsContent>
          <TabsContent value="long-agreement">
            <AdminLongTermAgreement />
          </TabsContent>
          <TabsContent value="backup">
            <AdminBackup />
          </TabsContent>
        </Tabs>
      </main>

      {/* Overdue Checkout Dialog */}
      <AlertDialog open={showOverdueDialog} onOpenChange={setShowOverdueDialog}>
        <AlertDialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle>⚠️ 有預約已超過退宿時間</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>以下 {overdueBookings.length} 筆預約已超過退宿日 24 小時，但狀態尚未更新為「已退宿」：</p>
                <div className="space-y-2 max-h-[300px] overflow-y-auto">
                  {overdueBookings.map(b => (
                    <div key={b.id} className="p-2 bg-muted rounded-lg text-sm">
                      <span className="font-medium">{b.cat_name}</span>
                      <span className="text-muted-foreground ml-2">({b.owner_name})</span>
                      <span className="text-muted-foreground ml-2">退宿日：{b.check_out_date}</span>
                    </div>
                  ))}
                </div>
                <p>是否要將這些預約狀態更改為「已退宿」？</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>稍後處理</AlertDialogCancel>
            <AlertDialogAction onClick={handleMarkOverdueAsCheckedOut}>
              全部更新為已退宿
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Overdue Long Term Payment Dialog */}
      <AlertDialog open={showOverdueLongTermDialog} onOpenChange={setShowOverdueLongTermDialog}>
        <AlertDialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-orange-600">💰 長宿費用催繳通知</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>以下 {overdueLongTerm.length} 筆長宿預約已達或超過收款截止日，尚未設定為「已收」：</p>
                <div className="space-y-2 max-h-[300px] overflow-y-auto">
                  {overdueLongTerm.map(b => {
                    const month = b.long_term_collection_date ? b.long_term_collection_date.split("-")[1] : "x";
                    return (
                      <div key={b.id} className="p-3 bg-orange-50 border border-orange-200 rounded-lg text-sm">
                        <div className="font-bold text-orange-800">
                          請管理者記得去跟 {b.owner_name} 收 {month} 月月費 {b.long_term_amount || 0} 元
                        </div>
                        <div className="text-muted-foreground mt-1">
                          貓咪：{b.cat_name} | 截止日：{b.long_term_collection_date}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <p>請記得聯絡飼主收費，收到後請至「住宿管理」將該月長宿費改為「已收」。</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setShowOverdueLongTermDialog(false)}>
              知道了
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <CatEasterEgg isAdmin={true} disabled={!!selectedGame} />
    </div>
  );
};

export default Admin;
