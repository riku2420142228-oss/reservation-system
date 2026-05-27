"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  LogOut,
  Plus,
  Loader2,
  Trash2,
  Pencil,
  Check,
  X,
  AlertCircle,
  Users,
  Settings2,
  CalendarDays,
  UserMinus,
  ListChecks,
  Palette,
  Upload,
} from "lucide-react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import {
  signOut,
  fetchCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  fetchStaffs,
  createStaff,
  updateStaff,
  deleteStaff,
  fetchTimeSlotsInRange,
  createTimeSlot,
  createTimeSlots,
  updateTimeSlot,
  deleteTimeSlotsByIds,
  fetchReservationsInRange,
  updateReservationStatus,
  deleteReservation,
  fetchFormFields,
  createFormField,
  updateFormField,
  deleteFormField,
  fetchBrandingSettings,
  saveBrandingSettings,
  uploadLogo,
  type Category,
  type Staff,
  type TimeSlot,
  type AdminReservation,
  type FormField,
  type BrandingSettings,
} from "@/lib/supabase";

function cn(...inputs: (string | undefined | null | boolean)[]) {
  return twMerge(clsx(inputs));
}

// =========================================================
// 定数
// =========================================================
const BUSINESS_HOURS_START = 0;
const BUSINESS_HOURS_END = 24;
const TOTAL_HOURS = BUSINESS_HOURS_END - BUSINESS_HOURS_START;
const HOUR_HEIGHT = 64;
const SNAP_MINUTES = 10;
const TOTAL_HEIGHT = TOTAL_HOURS * HOUR_HEIGHT;
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
const COLOR_PRESETS = [
  "#3b82f6", "#10b981", "#f59e0b", "#ef4444",
  "#8b5cf6", "#ec4899", "#14b8a6", "#6366f1",
];
// 月〜日の順（日=0, 月=1, ..., 土=6）
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

// =========================================================
// ヘルパー
// =========================================================
function errorMessage(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}

function timeToAbsMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function absMinutesToY(minutes: number): number {
  return (minutes - BUSINESS_HOURS_START * 60) * (HOUR_HEIGHT / 60);
}

function yToAbsMinutes(y: number): number {
  const rawMinutes = Math.max(0, Math.min((y / HOUR_HEIGHT) * 60, TOTAL_HOURS * 60));
  const snapped = Math.round(rawMinutes / SNAP_MINUTES) * SNAP_MINUTES;
  return BUSINESS_HOURS_START * 60 + snapped;
}

function absMinutesToTime(minutes: number): string {
  const clamped = Math.min(minutes, BUSINESS_HOURS_END * 60);
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
}

function absMinutesToDisplay(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

function computeSlotLayout(slots: TimeSlot[]): Map<string, { col: number; totalCols: number }> {
  if (slots.length === 0) return new Map();

  const sorted = [...slots].sort(
    (a, b) => timeToAbsMinutes(a.start_time) - timeToAbsMinutes(b.start_time)
  );

  const colEnds: number[] = [];
  const slotCols = new Map<string, number>();
  for (const slot of sorted) {
    const start = timeToAbsMinutes(slot.start_time);
    const end = timeToAbsMinutes(slot.end_time);
    let col = colEnds.findIndex((e) => e <= start);
    if (col === -1) col = colEnds.length;
    colEnds[col] = end;
    slotCols.set(slot.id, col);
  }

  const parent: Record<string, string> = {};
  for (const s of sorted) parent[s.id] = s.id;

  const find = (id: string): string => {
    if (parent[id] !== id) parent[id] = find(parent[id]);
    return parent[id];
  };
  const union = (a: string, b: string) => { parent[find(a)] = find(b); };

  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      if (timeToAbsMinutes(sorted[j].start_time) >= timeToAbsMinutes(sorted[i].end_time)) break;
      union(sorted[i].id, sorted[j].id);
    }
  }

  const compMaxCol: Record<string, number> = {};
  for (const s of sorted) {
    const root = find(s.id);
    compMaxCol[root] = Math.max(compMaxCol[root] ?? 0, slotCols.get(s.id)!);
  }

  const result = new Map<string, { col: number; totalCols: number }>();
  for (const s of sorted) {
    const root = find(s.id);
    result.set(s.id, {
      col: slotCols.get(s.id)!,
      totalCols: (compMaxCol[root] ?? 0) + 1,
    });
  }
  return result;
}

function computeRepeatDates(startDate: string, endDate: string, weekdays: number[]): string[] {
  const [sy, sm, sd] = startDate.split("-").map(Number);
  const [ey, em, ed] = endDate.split("-").map(Number);
  const cur = new Date(sy, sm - 1, sd);
  const end = new Date(ey, em - 1, ed);
  const dates: string[] = [];
  while (cur <= end) {
    if (weekdays.includes(cur.getDay())) dates.push(formatDate(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

// =========================================================
// メインページ
// =========================================================
export default function AdminPage() {
  const router = useRouter();
  const today = useMemo(() => new Date(), []);

  const [tab, setTab] = useState<"slots" | "bookings" | "fields" | "design">("slots");

  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [staffs, setStaffs] = useState<Staff[]>([]);
  const [selectedStaffId, setSelectedStaffId] = useState<string | null>(null);
  const [formFields, setFormFields] = useState<FormField[]>([]);

  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState<Date>(today);

  const [monthSlots, setMonthSlots] = useState<TimeSlot[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingSlot, setPendingSlot] = useState<{
    startTime: string;
    endTime: string;
    date: Date;
  } | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null);
  const [showManualAdd, setShowManualAdd] = useState(false);
  const [tapStartTime, setTapStartTime] = useState<string | undefined>(undefined);

  const reloadFormFields = useCallback(async () => {
    const fields = await fetchFormFields();
    setFormFields(fields);
  }, []);

  useEffect(() => {
    (async () => {
      const [catsResult, stfsResult, fieldsResult] = await Promise.allSettled([
        fetchCategories(),
        fetchStaffs(),
        fetchFormFields(),
      ]);

      if (catsResult.status === "fulfilled") {
        setCategories(catsResult.value);
        if (catsResult.value.length > 0) setSelectedCategoryId(catsResult.value[0].id);
      } else {
        setError(errorMessage(catsResult.reason, "カテゴリの読み込みに失敗しました"));
      }

      if (stfsResult.status === "fulfilled") {
        setStaffs(stfsResult.value);
      } else {
        setError(errorMessage(stfsResult.reason, "スタッフの読み込みに失敗しました"));
      }

      if (fieldsResult.status === "fulfilled") {
        setFormFields(fieldsResult.value);
      } else {
        setError(errorMessage(fieldsResult.reason, "問診票項目の読み込みに失敗しました（form_fieldsテーブルが未作成の可能性があります）"));
      }
    })();
  }, []);

  const reloadMonthSlots = useCallback(async () => {
    setIsLoading(true);
    try {
      const start = `${currentYear}-${String(currentMonth + 1).padStart(2, "0")}-01`;
      const last = getDaysInMonth(currentYear, currentMonth);
      const end = `${currentYear}-${String(currentMonth + 1).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
      const slots = await fetchTimeSlotsInRange(start, end);
      setMonthSlots(slots);
    } catch (e) {
      setError(errorMessage(e, "予約枠の読み込みに失敗しました"));
    } finally {
      setIsLoading(false);
    }
  }, [currentYear, currentMonth]);

  useEffect(() => {
    reloadMonthSlots();
  }, [reloadMonthSlots]);

  const handleLogout = async () => {
    try {
      await signOut();
      router.replace("/admin/login");
    } catch (e) {
      setError(errorMessage(e, "ログアウトに失敗しました"));
    }
  };

  const goPrevMonth = () => {
    if (currentMonth === 0) { setCurrentYear((y) => y - 1); setCurrentMonth(11); }
    else setCurrentMonth((m) => m - 1);
  };
  const goNextMonth = () => {
    if (currentMonth === 11) { setCurrentYear((y) => y + 1); setCurrentMonth(0); }
    else setCurrentMonth((m) => m + 1);
  };

  const categoryMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const staffMap = useMemo(() => new Map(staffs.map((s) => [s.id, s])), [staffs]);

  const selectedDateStr = formatDate(selectedDate);
  const slotsByDate = useMemo(() => {
    const map = new Map<string, TimeSlot[]>();
    for (const s of monthSlots) {
      const list = map.get(s.slot_date) ?? [];
      list.push(s);
      map.set(s.slot_date, list);
    }
    return map;
  }, [monthSlots]);

  const selectedSlots = slotsByDate.get(selectedDateStr) ?? [];

  const daysInMonth = getDaysInMonth(currentYear, currentMonth);
  const firstDayOfMonth = getFirstDayOfMonth(currentYear, currentMonth);
  const calendarDays: (number | null)[] = [];
  for (let i = 0; i < firstDayOfMonth; i++) calendarDays.push(null);
  for (let d = 1; d <= daysInMonth; d++) calendarDays.push(d);

  const colorsForDay = (day: number): string[] => {
    const dateStr = formatDate(new Date(currentYear, currentMonth, day));
    const slots = slotsByDate.get(dateStr) ?? [];
    const colorSet = new Set<string>();
    for (const s of slots) {
      const c = categoryMap.get(s.category_id);
      if (c) colorSet.add(c.color);
    }
    return Array.from(colorSet).slice(0, 4);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ヘッダー */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4">
          {/* 1行目: タイトル + ログアウト */}
          <div className="flex items-center justify-between py-2.5">
            <h1 className="text-base font-semibold text-gray-800">予約システム 管理</h1>
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">ログアウト</span>
            </button>
          </div>
          {/* 2行目: タブ（横スクロール対応） */}
          <div className="flex gap-0.5 overflow-x-auto pb-2 scrollbar-hide">
            <button
              onClick={() => setTab("slots")}
              className={cn(
                "flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap flex-shrink-0",
                tab === "slots"
                  ? "bg-gray-100 text-gray-900 font-medium"
                  : "text-gray-500 hover:text-gray-800 hover:bg-gray-50"
              )}
            >
              <Settings2 className="w-4 h-4" />
              枠管理
            </button>
            <button
              onClick={() => setTab("bookings")}
              className={cn(
                "flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap flex-shrink-0",
                tab === "bookings"
                  ? "bg-gray-100 text-gray-900 font-medium"
                  : "text-gray-500 hover:text-gray-800 hover:bg-gray-50"
              )}
            >
              <CalendarDays className="w-4 h-4" />
              予約一覧
            </button>
            <button
              onClick={() => setTab("fields")}
              className={cn(
                "flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap flex-shrink-0",
                tab === "fields"
                  ? "bg-gray-100 text-gray-900 font-medium"
                  : "text-gray-500 hover:text-gray-800 hover:bg-gray-50"
              )}
            >
              <ListChecks className="w-4 h-4" />
              問診票設定
            </button>
            <button
              onClick={() => setTab("design")}
              className={cn(
                "flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap flex-shrink-0",
                tab === "design"
                  ? "bg-gray-100 text-gray-900 font-medium"
                  : "text-gray-500 hover:text-gray-800 hover:bg-gray-50"
              )}
            >
              <Palette className="w-4 h-4" />
              デザイン設定
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6">
        {error && (
          <div className="mb-4 flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
            <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">{error}</p>
            <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-600">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* 枠管理タブ */}
        {tab === "slots" && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              <CategoryPanel
                categories={categories}
                selectedCategoryId={selectedCategoryId}
                onSelect={setSelectedCategoryId}
                onChange={async () => {
                  const cats = await fetchCategories();
                  setCategories(cats);
                  if (selectedCategoryId && !cats.find((c) => c.id === selectedCategoryId)) {
                    setSelectedCategoryId(cats[0]?.id ?? null);
                  }
                }}
                onError={setError}
              />
              <StaffPanel
                staffs={staffs}
                selectedStaffId={selectedStaffId}
                onSelect={setSelectedStaffId}
                onChange={async () => {
                  const stfs = await fetchStaffs();
                  setStaffs(stfs);
                  if (selectedStaffId && !stfs.find((s) => s.id === selectedStaffId)) {
                    setSelectedStaffId(null);
                  }
                }}
                onError={setError}
              />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-6">
              <section className="bg-white rounded-2xl border border-gray-200 p-5">
                <div className="flex items-center justify-between mb-5">
                  <button onClick={goPrevMonth} className="p-2 hover:bg-gray-100 rounded-full">
                    <ChevronLeft className="w-5 h-5 text-gray-500" />
                  </button>
                  <h2 className="text-base font-semibold text-gray-800">
                    {currentYear}年{currentMonth + 1}月
                  </h2>
                  <button onClick={goNextMonth} className="p-2 hover:bg-gray-100 rounded-full">
                    <ChevronRight className="w-5 h-5 text-gray-500" />
                  </button>
                </div>
                <div className="grid grid-cols-7 gap-1 mb-2">
                  {WEEKDAYS.map((d, i) => (
                    <div
                      key={d}
                      className={cn(
                        "text-center text-xs font-medium py-2",
                        i === 0 && "text-red-400",
                        i === 6 && "text-blue-400",
                        i !== 0 && i !== 6 && "text-gray-400"
                      )}
                    >
                      {d}
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {calendarDays.map((day, index) => {
                    if (day === null) return <div key={`e-${index}`} className="h-12" />;
                    const dateStr = formatDate(new Date(currentYear, currentMonth, day));
                    const isSelected = selectedDateStr === dateStr;
                    const isToday =
                      today.getFullYear() === currentYear &&
                      today.getMonth() === currentMonth &&
                      today.getDate() === day;
                    const dots = colorsForDay(day);
                    return (
                      <button
                        key={day}
                        onClick={() => setSelectedDate(new Date(currentYear, currentMonth, day))}
                        className={cn(
                          "h-12 mx-auto w-full rounded-lg text-sm font-medium transition-all flex flex-col items-center justify-center gap-1",
                          isSelected && "bg-blue-500 text-white",
                          !isSelected && isToday && "ring-1 ring-blue-300 text-gray-800",
                          !isSelected && !isToday && "text-gray-700 hover:bg-gray-100"
                        )}
                      >
                        <span>{day}</span>
                        {dots.length > 0 && (
                          <span className="flex gap-0.5">
                            {dots.map((color, i) => (
                              <span
                                key={i}
                                className="w-1.5 h-1.5 rounded-full"
                                style={{ backgroundColor: isSelected ? "#fff" : color }}
                              />
                            ))}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </section>

              <section className="bg-white rounded-2xl border border-gray-200 p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-base font-semibold text-gray-800">
                      {selectedDate.getFullYear()}年{selectedDate.getMonth() + 1}月
                      {selectedDate.getDate()}日（{WEEKDAYS[selectedDate.getDay()]}）
                    </h2>
                    <p className="text-xs text-gray-500 mt-0.5 hidden sm:block">
                      ドラッグで枠を作成。枠をクリックで設定・削除。
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5 sm:hidden">
                      枠をタップで設定・削除。
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        if (!selectedCategoryId) {
                          setError("先にカテゴリを選択してください");
                          return;
                        }
                        setTapStartTime(undefined);
                        setShowManualAdd(true);
                      }}
                      className="flex items-center gap-1 text-sm text-blue-600 px-3 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 transition-colors"
                    >
                      <Plus className="w-4 h-4" />
                      <span>追加</span>
                    </button>
                    {isLoading && <Loader2 className="w-5 h-5 animate-spin text-gray-400" />}
                  </div>
                </div>
                <TimeGrid
                  key={selectedDateStr}
                  slots={selectedSlots}
                  categoryMap={categoryMap}
                  staffMap={staffMap}
                  selectedCategoryId={selectedCategoryId}
                  selectedStaffId={selectedStaffId}
                  onCreate={async (startTime, endTime) => {
                    if (!selectedCategoryId) {
                      setError("先にカテゴリを選択してください");
                      return;
                    }
                    setPendingSlot({ startTime, endTime, date: selectedDate });
                  }}
                  onSelect={(slot) => setSelectedSlot(slot)}
                  onTap={(tappedTime) => {
                    if (!selectedCategoryId) {
                      setError("先にカテゴリを選択してください");
                      return;
                    }
                    setTapStartTime(tappedTime);
                    setShowManualAdd(true);
                  }}
                />
              </section>
            </div>

            {pendingSlot && selectedCategoryId && (
              <SlotCreateModal
                date={pendingSlot.date}
                startTime={pendingSlot.startTime}
                endTime={pendingSlot.endTime}
                categoryId={selectedCategoryId}
                staffId={selectedStaffId}
                categoryMap={categoryMap}
                onSave={async (slots) => {
                  try {
                    if (slots.length === 1) {
                      await createTimeSlot(slots[0]);
                    } else {
                      await createTimeSlots(slots);
                    }
                    await reloadMonthSlots();
                    setPendingSlot(null);
                  } catch (e) {
                    setError(errorMessage(e, "予約枠の作成に失敗しました"));
                    setPendingSlot(null);
                  }
                }}
                onCancel={() => setPendingSlot(null)}
              />
            )}

            {selectedSlot && (
              <SlotEditModal
                slot={selectedSlot}
                categoryMap={categoryMap}
                staffMap={staffMap}
                onSave={async (id, capacity) => {
                  await updateTimeSlot(id, { capacity });
                  await reloadMonthSlots();
                }}
                onDelete={async (id) => {
                  await deleteTimeSlotsByIds([id]);
                  await reloadMonthSlots();
                }}
                onClose={() => setSelectedSlot(null)}
                onError={setError}
              />
            )}

            {showManualAdd && selectedCategoryId && (
              <ManualSlotPickerModal
                date={selectedDate}
                initialStartTime={tapStartTime}
                onConfirm={(startTime, endTime) => {
                  setShowManualAdd(false);
                  setTapStartTime(undefined);
                  setPendingSlot({ startTime, endTime, date: selectedDate });
                }}
                onCancel={() => {
                  setShowManualAdd(false);
                  setTapStartTime(undefined);
                }}
              />
            )}
          </>
        )}

        {/* 予約一覧タブ */}
        {tab === "bookings" && (
          <BookingsView
            categoryMap={categoryMap}
            staffMap={staffMap}
            onError={setError}
          />
        )}

        {/* 問診票設定タブ */}
        {tab === "fields" && (
          <FormFieldPanel
            formFields={formFields}
            onChange={reloadFormFields}
            onError={setError}
          />
        )}

        {/* デザイン設定タブ */}
        {tab === "design" && (
          <BrandingPanel onError={setError} />
        )}
      </main>
    </div>
  );
}

// =========================================================
// 手動時間入力モーダル（モバイル向け枠追加）
// =========================================================
function ManualSlotPickerModal({
  date,
  initialStartTime,
  onConfirm,
  onCancel,
}: {
  date: Date;
  initialStartTime?: string;
  onConfirm: (startTime: string, endTime: string) => void;
  onCancel: () => void;
}) {
  const initStart = initialStartTime ?? "09:00";
  const initEnd = (() => {
    const [h, m] = initStart.split(":").map(Number);
    const totalMin = Math.min(h * 60 + m + 60, 24 * 60);
    const nh = Math.floor(totalMin / 60);
    const nm = totalMin % 60;
    return `${String(nh).padStart(2, "0")}:${String(nm).padStart(2, "0")}`;
  })();

  const [startTime, setStartTime] = useState(initStart);
  const [endTime, setEndTime] = useState(initEnd);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = () => {
    setError(null);
    if (!startTime || !endTime) {
      setError("開始時間と終了時間を入力してください");
      return;
    }
    const [sh, sm] = startTime.split(":").map(Number);
    const [eh, em] = endTime.split(":").map(Number);
    const startMin = sh * 60 + sm;
    const endMin = eh * 60 + em;
    if (endMin <= startMin) {
      setError("終了時間は開始時間より後にしてください");
      return;
    }
    onConfirm(`${startTime}:00`, `${endTime}:00`);
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">時間を指定して追加</h3>
          <button onClick={onCancel} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div className="bg-gray-50 rounded-xl p-3">
            <div className="flex items-center gap-2 text-sm text-gray-700">
              <CalendarDays className="w-4 h-4 text-gray-400 flex-shrink-0" />
              <span>
                {date.getFullYear()}年{date.getMonth() + 1}月{date.getDate()}日
                （{WEEKDAYS[date.getDay()]}）
              </span>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">
              開始時間
            </label>
            <input
              type="time"
              step="600"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="w-full px-3 py-3 rounded-lg border border-gray-200 text-base outline-none focus:border-blue-500 bg-white"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">
              終了時間
            </label>
            <input
              type="time"
              step="600"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="w-full px-3 py-3 rounded-lg border border-gray-200 text-base outline-none focus:border-blue-500 bg-white"
            />
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
        <div className="px-5 py-4 border-t border-gray-100 flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl text-sm font-medium border border-gray-200 text-gray-700 hover:bg-gray-50 transition-colors"
          >
            キャンセル
          </button>
          <button
            onClick={handleConfirm}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-blue-500 text-white hover:bg-blue-600 transition-colors"
          >
            次へ
          </button>
        </div>
      </div>
    </div>
  );
}

// =========================================================
// 枠作成モーダル（単発 or 毎週繰り返し）
// =========================================================
function SlotCreateModal({
  date,
  startTime,
  endTime,
  categoryId,
  staffId,
  categoryMap,
  onSave,
  onCancel,
}: {
  date: Date;
  startTime: string;
  endTime: string;
  categoryId: string;
  staffId: string | null;
  categoryMap: Map<string, Category>;
  onSave: (slots: Array<Omit<TimeSlot, "id" | "created_at">>) => Promise<void>;
  onCancel: () => void;
}) {
  const dateStr = formatDate(date);
  const category = categoryMap.get(categoryId);

  const defaultEndDate = (() => {
    const d = new Date(date);
    d.setMonth(d.getMonth() + 1);
    return formatDate(d);
  })();

  const [capacity, setCapacity] = useState(1);
  const [isRepeat, setIsRepeat] = useState(false);
  const [selectedWeekdays, setSelectedWeekdays] = useState<number[]>([date.getDay()]);
  const [repeatEndDate, setRepeatEndDate] = useState(defaultEndDate);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const toggleWeekday = (day: number) => {
    setSelectedWeekdays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  };

  const previewCount = useMemo(() => {
    if (!isRepeat || !repeatEndDate || selectedWeekdays.length === 0) return 0;
    return computeRepeatDates(dateStr, repeatEndDate, selectedWeekdays).length;
  }, [isRepeat, repeatEndDate, selectedWeekdays, dateStr]);

  const handleSave = async () => {
    setLocalError(null);
    let slots: Array<Omit<TimeSlot, "id" | "created_at">>;

    if (isRepeat) {
      if (!repeatEndDate) {
        setLocalError("繰り返し終了日を指定してください");
        return;
      }
      if (repeatEndDate < dateStr) {
        setLocalError("終了日は開始日以降の日付を指定してください");
        return;
      }
      if (selectedWeekdays.length === 0) {
        setLocalError("繰り返す曜日を1つ以上選択してください");
        return;
      }
      const dates = computeRepeatDates(dateStr, repeatEndDate, selectedWeekdays);
      if (dates.length === 0) {
        setLocalError("指定された期間・曜日に該当する日がありません");
        return;
      }
      slots = dates.map((d) => ({
        slot_date: d,
        start_time: startTime,
        end_time: endTime,
        category_id: categoryId,
        staff_id: staffId,
        capacity,
      }));
    } else {
      slots = [{ slot_date: dateStr, start_time: startTime, end_time: endTime, category_id: categoryId, staff_id: staffId, capacity }];
    }

    setBusy(true);
    try {
      await onSave(slots);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
        {/* ヘッダー */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">予約枠を作成</h3>
          <button onClick={onCancel} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        {/* ボディ */}
        <div className="px-5 py-4 space-y-4">
          {/* 基本情報 */}
          <div className="bg-gray-50 rounded-xl p-3 space-y-1.5">
            <div className="flex items-center gap-2 text-sm text-gray-700">
              <CalendarDays className="w-4 h-4 text-gray-400 flex-shrink-0" />
              <span>
                {date.getFullYear()}年{date.getMonth() + 1}月{date.getDate()}日（{WEEKDAYS[date.getDay()]}）
              </span>
            </div>
            <div className="flex items-center gap-2 text-sm text-gray-700">
              <span className="w-4 h-4 flex-shrink-0" />
              <span>{startTime.slice(0, 5)} 〜 {endTime.slice(0, 5)}</span>
            </div>
            {category && (
              <div className="flex items-center gap-2 text-sm text-gray-700">
                <span className="w-4 h-4 flex-shrink-0 flex items-center justify-center">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: category.color }} />
                </span>
                <span>{category.name}</span>
              </div>
            )}
          </div>

          {/* 定員 */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">
              定員（最大受付人数）
            </label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCapacity((c) => Math.max(1, c - 1))}
                className="w-11 h-11 rounded-xl bg-gray-100 hover:bg-gray-200 active:bg-gray-300 flex items-center justify-center text-gray-700 text-xl font-bold transition-colors select-none flex-shrink-0"
              >
                −
              </button>
              <input
                type="number"
                min={1}
                value={capacity}
                onChange={(e) => setCapacity(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-16 px-2 py-2 rounded-lg border border-gray-200 text-base outline-none focus:border-blue-500 bg-white text-center font-semibold"
              />
              <button
                type="button"
                onClick={() => setCapacity((c) => c + 1)}
                className="w-11 h-11 rounded-xl bg-gray-100 hover:bg-gray-200 active:bg-gray-300 flex items-center justify-center text-gray-700 text-xl font-bold transition-colors select-none flex-shrink-0"
              >
                ＋
              </button>
              <span className="text-sm text-gray-500">人</span>
            </div>
          </div>

          {/* 繰り返しトグル */}
          <button
            type="button"
            onClick={() => setIsRepeat((v) => !v)}
            className="flex items-center gap-3 w-full text-left select-none"
          >
            <div
              className={cn(
                "w-10 h-6 rounded-full transition-colors relative flex-shrink-0",
                isRepeat ? "bg-blue-500" : "bg-gray-200"
              )}
            >
              <span
                className={cn(
                  "absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform",
                  isRepeat ? "translate-x-5" : "translate-x-1"
                )}
              />
            </div>
            <span className="text-sm font-medium text-gray-800">毎週繰り返す</span>
          </button>

          {/* 繰り返し設定（展開） */}
          {isRepeat && (
            <div className="space-y-3 pt-1">
              {/* 曜日選択 */}
              <div>
                <div className="text-xs font-medium text-gray-500 mb-2">繰り返す曜日</div>
                <div className="flex gap-1.5">
                  {WEEKDAY_ORDER.map((day) => (
                    <button
                      key={day}
                      type="button"
                      onClick={() => toggleWeekday(day)}
                      className={cn(
                        "w-9 h-9 rounded-full text-sm font-medium transition-all",
                        selectedWeekdays.includes(day)
                          ? day === 0
                            ? "bg-red-500 text-white"
                            : day === 6
                            ? "bg-blue-400 text-white"
                            : "bg-blue-500 text-white shadow-sm"
                          : day === 0
                          ? "bg-gray-100 text-red-500 hover:bg-red-50"
                          : day === 6
                          ? "bg-gray-100 text-blue-500 hover:bg-blue-50"
                          : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                      )}
                    >
                      {WEEKDAYS[day]}
                    </button>
                  ))}
                </div>
              </div>

              {/* 終了日 */}
              <div>
                <div className="text-xs font-medium text-gray-500 mb-1">繰り返し終了日</div>
                <input
                  type="date"
                  value={repeatEndDate}
                  min={dateStr}
                  onChange={(e) => setRepeatEndDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:border-blue-500 bg-white"
                />
              </div>

              {/* 作成プレビュー */}
              {previewCount > 0 && (
                <div className="text-xs text-blue-700 bg-blue-50 px-3 py-2 rounded-lg">
                  {previewCount}件の枠を一括作成します
                </div>
              )}
            </div>
          )}

          {localError && (
            <p className="text-xs text-red-600">{localError}</p>
          )}
        </div>

        {/* フッター */}
        <div className="px-5 py-4 border-t border-gray-100 flex gap-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="flex-1 py-2 rounded-xl text-sm font-medium border border-gray-200 text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            キャンセル
          </button>
          <button
            onClick={handleSave}
            disabled={busy}
            className="flex-1 py-2 rounded-xl text-sm font-semibold bg-blue-500 text-white hover:bg-blue-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            {busy ? (
              <><Loader2 className="w-3.5 h-3.5 animate-spin" />作成中...</>
            ) : isRepeat && previewCount > 0 ? (
              `${previewCount}件 作成`
            ) : (
              "作成"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// =========================================================
// 予約枠編集モーダル（定員変更・削除）
// =========================================================
function SlotEditModal({
  slot,
  categoryMap,
  staffMap,
  onSave,
  onDelete,
  onClose,
  onError,
}: {
  slot: TimeSlot;
  categoryMap: Map<string, Category>;
  staffMap: Map<string, Staff>;
  onSave: (id: string, capacity: number) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onClose: () => void;
  onError: (msg: string) => void;
}) {
  const [capacity, setCapacity] = useState(slot.capacity ?? 1);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const cat = categoryMap.get(slot.category_id);
  const staff = slot.staff_id ? staffMap.get(slot.staff_id) : null;

  const handleSave = async () => {
    if (capacity < 1) { setLocalError("定員は1以上の整数を入力してください"); return; }
    setBusy(true);
    setLocalError(null);
    try {
      await onSave(slot.id, capacity);
      onClose();
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : "保存に失敗しました");
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    const timeLabel = `${slot.start_time.slice(0, 5)}〜${slot.end_time.slice(0, 5)}`;
    const catLabel = cat ? `「${cat.name}」` : "";
    if (!confirm(`${timeLabel} の${catLabel}枠を削除しますか？`)) return;
    setBusy(true);
    try {
      await onDelete(slot.id);
      onClose();
    } catch (e) {
      onError(e instanceof Error ? e.message : "削除に失敗しました");
      setBusy(false);
    }
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const slotDate = slot.slot_date
    ? (() => {
        const d = new Date(slot.slot_date + "T00:00:00");
        return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${WEEKDAYS[d.getDay()]}）`;
      })()
    : "";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
        {/* ヘッダー */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">予約枠の設定</h3>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        {/* ボディ */}
        <div className="px-5 py-4 space-y-4">
          {/* 基本情報 */}
          <div className="bg-gray-50 rounded-xl p-3 space-y-1.5">
            <div className="flex items-center gap-2 text-sm text-gray-700">
              <CalendarDays className="w-4 h-4 text-gray-400 flex-shrink-0" />
              <span>{slotDate}</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-gray-700">
              <span className="w-4 h-4 flex-shrink-0" />
              <span>{slot.start_time.slice(0, 5)} 〜 {slot.end_time.slice(0, 5)}</span>
            </div>
            {cat && (
              <div className="flex items-center gap-2 text-sm text-gray-700">
                <span className="w-4 h-4 flex-shrink-0 flex items-center justify-center">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: cat.color }} />
                </span>
                <span>{cat.name}</span>
              </div>
            )}
            {staff && (
              <div className="flex items-center gap-2 text-sm text-gray-700">
                <span className="w-4 h-4 flex-shrink-0 flex items-center justify-center">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: staff.color }} />
                </span>
                <span>{staff.name}</span>
              </div>
            )}
          </div>

          {/* 定員 */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">
              定員（最大受付人数）
            </label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCapacity((c) => Math.max(1, c - 1))}
                className="w-11 h-11 rounded-xl bg-gray-100 hover:bg-gray-200 active:bg-gray-300 flex items-center justify-center text-gray-700 text-xl font-bold transition-colors select-none flex-shrink-0"
              >
                −
              </button>
              <input
                type="number"
                min={1}
                value={capacity}
                onChange={(e) => setCapacity(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-16 px-2 py-2 rounded-lg border border-gray-200 text-base outline-none focus:border-blue-500 bg-white text-center font-semibold"
              />
              <button
                type="button"
                onClick={() => setCapacity((c) => c + 1)}
                className="w-11 h-11 rounded-xl bg-gray-100 hover:bg-gray-200 active:bg-gray-300 flex items-center justify-center text-gray-700 text-xl font-bold transition-colors select-none flex-shrink-0"
              >
                ＋
              </button>
              <span className="text-sm text-gray-500">人</span>
            </div>
          </div>

          {localError && (
            <p className="text-xs text-red-600">{localError}</p>
          )}
        </div>

        {/* フッター */}
        <div className="px-5 py-4 border-t border-gray-100 space-y-2">
          <div className="flex gap-2">
            <button
              onClick={onClose}
              disabled={busy}
              className="flex-1 py-2 rounded-xl text-sm font-medium border border-gray-200 text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              キャンセル
            </button>
            <button
              onClick={handleSave}
              disabled={busy}
              className="flex-1 py-2 rounded-xl text-sm font-semibold bg-blue-500 text-white hover:bg-blue-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
            >
              {busy ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Check className="w-3.5 h-3.5" />
              )}
              定員を更新
            </button>
          </div>
          <button
            onClick={handleDelete}
            disabled={busy}
            className="w-full py-2 rounded-xl text-sm font-medium bg-red-50 text-red-600 hover:bg-red-100 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            <Trash2 className="w-3.5 h-3.5" />
            この枠を削除
          </button>
        </div>
      </div>
    </div>
  );
}

// =========================================================
// カテゴリパネル
// =========================================================
function CategoryPanel({
  categories,
  selectedCategoryId,
  onSelect,
  onChange,
  onError,
}: {
  categories: Category[];
  selectedCategoryId: string | null;
  onSelect: (id: string) => void;
  onChange: () => Promise<void>;
  onError: (msg: string) => void;
}) {
  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftColor, setDraftColor] = useState(COLOR_PRESETS[0]);
  const [busy, setBusy] = useState(false);

  const startCreate = () => {
    setIsCreating(true);
    setEditingId(null);
    setDraftName("");
    setDraftColor(COLOR_PRESETS[categories.length % COLOR_PRESETS.length]);
  };
  const startEdit = (c: Category) => {
    setEditingId(c.id);
    setIsCreating(false);
    setDraftName(c.name);
    setDraftColor(c.color);
  };
  const cancel = () => { setIsCreating(false); setEditingId(null); };

  const save = async () => {
    if (!draftName.trim()) { onError("カテゴリ名を入力してください"); return; }
    setBusy(true);
    try {
      if (editingId) await updateCategory(editingId, { name: draftName.trim(), color: draftColor });
      else await createCategory({ name: draftName.trim(), color: draftColor });
      await onChange();
      cancel();
    } catch (e) {
      onError(errorMessage(e, "カテゴリの保存に失敗しました"));
    } finally { setBusy(false); }
  };

  const remove = async (c: Category) => {
    if (!confirm(`カテゴリ「${c.name}」を削除しますか？`)) return;
    setBusy(true);
    try {
      await deleteCategory(c.id);
      await onChange();
    } catch (e) {
      onError(errorMessage(e, "カテゴリの削除に失敗しました"));
    } finally { setBusy(false); }
  };

  return (
    <section className="bg-white rounded-2xl border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-gray-800">カテゴリ</h2>
        <button
          onClick={startCreate}
          className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 px-2 py-1 rounded-lg hover:bg-blue-50"
        >
          <Plus className="w-4 h-4" />追加
        </button>
      </div>
      <p className="text-xs text-gray-400 mb-3">枠作成時のカテゴリを選択</p>
      <div className="flex flex-wrap gap-2">
        {categories.map((c) =>
          editingId === c.id ? (
            <ItemEditor
              key={c.id}
              name={draftName}
              color={draftColor}
              onName={setDraftName}
              onColor={setDraftColor}
              onSave={save}
              onCancel={cancel}
              busy={busy}
            />
          ) : (
            <div
              key={c.id}
              className={cn(
                "group flex items-center gap-2 pl-2.5 pr-1 py-1 rounded-full border transition-all cursor-pointer",
                selectedCategoryId === c.id
                  ? "border-gray-700 bg-gray-50"
                  : "border-gray-200 hover:border-gray-400"
              )}
            >
              <button
                onClick={() => onSelect(c.id)}
                className="flex items-center gap-1.5 text-sm text-gray-800"
              >
                <span className="w-3 h-3 rounded-full" style={{ backgroundColor: c.color }} />
                {c.name}
              </button>
              <button onClick={() => startEdit(c)} className="text-gray-300 hover:text-gray-600 p-1 rounded" title="編集">
                <Pencil className="w-3 h-3" />
              </button>
              <button onClick={() => remove(c)} className="text-gray-300 hover:text-red-500 p-1 rounded" title="削除">
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          )
        )}
        {isCreating && (
          <ItemEditor
            name={draftName}
            color={draftColor}
            onName={setDraftName}
            onColor={setDraftColor}
            onSave={save}
            onCancel={cancel}
            busy={busy}
          />
        )}
      </div>
    </section>
  );
}

// =========================================================
// スタッフパネル
// =========================================================
function StaffPanel({
  staffs,
  selectedStaffId,
  onSelect,
  onChange,
  onError,
}: {
  staffs: Staff[];
  selectedStaffId: string | null;
  onSelect: (id: string | null) => void;
  onChange: () => Promise<void>;
  onError: (msg: string) => void;
}) {
  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftColor, setDraftColor] = useState(COLOR_PRESETS[0]);
  const [busy, setBusy] = useState(false);

  const startCreate = () => {
    setIsCreating(true);
    setEditingId(null);
    setDraftName("");
    setDraftColor(COLOR_PRESETS[staffs.length % COLOR_PRESETS.length]);
  };
  const startEdit = (s: Staff) => {
    setEditingId(s.id);
    setIsCreating(false);
    setDraftName(s.name);
    setDraftColor(s.color);
  };
  const cancel = () => { setIsCreating(false); setEditingId(null); };

  const save = async () => {
    if (!draftName.trim()) { onError("スタッフ名を入力してください"); return; }
    setBusy(true);
    try {
      if (editingId) await updateStaff(editingId, { name: draftName.trim(), color: draftColor });
      else await createStaff({ name: draftName.trim(), color: draftColor });
      await onChange();
      cancel();
    } catch (e) {
      onError(errorMessage(e, "スタッフの保存に失敗しました"));
    } finally { setBusy(false); }
  };

  const remove = async (s: Staff) => {
    if (!confirm(`スタッフ「${s.name}」を削除しますか？`)) return;
    setBusy(true);
    try {
      await deleteStaff(s.id);
      await onChange();
    } catch (e) {
      onError(errorMessage(e, "スタッフの削除に失敗しました"));
    } finally { setBusy(false); }
  };

  return (
    <section className="bg-white rounded-2xl border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-gray-800 flex items-center gap-1.5">
          <Users className="w-4 h-4 text-gray-500" />
          スタッフ
        </h2>
        <button
          onClick={startCreate}
          className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 px-2 py-1 rounded-lg hover:bg-blue-50"
        >
          <Plus className="w-4 h-4" />追加
        </button>
      </div>
      <p className="text-xs text-gray-400 mb-3">枠作成時に割り当てるスタッフを選択</p>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => onSelect(null)}
          className={cn(
            "flex items-center gap-1.5 pl-2.5 pr-2.5 py-1 rounded-full border text-sm transition-all",
            selectedStaffId === null
              ? "border-gray-700 bg-gray-50 text-gray-800"
              : "border-gray-200 text-gray-500 hover:border-gray-400"
          )}
        >
          <UserMinus className="w-3.5 h-3.5" />
          指定なし
        </button>

        {staffs.map((s) =>
          editingId === s.id ? (
            <ItemEditor
              key={s.id}
              name={draftName}
              color={draftColor}
              onName={setDraftName}
              onColor={setDraftColor}
              onSave={save}
              onCancel={cancel}
              busy={busy}
            />
          ) : (
            <div
              key={s.id}
              className={cn(
                "group flex items-center gap-2 pl-2.5 pr-1 py-1 rounded-full border transition-all cursor-pointer",
                selectedStaffId === s.id
                  ? "border-gray-700 bg-gray-50"
                  : "border-gray-200 hover:border-gray-400"
              )}
            >
              <button
                onClick={() => onSelect(s.id)}
                className="flex items-center gap-1.5 text-sm text-gray-800"
              >
                <span className="w-3 h-3 rounded-full" style={{ backgroundColor: s.color }} />
                {s.name}
              </button>
              <button onClick={() => startEdit(s)} className="text-gray-300 hover:text-gray-600 p-1 rounded" title="編集">
                <Pencil className="w-3 h-3" />
              </button>
              <button onClick={() => remove(s)} className="text-gray-300 hover:text-red-500 p-1 rounded" title="削除">
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          )
        )}
        {isCreating && (
          <ItemEditor
            name={draftName}
            color={draftColor}
            onName={setDraftName}
            onColor={setDraftColor}
            onSave={save}
            onCancel={cancel}
            busy={busy}
          />
        )}
      </div>
    </section>
  );
}

// =========================================================
// カテゴリ/スタッフ共通エディタ
// =========================================================
function ItemEditor({
  name,
  color,
  onName,
  onColor,
  onSave,
  onCancel,
  busy,
}: {
  name: string;
  color: string;
  onName: (s: string) => void;
  onColor: (s: string) => void;
  onSave: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  return (
    <div className="flex items-center gap-2 p-2 rounded-xl border border-blue-300 bg-blue-50">
      <input
        type="text"
        value={name}
        onChange={(e) => onName(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
        placeholder="名前"
        autoFocus
        className="px-2 py-1 rounded-md border border-gray-200 text-sm outline-none focus:border-blue-500 bg-white w-28"
      />
      <div className="flex items-center gap-1">
        {COLOR_PRESETS.map((c) => (
          <button
            key={c}
            onClick={() => onColor(c)}
            className={cn(
              "w-5 h-5 rounded-full transition-transform",
              color === c ? "ring-2 ring-gray-700 ring-offset-1 scale-110" : "hover:scale-110"
            )}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>
      <button
        onClick={onSave}
        disabled={busy}
        className="p-1.5 rounded-md bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50"
      >
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
      </button>
      <button
        onClick={onCancel}
        disabled={busy}
        className="p-1.5 rounded-md bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// =========================================================
// タイムグリッド
// =========================================================
function TimeGrid({
  slots,
  categoryMap,
  staffMap,
  selectedCategoryId,
  selectedStaffId,
  onCreate,
  onSelect,
  onTap,
}: {
  slots: TimeSlot[];
  categoryMap: Map<string, Category>;
  staffMap: Map<string, Staff>;
  selectedCategoryId: string | null;
  selectedStaffId: string | null;
  onCreate: (startTime: string, endTime: string) => Promise<void>;
  onSelect: (slot: TimeSlot) => void;
  onTap?: (startTime: string) => void;
}) {
  const gridRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartMin, setDragStartMin] = useState<number | null>(null);
  const [dragEndMin, setDragEndMin] = useState<number | null>(null);
  const dragEndRef = useRef<number | null>(null);

  // タッチ操作でのタップ検出用
  const touchStartYRef = useRef<number | null>(null);
  const touchStartTimeRef = useRef<number | null>(null);
  const touchStartMinRef = useRef<number | null>(null);

  const slotLayout = useMemo(() => computeSlotLayout(slots), [slots]);

  const hours: number[] = [];
  for (let h = BUSINESS_HOURS_START; h < BUSINESS_HOURS_END; h++) hours.push(h);

  const previewColor = selectedCategoryId
    ? (categoryMap.get(selectedCategoryId)?.color ?? "#3b82f6")
    : "#3b82f6";

  const handleGridMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const rect = gridRef.current!.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const minutes = yToAbsMinutes(y);
    setIsDragging(true);
    setDragStartMin(minutes);
    setDragEndMin(minutes);
    dragEndRef.current = minutes;
  };

  const handleSlotClick = (slot: TimeSlot) => {
    onSelect(slot);
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!gridRef.current) return;
    const rect = gridRef.current.getBoundingClientRect();
    const touch = e.touches[0];
    const y = touch.clientY - rect.top;
    touchStartYRef.current = touch.clientY;
    touchStartTimeRef.current = Date.now();
    touchStartMinRef.current = yToAbsMinutes(y);
  };

  const handleTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    if (
      touchStartYRef.current === null ||
      touchStartTimeRef.current === null ||
      touchStartMinRef.current === null
    ) return;
    const touch = e.changedTouches[0];
    const dy = Math.abs(touch.clientY - touchStartYRef.current);
    const dt = Date.now() - touchStartTimeRef.current;
    // スクロールではなくタップと判定: 15px以内の移動 かつ 400ms以内
    if (dy < 15 && dt < 400) {
      const tappedMin = touchStartMinRef.current;
      const h = Math.floor(tappedMin / 60);
      const m = tappedMin % 60;
      const timeStr = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      onTap?.(timeStr);
    }
    touchStartYRef.current = null;
    touchStartTimeRef.current = null;
    touchStartMinRef.current = null;
  };

  useEffect(() => {
    if (!isDragging || dragStartMin === null) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!gridRef.current) return;
      const rect = gridRef.current.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const minutes = yToAbsMinutes(y);
      dragEndRef.current = minutes;
      setDragEndMin(minutes);
    };

    const handleMouseUp = async () => {
      setIsDragging(false);
      const from = dragStartMin;
      const to = dragEndRef.current ?? dragStartMin;
      const startMin = Math.min(from, to);
      const rawEnd = Math.max(from, to);
      const endMin = rawEnd <= startMin ? startMin + SNAP_MINUTES : rawEnd;
      setDragStartMin(null);
      setDragEndMin(null);
      dragEndRef.current = null;
      await onCreate(absMinutesToTime(startMin), absMinutesToTime(endMin));
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, dragStartMin, onCreate]);

  const dragFromY = dragStartMin !== null && dragEndMin !== null
    ? absMinutesToY(Math.min(dragStartMin, dragEndMin))
    : 0;
  const dragToY = dragStartMin !== null && dragEndMin !== null
    ? absMinutesToY(Math.max(dragStartMin, dragEndMin))
    : 0;
  const dragHeight = Math.max(dragToY - dragFromY, HOUR_HEIGHT / 6);

  return (
    <div className="select-none">
      <div className="overflow-y-auto" style={{ maxHeight: 560 }}>
      <div className="flex gap-0">
        <div className="w-12 flex-shrink-0 relative" style={{ height: TOTAL_HEIGHT + HOUR_HEIGHT / 2 }}>
          {hours.map((h) => (
            <div
              key={h}
              className="absolute text-xs text-gray-400 text-right pr-2 leading-none"
              style={{ top: (h - BUSINESS_HOURS_START) * HOUR_HEIGHT - 6 }}
            >
              {h}:00
            </div>
          ))}
          <div
            className="absolute text-xs text-gray-400 text-right pr-2 leading-none"
            style={{ top: TOTAL_HEIGHT - 6 }}
          >
            {BUSINESS_HOURS_END}:00
          </div>
        </div>

        <div
          ref={gridRef}
          className="flex-1 relative border-l border-gray-200 cursor-crosshair"
          style={{ height: TOTAL_HEIGHT }}
          onMouseDown={handleGridMouseDown}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          {hours.map((h) => (
            <div
              key={h}
              className="absolute left-0 right-0 border-t border-gray-200"
              style={{ top: (h - BUSINESS_HOURS_START) * HOUR_HEIGHT }}
            />
          ))}
          <div className="absolute left-0 right-0 border-t border-gray-200" style={{ top: TOTAL_HEIGHT }} />
          {hours.map((h) => (
            <div
              key={`${h}-30`}
              className="absolute left-0 right-0 border-t border-gray-100"
              style={{ top: (h - BUSINESS_HOURS_START) * HOUR_HEIGHT + HOUR_HEIGHT / 2 }}
            />
          ))}

          {isDragging && dragStartMin !== null && dragEndMin !== null && (
            <div
              className="absolute inset-x-1 rounded pointer-events-none opacity-70 border"
              style={{
                top: dragFromY,
                height: dragHeight,
                backgroundColor: previewColor + "55",
                borderColor: previewColor,
              }}
            >
              <div
                className="text-xs font-semibold px-1.5 pt-0.5 leading-tight"
                style={{ color: previewColor }}
              >
                {absMinutesToDisplay(Math.min(dragStartMin, dragEndMin))}
                〜
                {absMinutesToDisplay(Math.max(dragStartMin, dragEndMin))}
              </div>
            </div>
          )}

          {slots.map((slot) => {
            const layout = slotLayout.get(slot.id);
            if (!layout) return null;
            const cat = categoryMap.get(slot.category_id);
            const staff = slot.staff_id ? staffMap.get(slot.staff_id) : null;
            const startMin = timeToAbsMinutes(slot.start_time);
            const endMin = timeToAbsMinutes(slot.end_time);
            const top = absMinutesToY(startMin);
            const height = Math.max(absMinutesToY(endMin) - top, 10);
            const widthPct = 100 / layout.totalCols;
            const leftPct = layout.col * widthPct;
            const dur = endMin - startMin;

            return (
              <button
                key={slot.id}
                onMouseDown={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
                onClick={() => handleSlotClick(slot)}
                className="absolute rounded text-white shadow-sm hover:opacity-80 active:opacity-60 transition-opacity text-left overflow-hidden"
                style={{
                  top: top + 1,
                  height: height - 2,
                  left: `${leftPct + 0.4}%`,
                  width: `${widthPct - 0.8}%`,
                  backgroundColor: cat?.color ?? "#94a3b8",
                  zIndex: 1,
                }}
                title={`${slot.start_time.slice(0, 5)}〜${slot.end_time.slice(0, 5)} / ${cat?.name ?? ""} / ${staff?.name ?? "スタッフ未定"} / 定員${slot.capacity ?? 1}人（クリックで設定・削除）`}
              >
                <div className="px-1.5 py-0.5">
                  <div className="text-xs font-semibold leading-tight truncate">
                    {slot.start_time.slice(0, 5)}〜{slot.end_time.slice(0, 5)}
                  </div>
                  {dur >= 20 && (
                    <div className="text-xs opacity-90 leading-tight truncate">{cat?.name ?? ""}</div>
                  )}
                  {dur >= 30 && staff && (
                    <div className="text-xs opacity-80 leading-tight truncate">{staff.name}</div>
                  )}
                  {dur >= 30 && (slot.capacity ?? 1) > 1 && (
                    <div className="text-xs opacity-80 leading-tight truncate">×{slot.capacity}人</div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
      </div>

      {!selectedCategoryId && (
        <p className="mt-2 text-xs text-amber-600">カテゴリが選択されていません。上部から選択してください。</p>
      )}
    </div>
  );
}

// =========================================================
// 予約一覧ビュー（カレンダー形式）
// =========================================================
type BookingCalendarMode = "month" | "week" | "day" | "list";

interface SlotGroup {
  key: string;
  slotId: string | null;
  slotDate: string;
  startTime: string;
  endTime: string | null;
  categoryId: string | null;
  staffId: string | null;
  reservations: AdminReservation[];
}

function BookingsView({
  categoryMap,
  staffMap,
  onError,
}: {
  categoryMap: Map<string, Category>;
  staffMap: Map<string, Staff>;
  onError: (msg: string) => void;
}) {
  const today = useMemo(() => new Date(), []);
  const [mode, setMode] = useState<BookingCalendarMode>("month");
  const [currentDate, setCurrentDate] = useState<Date>(today);
  const [filterStaffId, setFilterStaffId] = useState<string | null>(null);
  const [reservations, setReservations] = useState<AdminReservation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [selectedReservation, setSelectedReservation] = useState<AdminReservation | null>(null);
  const [selectedSlotKey, setSelectedSlotKey] = useState<string | null>(null);

  const { rangeStart, rangeEnd } = useMemo(() => {
    if (mode === "day") {
      const d = formatDate(currentDate);
      return { rangeStart: d, rangeEnd: d };
    }
    if (mode === "week") {
      const dow = currentDate.getDay();
      const start = new Date(currentDate);
      start.setDate(currentDate.getDate() - dow);
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      return { rangeStart: formatDate(start), rangeEnd: formatDate(end) };
    }
    const y = currentDate.getFullYear();
    const m = currentDate.getMonth();
    return {
      rangeStart: `${y}-${String(m + 1).padStart(2, "0")}-01`,
      rangeEnd: `${y}-${String(m + 1).padStart(2, "0")}-${String(getDaysInMonth(y, m)).padStart(2, "0")}`,
    };
  }, [currentDate, mode]);

  const reloadReservations = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await fetchReservationsInRange(rangeStart, rangeEnd);
      setReservations(data);
    } catch (e) {
      onError(errorMessage(e, "予約の読み込みに失敗しました"));
    } finally {
      setIsLoading(false);
    }
  }, [rangeStart, rangeEnd, onError]);

  useEffect(() => {
    reloadReservations();
  }, [reloadReservations]);

  const navigate = (dir: -1 | 1) => {
    setCurrentDate((prev) => {
      const d = new Date(prev);
      if (mode === "month" || mode === "list") d.setMonth(d.getMonth() + dir);
      else if (mode === "week") d.setDate(d.getDate() + dir * 7);
      else d.setDate(d.getDate() + dir);
      return d;
    });
  };

  const handleStatusToggle = async (r: AdminReservation) => {
    const nextStatus = r.status === "confirmed" ? "cancelled" : "confirmed";
    setUpdatingId(r.id);
    try {
      await updateReservationStatus(r.id, nextStatus);
      setSelectedReservation((prev) => prev?.id === r.id ? { ...prev, status: nextStatus } : prev);
      await reloadReservations();
    } catch (e) {
      onError(errorMessage(e, "ステータスの更新に失敗しました"));
    } finally {
      setUpdatingId(null);
    }
  };

  const handleDeleteReservation = async (r: AdminReservation) => {
    setUpdatingId(r.id);
    try {
      await deleteReservation(r.id);
      setReservations((prev) => prev.filter((res) => res.id !== r.id));
    } catch (e) {
      onError(errorMessage(e, "予約の削除に失敗しました"));
    } finally {
      setUpdatingId(null);
    }
  };

  const filteredReservations = useMemo(
    () => filterStaffId ? reservations.filter((r) => r.staff_id === filterStaffId) : reservations,
    [reservations, filterStaffId]
  );

  const byDate = useMemo(() => {
    const map = new Map<string, AdminReservation[]>();
    for (const r of filteredReservations) {
      const date = r.slot_date ?? "";
      if (!date) continue;
      const list = map.get(date) ?? [];
      list.push(r);
      map.set(date, list);
    }
    return map;
  }, [filteredReservations]);

  // スロットグループ（同一枠の予約をまとめる）
  const slotGroupsByDate = useMemo(() => {
    const slotMap = new Map<string, SlotGroup>();
    for (const r of filteredReservations) {
      const slotKey = r.slot_id ?? `${r.slot_date}|${r.start_time}`;
      if (!slotMap.has(slotKey)) {
        slotMap.set(slotKey, {
          key: slotKey,
          slotId: r.slot_id ?? null,
          slotDate: r.slot_date ?? "",
          startTime: r.start_time ?? "",
          endTime: r.end_time ?? null,
          categoryId: r.category_id ?? null,
          staffId: r.staff_id ?? null,
          reservations: [],
        });
      }
      slotMap.get(slotKey)!.reservations.push(r);
    }
    const dateMap = new Map<string, SlotGroup[]>();
    for (const group of slotMap.values()) {
      const date = group.slotDate;
      if (!date) continue;
      const list = dateMap.get(date) ?? [];
      list.push(group);
      dateMap.set(date, list);
    }
    return dateMap;
  }, [filteredReservations]);

  const allSlotGroupsFlat = useMemo(() => {
    const map = new Map<string, SlotGroup>();
    for (const groups of slotGroupsByDate.values()) {
      for (const g of groups) map.set(g.key, g);
    }
    return map;
  }, [slotGroupsByDate]);

  const selectedSlotGroup = selectedSlotKey ? (allSlotGroupsFlat.get(selectedSlotKey) ?? null) : null;

  const getColor = useCallback((r: AdminReservation): string => {
    const staff = r.staff_id ? staffMap.get(r.staff_id) : null;
    if (staff) return staff.color;
    const cat = r.category_id ? categoryMap.get(r.category_id) : null;
    return cat?.color ?? "#94a3b8";
  }, [staffMap, categoryMap]);

  const periodTitle = useMemo(() => {
    const y = currentDate.getFullYear();
    const m = currentDate.getMonth() + 1;
    if (mode === "month" || mode === "list") return `${y}年${m}月`;
    if (mode === "day") return `${y}年${m}月${currentDate.getDate()}日（${WEEKDAYS[currentDate.getDay()]}）`;
    const dow = currentDate.getDay();
    const start = new Date(currentDate); start.setDate(currentDate.getDate() - dow);
    const end = new Date(start); end.setDate(start.getDate() + 6);
    return `${start.getMonth() + 1}/${start.getDate()} 〜 ${end.getMonth() + 1}/${end.getDate()}`;
  }, [currentDate, mode]);

  const staffList = useMemo(() => Array.from(staffMap.values()), [staffMap]);

  return (
    <div className="space-y-4">
      {/* ツールバー */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex bg-gray-100 rounded-xl p-1 gap-0.5">
            {(["month", "week", "day", "list"] as const).map((m) => (
              <button
                key={m}
                onClick={() => { setMode(m); setSelectedSlotKey(null); setSelectedReservation(null); }}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
                  mode === m ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-800"
                )}
              >
                {m === "month" ? "月" : m === "week" ? "週" : m === "day" ? "日" : "リスト"}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1">
            <button onClick={() => navigate(-1)} className="p-2 hover:bg-gray-100 rounded-full">
              <ChevronLeft className="w-4 h-4 text-gray-500" />
            </button>
            <button
              onClick={() => setCurrentDate(new Date())}
              className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600"
            >
              今日
            </button>
            <button onClick={() => navigate(1)} className="p-2 hover:bg-gray-100 rounded-full">
              <ChevronRight className="w-4 h-4 text-gray-500" />
            </button>
          </div>

          <h2 className="flex-1 text-center text-base font-semibold text-gray-800">{periodTitle}</h2>

          <div className="flex items-center gap-2">
            {isLoading
              ? <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
              : <span className="text-xs text-gray-400">{filteredReservations.length}件</span>
            }
            <select
              value={filterStaffId ?? ""}
              onChange={(e) => setFilterStaffId(e.target.value || null)}
              className="pl-3 pr-8 py-1.5 text-sm border border-gray-200 rounded-lg bg-white text-gray-700 outline-none focus:border-blue-400 cursor-pointer"
            >
              <option value="">全スタッフ</option>
              {staffList.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* スタッフ凡例 */}
      {staffList.length > 0 && (
        <div className="flex flex-wrap gap-2 px-1">
          {staffList.map((s) => (
            <button
              key={s.id}
              onClick={() => setFilterStaffId(filterStaffId === s.id ? null : s.id)}
              className={cn(
                "flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border transition-all",
                filterStaffId === s.id
                  ? "border-gray-700 bg-gray-50 text-gray-800"
                  : "border-gray-200 text-gray-500 hover:border-gray-400"
              )}
            >
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: s.color }} />
              {s.name}
            </button>
          ))}
        </div>
      )}

      {mode === "month" && (
        <BookingMonthView
          currentDate={currentDate}
          slotGroupsByDate={slotGroupsByDate}
          categoryMap={categoryMap}
          staffMap={staffMap}
          onSelectSlotGroup={(g) => setSelectedSlotKey(g.key)}
          onSelectDay={(d) => { setCurrentDate(d); setMode("day"); }}
        />
      )}
      {mode === "week" && (
        <BookingWeekView
          currentDate={currentDate}
          slotGroupsByDate={slotGroupsByDate}
          categoryMap={categoryMap}
          staffMap={staffMap}
          onSelectSlotGroup={(g) => setSelectedSlotKey(g.key)}
        />
      )}
      {mode === "day" && (
        <BookingDayView
          date={currentDate}
          slotGroups={slotGroupsByDate.get(formatDate(currentDate)) ?? []}
          categoryMap={categoryMap}
          staffMap={staffMap}
          onSelectSlotGroup={(g) => setSelectedSlotKey(g.key)}
        />
      )}
      {mode === "list" && (
        <BookingListView
          byDate={byDate}
          categoryMap={categoryMap}
          staffMap={staffMap}
          onSelectReservation={setSelectedReservation}
        />
      )}

      {selectedSlotGroup && (
        <SlotReservationsModal
          slotGroup={selectedSlotGroup}
          categoryMap={categoryMap}
          staffMap={staffMap}
          updatingId={updatingId}
          onDeleteReservation={handleDeleteReservation}
          onClose={() => setSelectedSlotKey(null)}
        />
      )}
      {selectedReservation && !selectedSlotGroup && (
        <ReservationDetailModal
          reservation={selectedReservation}
          categoryMap={categoryMap}
          staffMap={staffMap}
          updatingId={updatingId}
          onStatusToggle={handleStatusToggle}
          onClose={() => setSelectedReservation(null)}
        />
      )}
    </div>
  );
}

// =========================================================
// 月ビュー
// =========================================================
function BookingMonthView({
  currentDate,
  slotGroupsByDate,
  categoryMap,
  staffMap,
  onSelectSlotGroup,
  onSelectDay,
}: {
  currentDate: Date;
  slotGroupsByDate: Map<string, SlotGroup[]>;
  categoryMap: Map<string, Category>;
  staffMap: Map<string, Staff>;
  onSelectSlotGroup: (g: SlotGroup) => void;
  onSelectDay: (d: Date) => void;
}) {
  const today = useMemo(() => new Date(), []);
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);
  const MAX_PER_DAY = 3;

  const days: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) days.push(null);
  for (let d = 1; d <= daysInMonth; d++) days.push(d);
  while (days.length % 7 !== 0) days.push(null);

  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      <div className="grid grid-cols-7 border-b border-gray-100">
        {WEEKDAYS.map((d, i) => (
          <div
            key={d}
            className={cn(
              "text-center text-xs font-medium py-3",
              i === 0 && "text-red-400",
              i === 6 && "text-blue-400",
              i !== 0 && i !== 6 && "text-gray-400"
            )}
          >
            {d}
          </div>
        ))}
      </div>
      {Array.from({ length: days.length / 7 }, (_, wi) => (
        <div key={wi} className="grid grid-cols-7 border-b border-gray-100 last:border-0">
          {days.slice(wi * 7, wi * 7 + 7).map((day, di) => {
            if (!day) {
              return (
                <div key={di} className="min-h-28 border-r border-gray-100 last:border-0 bg-gray-50/50" />
              );
            }
            const dateStr = formatDate(new Date(year, month, day));
            const slotGroups = (slotGroupsByDate.get(dateStr) ?? []).sort((a, b) =>
              a.startTime.localeCompare(b.startTime)
            );
            const isToday =
              today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;
            const overflow = slotGroups.length - MAX_PER_DAY;

            return (
              <div
                key={di}
                className={cn(
                  "min-h-28 p-1.5 border-r border-gray-100 last:border-0",
                  di === 0 && "bg-red-50/10",
                  di === 6 && "bg-blue-50/10"
                )}
              >
                <button
                  onClick={() => onSelectDay(new Date(year, month, day))}
                  className={cn(
                    "w-7 h-7 flex items-center justify-center rounded-full text-xs font-semibold mb-1 transition-colors",
                    isToday
                      ? "bg-blue-500 text-white"
                      : di === 0 ? "text-red-500 hover:bg-red-50"
                      : di === 6 ? "text-blue-500 hover:bg-blue-50"
                      : "text-gray-700 hover:bg-gray-100"
                  )}
                >
                  {day}
                </button>
                <div className="space-y-0.5">
                  {slotGroups.slice(0, MAX_PER_DAY).map((sg) => {
                    const cat = sg.categoryId ? categoryMap.get(sg.categoryId) : null;
                    const staff = sg.staffId ? staffMap.get(sg.staffId) : null;
                    const color = staff?.color ?? cat?.color ?? "#94a3b8";
                    const activeCount = sg.reservations.filter((r) => r.status !== "cancelled").length;
                    return (
                      <button
                        key={sg.key}
                        onClick={() => onSelectSlotGroup(sg)}
                        className="w-full text-left text-xs px-1.5 py-0.5 rounded text-white leading-tight truncate hover:opacity-80 transition-opacity"
                        style={{ backgroundColor: color }}
                        title={`${sg.startTime?.slice(0, 5) ?? ""} ${sg.reservations.length}件予約`}
                      >
                        {sg.startTime ? `${sg.startTime.slice(0, 5)} ` : ""}
                        <span className="font-semibold">{activeCount}件</span>
                      </button>
                    );
                  })}
                  {overflow > 0 && (
                    <div className="text-xs text-gray-400 pl-1">+{overflow}枠</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// =========================================================
// 週ビュー
// =========================================================
function BookingWeekView({
  currentDate,
  slotGroupsByDate,
  categoryMap,
  staffMap,
  onSelectSlotGroup,
}: {
  currentDate: Date;
  slotGroupsByDate: Map<string, SlotGroup[]>;
  categoryMap: Map<string, Category>;
  staffMap: Map<string, Staff>;
  onSelectSlotGroup: (g: SlotGroup) => void;
}) {
  const today = useMemo(() => new Date(), []);
  const todayStr = formatDate(today);
  const dow = currentDate.getDay();
  const weekDays: Date[] = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(currentDate);
    d.setDate(currentDate.getDate() - dow + i);
    return d;
  });
  const hours: number[] = [];
  for (let h = BUSINESS_HOURS_START; h < BUSINESS_HOURS_END; h++) hours.push(h);
  const totalH = TOTAL_HOURS * HOUR_HEIGHT;

  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      <div className="flex border-b border-gray-100">
        <div className="w-12 flex-shrink-0 border-r border-gray-100" />
        {weekDays.map((d, i) => {
          const isToday = formatDate(d) === todayStr;
          return (
            <div
              key={i}
              className={cn(
                "flex-1 text-center py-3 border-r border-gray-100 last:border-0",
                i === 0 && "text-red-500",
                i === 6 && "text-blue-500"
              )}
            >
              <div className="text-xs text-gray-400">{WEEKDAYS[d.getDay()]}</div>
              <div
                className={cn(
                  "text-sm font-semibold mx-auto w-7 h-7 flex items-center justify-center rounded-full",
                  isToday && "bg-blue-500 text-white"
                )}
              >
                {d.getDate()}
              </div>
            </div>
          );
        })}
      </div>
      <div className="overflow-y-auto" style={{ maxHeight: 560 }}>
        <div className="flex">
          <div className="w-12 flex-shrink-0 border-r border-gray-100 relative" style={{ height: totalH }}>
            {hours.map((h) => (
              <div
                key={h}
                className="absolute right-2 text-xs text-gray-400 leading-none select-none"
                style={{ top: (h - BUSINESS_HOURS_START) * HOUR_HEIGHT - 6 }}
              >
                {h}:00
              </div>
            ))}
          </div>
          {weekDays.map((d, di) => {
            const dateStr = formatDate(d);
            const isToday = dateStr === todayStr;
            const daySlotGroups = slotGroupsByDate.get(dateStr) ?? [];
            return (
              <div
                key={di}
                className={cn(
                  "flex-1 relative border-r border-gray-100 last:border-0",
                  isToday && "bg-blue-50/20"
                )}
                style={{ height: totalH }}
              >
                {hours.map((h) => (
                  <div
                    key={h}
                    className="absolute left-0 right-0 border-t border-gray-100"
                    style={{ top: (h - BUSINESS_HOURS_START) * HOUR_HEIGHT }}
                  />
                ))}
                {hours.map((h) => (
                  <div
                    key={`${h}h`}
                    className="absolute left-0 right-0 border-t border-gray-50"
                    style={{ top: (h - BUSINESS_HOURS_START) * HOUR_HEIGHT + HOUR_HEIGHT / 2 }}
                  />
                ))}
                {daySlotGroups.map((sg) => {
                  if (!sg.startTime) return null;
                  const startMin = timeToAbsMinutes(sg.startTime);
                  const endMin = sg.endTime ? timeToAbsMinutes(sg.endTime) : startMin + 30;
                  const top = absMinutesToY(startMin);
                  const height = Math.max(absMinutesToY(endMin) - top, 18);
                  const cat = sg.categoryId ? categoryMap.get(sg.categoryId) : null;
                  const staff = sg.staffId ? staffMap.get(sg.staffId) : null;
                  const color = staff?.color ?? cat?.color ?? "#94a3b8";
                  const activeCount = sg.reservations.filter((r) => r.status !== "cancelled").length;
                  return (
                    <button
                      key={sg.key}
                      onClick={() => onSelectSlotGroup(sg)}
                      className="absolute inset-x-0.5 rounded text-white text-left overflow-hidden hover:opacity-80 transition-opacity shadow-sm"
                      style={{ top: top + 1, height: height - 2, backgroundColor: color, zIndex: 1 }}
                      title={`${sg.startTime.slice(0, 5)} / ${activeCount}件予約`}
                    >
                      <div className="px-1 py-0.5">
                        <div className="text-xs font-semibold leading-tight truncate">
                          {sg.startTime.slice(0, 5)}
                        </div>
                        {height > 32 && (
                          <div className="text-xs opacity-90 leading-tight truncate font-medium">
                            {activeCount}件
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// =========================================================
// 日ビュー
// =========================================================
function BookingDayView({
  date,
  slotGroups,
  categoryMap,
  staffMap,
  onSelectSlotGroup,
}: {
  date: Date;
  slotGroups: SlotGroup[];
  categoryMap: Map<string, Category>;
  staffMap: Map<string, Staff>;
  onSelectSlotGroup: (g: SlotGroup) => void;
}) {
  const isToday = formatDate(date) === formatDate(new Date());
  const hours: number[] = [];
  for (let h = BUSINESS_HOURS_START; h < BUSINESS_HOURS_END; h++) hours.push(h);
  const totalReservations = slotGroups.reduce((sum, sg) => sum + sg.reservations.filter((r) => r.status !== "cancelled").length, 0);

  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-3">
        <h3 className={cn("text-sm font-semibold", isToday && "text-blue-600")}>
          {date.getFullYear()}年{date.getMonth() + 1}月{date.getDate()}日（{WEEKDAYS[date.getDay()]}）
        </h3>
        {isToday && (
          <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">今日</span>
        )}
        <span className="text-xs text-gray-400 ml-auto">{totalReservations}件予約</span>
      </div>
      <div className="p-4 overflow-y-auto" style={{ maxHeight: 560 }}>
        <div className="flex gap-0">
          <div className="w-12 flex-shrink-0 relative" style={{ height: TOTAL_HEIGHT + HOUR_HEIGHT / 2 }}>
            {hours.map((h) => (
              <div
                key={h}
                className="absolute right-2 text-xs text-gray-400 leading-none select-none"
                style={{ top: (h - BUSINESS_HOURS_START) * HOUR_HEIGHT - 6 }}
              >
                {h}:00
              </div>
            ))}
            <div
              className="absolute right-2 text-xs text-gray-400 leading-none select-none"
              style={{ top: TOTAL_HEIGHT - 6 }}
            >
              {BUSINESS_HOURS_END}:00
            </div>
          </div>
          <div className="flex-1 relative border-l border-gray-200" style={{ height: TOTAL_HEIGHT }}>
            {hours.map((h) => (
              <div
                key={h}
                className="absolute left-0 right-0 border-t border-gray-200"
                style={{ top: (h - BUSINESS_HOURS_START) * HOUR_HEIGHT }}
              />
            ))}
            {hours.map((h) => (
              <div
                key={`${h}h`}
                className="absolute left-0 right-0 border-t border-gray-100"
                style={{ top: (h - BUSINESS_HOURS_START) * HOUR_HEIGHT + HOUR_HEIGHT / 2 }}
              />
            ))}
            <div
              className="absolute left-0 right-0 border-t border-gray-200"
              style={{ top: TOTAL_HEIGHT }}
            />
            {slotGroups.map((sg) => {
              if (!sg.startTime) return null;
              const startMin = timeToAbsMinutes(sg.startTime);
              const endMin = sg.endTime ? timeToAbsMinutes(sg.endTime) : startMin + 30;
              const top = absMinutesToY(startMin);
              const height = Math.max(absMinutesToY(endMin) - top, 20);
              const dur = endMin - startMin;
              const cat = sg.categoryId ? categoryMap.get(sg.categoryId) : null;
              const staff = sg.staffId ? staffMap.get(sg.staffId) : null;
              const color = staff?.color ?? cat?.color ?? "#94a3b8";
              const activeCount = sg.reservations.filter((r) => r.status !== "cancelled").length;
              const totalCount = sg.reservations.length;
              return (
                <button
                  key={sg.key}
                  onClick={() => onSelectSlotGroup(sg)}
                  className="absolute inset-x-1 rounded-lg text-white text-left overflow-hidden hover:opacity-80 transition-opacity shadow-sm"
                  style={{ top: top + 1, height: height - 2, backgroundColor: color, zIndex: 1 }}
                  title={`${sg.startTime.slice(0, 5)}〜${sg.endTime?.slice(0, 5) ?? ""} / ${activeCount}件予約（クリックで一覧表示）`}
                >
                  <div className="px-2.5 py-1.5">
                    <div className="text-xs font-semibold leading-tight">
                      {sg.startTime.slice(0, 5)}{sg.endTime ? `〜${sg.endTime.slice(0, 5)}` : ""}
                      <span className="ml-1.5 font-bold">{activeCount}/{totalCount}件</span>
                    </div>
                    {dur >= 20 && cat && (
                      <div className="text-xs opacity-90 leading-tight truncate">{cat.name}</div>
                    )}
                    {dur >= 30 && staff && (
                      <div className="text-xs opacity-80 leading-tight truncate">{staff.name}</div>
                    )}
                    {dur >= 40 && sg.reservations.slice(0, 3).map((r) => (
                      <div
                        key={r.id}
                        className={cn("text-xs leading-tight truncate opacity-90", r.status === "cancelled" && "line-through opacity-40")}
                      >
                        {r.name}
                      </div>
                    ))}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// =========================================================
// リストビュー
// =========================================================
function BookingListView({
  byDate,
  categoryMap,
  staffMap,
  onSelectReservation,
}: {
  byDate: Map<string, AdminReservation[]>;
  categoryMap: Map<string, Category>;
  staffMap: Map<string, Staff>;
  onSelectReservation: (r: AdminReservation) => void;
}) {
  const sortedDates = Array.from(byDate.keys()).sort();

  if (sortedDates.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center">
        <CalendarDays className="w-10 h-10 text-gray-200 mx-auto mb-3" />
        <p className="text-sm text-gray-400">この期間の予約はありません</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {sortedDates.map((date) => {
        const dateObj = new Date(date + "T00:00:00");
        const dayStr = `${dateObj.getMonth() + 1}/${dateObj.getDate()}（${WEEKDAYS[dateObj.getDay()]}）`;
        const items = (byDate.get(date) ?? []).sort((a, b) =>
          (a.start_time ?? "").localeCompare(b.start_time ?? "")
        );
        return (
          <section key={date} className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-700">{dayStr}</h3>
              <span className="text-xs text-gray-400">{items.length}件</span>
            </div>
            <div className="divide-y divide-gray-50">
              {items.map((r) => {
                const cat = r.category_id ? categoryMap.get(r.category_id) : null;
                const staff = r.staff_id ? staffMap.get(r.staff_id) : null;
                const timeStr = r.start_time
                  ? `${r.start_time.slice(0, 5)}${r.end_time ? `〜${r.end_time.slice(0, 5)}` : ""}`
                  : "時刻未定";
                const isCancelled = r.status === "cancelled";
                return (
                  <button
                    key={r.id}
                    onClick={() => onSelectReservation(r)}
                    className={cn(
                      "w-full px-5 py-4 flex gap-4 hover:bg-gray-50 transition-colors text-left",
                      isCancelled && "opacity-50"
                    )}
                  >
                    <div className="flex-shrink-0 w-32">
                      <div className="text-sm font-semibold text-gray-800">{timeStr}</div>
                      {cat && (
                        <div className="flex items-center gap-1 mt-1">
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: cat.color }} />
                          <span className="text-xs text-gray-500">{cat.name}</span>
                        </div>
                      )}
                      {staff && (
                        <div className="flex items-center gap-1 mt-0.5">
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: staff.color }} />
                          <span className="text-xs text-gray-500">{staff.name}</span>
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-800">{r.name}</div>
                      <div className="text-xs text-gray-500 truncate">{r.customer_email}</div>
                      {r.phone && <div className="text-xs text-gray-500">{r.phone}</div>}
                    </div>
                    <div className="flex-shrink-0">
                      <span
                        className={cn(
                          "text-xs px-2 py-0.5 rounded-full font-medium",
                          isCancelled ? "bg-red-50 text-red-600" : "bg-green-50 text-green-700"
                        )}
                      >
                        {isCancelled ? "キャンセル" : "確定"}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

// =========================================================
// 枠内予約者一覧モーダル
// =========================================================
function SlotReservationsModal({
  slotGroup,
  categoryMap,
  staffMap,
  updatingId,
  onDeleteReservation,
  onClose,
}: {
  slotGroup: SlotGroup;
  categoryMap: Map<string, Category>;
  staffMap: Map<string, Staff>;
  updatingId: string | null;
  onDeleteReservation: (r: AdminReservation) => Promise<void>;
  onClose: () => void;
}) {
  const [pendingDelete, setPendingDelete] = useState<AdminReservation | null>(null);

  const cat = slotGroup.categoryId ? categoryMap.get(slotGroup.categoryId) : null;
  const staff = slotGroup.staffId ? staffMap.get(slotGroup.staffId) : null;
  const headerColor = staff?.color ?? cat?.color ?? "#6366f1";

  const confirmedCount = slotGroup.reservations.filter((r) => r.status !== "cancelled").length;
  const totalCount = slotGroup.reservations.length;

  const slotDateStr = slotGroup.slotDate
    ? (() => {
        const d = new Date(slotGroup.slotDate + "T00:00:00");
        return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${WEEKDAYS[d.getDay()]}）`;
      })()
    : "";

  const timeStr = slotGroup.startTime
    ? `${slotGroup.startTime.slice(0, 5)}${slotGroup.endTime ? `〜${slotGroup.endTime.slice(0, 5)}` : ""}`
    : "時刻未定";

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (pendingDelete) setPendingDelete(null);
        else onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, pendingDelete]);

  const sorted = [...slotGroup.reservations].sort((a, b) => {
    const statusOrder = (r: AdminReservation) => r.status === "cancelled" ? 1 : 0;
    return statusOrder(a) - statusOrder(b) || (a.created_at ?? "").localeCompare(b.created_at ?? "");
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden max-h-[90vh] flex flex-col">

        {/* 削除確認オーバーレイ */}
        {pendingDelete && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/30 backdrop-blur-[2px] rounded-2xl">
            <div className="bg-white rounded-2xl shadow-2xl mx-5 p-6 w-full max-w-xs">
              <div className="flex items-center gap-2.5 mb-3">
                <div className="w-9 h-9 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                  <AlertCircle className="w-5 h-5 text-red-500" />
                </div>
                <h4 className="text-sm font-bold text-gray-900">予約を削除しますか？</h4>
              </div>
              <p className="text-sm text-gray-700 mb-1 pl-0.5">
                <span className="font-semibold">{pendingDelete.name}</span> さんの予約を完全に削除します。
              </p>
              <p className="text-xs text-red-500 font-medium mb-5 pl-0.5">
                この操作は取り消せません。
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setPendingDelete(null)}
                  className="flex-1 py-2.5 rounded-xl text-sm font-medium border border-gray-200 text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  キャンセル
                </button>
                <button
                  onClick={async () => {
                    const r = pendingDelete;
                    setPendingDelete(null);
                    await onDeleteReservation(r);
                  }}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-red-500 text-white hover:bg-red-600 transition-colors flex items-center justify-center gap-1.5"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  削除する
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ヘッダー */}
        <div className="px-6 py-4 text-white flex-shrink-0" style={{ backgroundColor: headerColor }}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="text-lg font-bold">予約者一覧</h3>
              </div>
              <div className="text-sm opacity-90">{slotDateStr}　{timeStr}</div>
              <div className="flex flex-wrap items-center gap-1.5 mt-2">
                {cat && (
                  <span className="text-xs bg-white/20 px-2 py-0.5 rounded-full">{cat.name}</span>
                )}
                {staff && (
                  <span className="text-xs bg-white/20 px-2 py-0.5 rounded-full">{staff.name}</span>
                )}
                <span className="text-xs bg-white/20 px-2 py-0.5 rounded-full font-semibold">
                  確定 {confirmedCount}件 / 全 {totalCount}件
                </span>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 hover:bg-white/20 rounded-lg transition-colors flex-shrink-0"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* ボディ（スクロール） */}
        <div className="overflow-y-auto flex-1">
          {sorted.length === 0 ? (
            <div className="p-10 text-center text-sm text-gray-400">予約データがありません</div>
          ) : (
            <div className="divide-y divide-gray-100">
              {sorted.map((r, i) => {
                const isCancelled = r.status === "cancelled";
                const customEntries = r.custom_answers
                  ? Object.entries(r.custom_answers).filter(([, v]) => v !== null && v !== undefined && v !== "")
                  : [];
                return (
                  <div
                    key={r.id}
                    className={cn(
                      "px-5 py-4 transition-colors",
                      isCancelled ? "bg-gray-50 opacity-60" : "hover:bg-gray-50/50"
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1.5">
                          <span className="text-xs text-gray-400 font-medium w-5 text-right flex-shrink-0">
                            {i + 1}.
                          </span>
                          <span className={cn(
                            "text-base font-semibold text-gray-800",
                            isCancelled && "line-through"
                          )}>
                            {r.name}
                          </span>
                          <span className={cn(
                            "text-xs px-2 py-0.5 rounded-full font-medium",
                            isCancelled ? "bg-red-50 text-red-600" : "bg-green-50 text-green-700"
                          )}>
                            {isCancelled ? "キャンセル済" : "確定"}
                          </span>
                        </div>
                        <div className="pl-7 space-y-0.5">
                          <div className="text-sm text-gray-600 break-all">{r.customer_email}</div>
                          {r.phone && (
                            <div className="text-sm text-gray-600">{r.phone}</div>
                          )}
                          {r.notes && (
                            <div className="text-xs text-gray-500 mt-1">
                              <span className="text-gray-400">備考: </span>{r.notes}
                            </div>
                          )}
                          {customEntries.length > 0 && (
                            <div className="mt-1.5 space-y-0.5">
                              {customEntries.map(([key, val]) => (
                                <div key={key} className="text-xs text-gray-500">
                                  <span className="text-gray-400">{key}: </span>
                                  <span>{String(val)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => setPendingDelete(r)}
                        disabled={updatingId === r.id}
                        className="flex-shrink-0 flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-50 whitespace-nowrap bg-red-50 text-red-600 hover:bg-red-100"
                      >
                        {updatingId === r.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <><Trash2 className="w-3.5 h-3.5" />削除</>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* フッター */}
        <div className="px-5 py-3 border-t border-gray-100 bg-gray-50 flex-shrink-0">
          <button
            onClick={onClose}
            className="w-full py-2 rounded-xl text-sm font-medium border border-gray-200 text-gray-700 hover:bg-gray-100 transition-colors"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}

// =========================================================
// 予約詳細モーダル
// =========================================================
function ReservationDetailModal({
  reservation: r,
  categoryMap,
  staffMap,
  updatingId,
  onStatusToggle,
  onClose,
}: {
  reservation: AdminReservation;
  categoryMap: Map<string, Category>;
  staffMap: Map<string, Staff>;
  updatingId: string | null;
  onStatusToggle: (r: AdminReservation) => void;
  onClose: () => void;
}) {
  const cat = r.category_id ? categoryMap.get(r.category_id) : null;
  const staff = r.staff_id ? staffMap.get(r.staff_id) : null;
  const isCancelled = r.status === "cancelled";
  const timeStr = r.start_time
    ? `${r.start_time.slice(0, 5)}${r.end_time ? `〜${r.end_time.slice(0, 5)}` : ""}`
    : "時刻未定";
  const headerColor = staff?.color ?? cat?.color ?? "#6366f1";
  const customEntries = r.custom_answers
    ? Object.entries(r.custom_answers).filter(([, v]) => v !== null && v !== undefined && v !== "")
    : [];

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden max-h-[90vh] flex flex-col">
        {/* ヘッダー */}
        <div className="px-6 py-5 text-white flex-shrink-0" style={{ backgroundColor: headerColor }}>
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <div className="text-xl font-bold truncate">{r.name}</div>
              <div className="text-sm opacity-90 mt-0.5">
                {r.slot_date && (() => {
                  const d = new Date(r.slot_date + "T00:00:00");
                  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${WEEKDAYS[d.getDay()]}）　`;
                })()}
                {timeStr}
              </div>
            </div>
            <button
              onClick={onClose}
              className="ml-3 p-1.5 hover:bg-white/20 rounded-lg transition-colors flex-shrink-0"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* ボディ */}
        <div className="px-6 py-5 space-y-4 overflow-y-auto flex-1">
          {/* メニュー・スタッフ・ステータス */}
          <div className="flex flex-wrap items-center gap-2">
            {cat && (
              <div className="flex items-center gap-1.5 bg-gray-50 px-3 py-1.5 rounded-full border border-gray-200">
                <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: cat.color }} />
                <span className="text-sm font-medium text-gray-700">{cat.name}</span>
              </div>
            )}
            {staff && (
              <div className="flex items-center gap-1.5 bg-gray-50 px-3 py-1.5 rounded-full border border-gray-200">
                <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: staff.color }} />
                <span className="text-sm font-medium text-gray-700">{staff.name}</span>
              </div>
            )}
            <span
              className={cn(
                "ml-auto text-xs px-2.5 py-1 rounded-full font-medium",
                isCancelled ? "bg-red-50 text-red-600" : "bg-green-50 text-green-700"
              )}
            >
              {isCancelled ? "キャンセル" : "確定"}
            </span>
          </div>

          <div className="border-t border-gray-100" />

          {/* 顧客情報 */}
          <div className="space-y-3">
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider">お客様情報</div>
            <div className="space-y-2.5">
              <div>
                <div className="text-xs text-gray-400 mb-0.5">お名前</div>
                <div className="text-sm font-medium text-gray-800">{r.name}</div>
              </div>
              {r.phone && (
                <div>
                  <div className="text-xs text-gray-400 mb-0.5">電話番号</div>
                  <div className="text-sm text-gray-800">{r.phone}</div>
                </div>
              )}
              <div>
                <div className="text-xs text-gray-400 mb-0.5">メールアドレス</div>
                <div className="text-sm text-gray-800 break-all">{r.customer_email}</div>
              </div>
              {r.notes && (
                <div>
                  <div className="text-xs text-gray-400 mb-0.5">備考</div>
                  <div className="text-sm text-gray-700">{r.notes}</div>
                </div>
              )}
            </div>
          </div>

          {/* 問診票 */}
          {customEntries.length > 0 && (
            <>
              <div className="border-t border-gray-100" />
              <div className="space-y-3">
                <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider">問診票</div>
                <div className="space-y-2.5">
                  {customEntries.map(([key, value]) => (
                    <div key={key}>
                      <div className="text-xs text-gray-400 mb-0.5">{key}</div>
                      <div className="text-sm text-gray-800">{String(value)}</div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {/* フッター：ステータス変更 */}
        <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 flex-shrink-0">
          <button
            onClick={() => onStatusToggle(r)}
            disabled={updatingId === r.id}
            className={cn(
              "w-full py-3 rounded-xl text-sm font-semibold transition-colors flex items-center justify-center gap-2 disabled:opacity-50",
              isCancelled
                ? "bg-green-500 text-white hover:bg-green-600"
                : "bg-red-50 text-red-600 hover:bg-red-100"
            )}
          >
            {updatingId === r.id ? (
              <><Loader2 className="w-4 h-4 animate-spin" />処理中...</>
            ) : isCancelled ? "確定に戻す" : "キャンセルにする"}
          </button>
        </div>
      </div>
    </div>
  );
}

// =========================================================
// 問診票フィールドエディタ（インライン）
// =========================================================
function FieldEditor({
  draftName,
  draftType,
  draftRequired,
  draftOptionsText,
  onName,
  onType,
  onRequired,
  onOptionsText,
  onSave,
  onCancel,
  busy,
}: {
  draftName: string;
  draftType: FormField['field_type'];
  draftRequired: boolean;
  draftOptionsText: string;
  onName: (s: string) => void;
  onType: (t: FormField['field_type']) => void;
  onRequired: (b: boolean) => void;
  onOptionsText: (s: string) => void;
  onSave: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  return (
    <div className="p-4 rounded-xl border border-blue-300 bg-blue-50 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">項目名</label>
          <input
            type="text"
            value={draftName}
            onChange={(e) => onName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
            placeholder="例: お悩み、痛い部位"
            autoFocus
            className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:border-blue-500 bg-white"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">入力タイプ</label>
          <select
            value={draftType}
            onChange={(e) => onType(e.target.value as FormField['field_type'])}
            className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:border-blue-500 bg-white"
          >
            <option value="text">テキスト（1行）</option>
            <option value="number">数値</option>
            <option value="select">選択肢</option>
            <option value="textarea">テキスト（複数行）</option>
          </select>
        </div>
      </div>

      {draftType === "select" && (
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            選択肢（1行に1つ入力）
          </label>
          <textarea
            value={draftOptionsText}
            onChange={(e) => onOptionsText(e.target.value)}
            placeholder={"男性\n女性\nその他"}
            rows={4}
            className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:border-blue-500 bg-white resize-none"
          />
        </div>
      )}

      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={draftRequired}
            onChange={(e) => onRequired(e.target.checked)}
            className="w-4 h-4 rounded border-gray-300 accent-blue-500"
          />
          必須項目にする
        </label>
        <div className="flex gap-2">
          <button
            onClick={onSave}
            disabled={busy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-500 text-white text-sm hover:bg-blue-600 disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            保存
          </button>
          <button
            onClick={onCancel}
            disabled={busy}
            className="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 text-sm hover:bg-gray-50"
          >
            キャンセル
          </button>
        </div>
      </div>
    </div>
  );
}

// =========================================================
// 問診票フィールド管理パネル
// =========================================================
function FormFieldPanel({
  formFields,
  onChange,
  onError,
}: {
  formFields: FormField[];
  onChange: () => Promise<void>;
  onError: (msg: string) => void;
}) {
  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftType, setDraftType] = useState<FormField["field_type"]>("text");
  const [draftRequired, setDraftRequired] = useState(false);
  const [draftOptionsText, setDraftOptionsText] = useState("");
  const [busy, setBusy] = useState(false);

  const fieldTypeLabel = (type: FormField["field_type"]) => {
    switch (type) {
      case "text": return "テキスト（1行）";
      case "number": return "数値";
      case "select": return "選択肢";
      case "textarea": return "テキスト（複数行）";
    }
  };

  const startCreate = () => {
    setIsCreating(true);
    setEditingId(null);
    setDraftName("");
    setDraftType("text");
    setDraftRequired(false);
    setDraftOptionsText("");
  };

  const startEdit = (f: FormField) => {
    setEditingId(f.id);
    setIsCreating(false);
    setDraftName(f.field_name);
    setDraftType(f.field_type);
    setDraftRequired(f.is_required);
    setDraftOptionsText((f.options ?? []).join("\n"));
  };

  const cancel = () => { setIsCreating(false); setEditingId(null); };

  const save = async () => {
    if (!draftName.trim()) { onError("項目名を入力してください"); return; }
    const options =
      draftType === "select"
        ? draftOptionsText.split("\n").map((s) => s.trim()).filter(Boolean)
        : null;
    if (draftType === "select" && (!options || options.length === 0)) {
      onError("選択肢を少なくとも1つ入力してください");
      return;
    }
    setBusy(true);
    try {
      if (editingId) {
        await updateFormField(editingId, {
          field_name: draftName.trim(),
          field_type: draftType,
          is_required: draftRequired,
          options,
        });
      } else {
        await createFormField({
          field_name: draftName.trim(),
          field_type: draftType,
          is_required: draftRequired,
          options,
          display_order: formFields.length + 1,
        });
      }
      await onChange();
      cancel();
    } catch (e) {
      onError(errorMessage(e, "項目の保存に失敗しました"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (f: FormField) => {
    if (!confirm(`項目「${f.field_name}」を削除しますか？`)) return;
    setBusy(true);
    try {
      await deleteFormField(f.id);
      await onChange();
    } catch (e) {
      onError(errorMessage(e, "項目の削除に失敗しました"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-4">
      <div className="bg-white rounded-2xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-1">
          <div>
            <h2 className="text-sm font-semibold text-gray-800">予約時入力項目の管理</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              お客様の予約フォームに表示する問診項目を自由に追加・編集できます
            </p>
          </div>
          <button
            onClick={startCreate}
            className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 px-3 py-1.5 rounded-lg hover:bg-blue-50 transition-colors"
          >
            <Plus className="w-4 h-4" />
            項目を追加
          </button>
        </div>
      </div>

      <div className="space-y-2">
        {formFields.map((f) =>
          editingId === f.id ? (
            <FieldEditor
              key={f.id}
              draftName={draftName}
              draftType={draftType}
              draftRequired={draftRequired}
              draftOptionsText={draftOptionsText}
              onName={setDraftName}
              onType={setDraftType}
              onRequired={setDraftRequired}
              onOptionsText={setDraftOptionsText}
              onSave={save}
              onCancel={cancel}
              busy={busy}
            />
          ) : (
            <div
              key={f.id}
              className="bg-white rounded-xl border border-gray-200 px-4 py-3 flex items-center gap-4"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-gray-800">{f.field_name}</span>
                  {f.is_required && (
                    <span className="text-xs text-red-500 font-medium bg-red-50 px-1.5 py-0.5 rounded">
                      必須
                    </span>
                  )}
                  <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                    {fieldTypeLabel(f.field_type)}
                  </span>
                </div>
                {f.options && f.options.length > 0 && (
                  <p className="text-xs text-gray-400 mt-1">
                    選択肢: {f.options.join(" / ")}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  onClick={() => startEdit(f)}
                  className="p-1.5 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition-colors"
                  title="編集"
                >
                  <Pencil className="w-4 h-4" />
                </button>
                <button
                  onClick={() => remove(f)}
                  className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50 transition-colors"
                  title="削除"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          )
        )}

        {formFields.length === 0 && !isCreating && (
          <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center">
            <ListChecks className="w-10 h-10 text-gray-200 mx-auto mb-3" />
            <p className="text-sm text-gray-400">問診票の項目がまだ登録されていません</p>
            <button
              onClick={startCreate}
              className="mt-4 text-sm text-blue-500 hover:text-blue-700 underline"
            >
              最初の項目を追加する
            </button>
          </div>
        )}

        {isCreating && (
          <FieldEditor
            draftName={draftName}
            draftType={draftType}
            draftRequired={draftRequired}
            draftOptionsText={draftOptionsText}
            onName={setDraftName}
            onType={setDraftType}
            onRequired={setDraftRequired}
            onOptionsText={setDraftOptionsText}
            onSave={save}
            onCancel={cancel}
            busy={busy}
          />
        )}
      </div>
    </div>
  );
}

// =========================================================
// ブランディング設定パネル
// =========================================================
const THEME_PRESETS = [
  "#3B82F6", "#10B981", "#F59E0B", "#EF4444",
  "#8B5CF6", "#EC4899", "#14B8A6", "#6366F1",
  "#0EA5E9", "#F97316", "#84CC16", "#64748B",
];

const BG_COLOR_PRESETS = [
  "#FFFFFF", "#F9FAFB", "#F3F4F6", "#EFF6FF",
  "#F0FDF4", "#FFF7ED", "#FDF4FF", "#FFF1F2",
  "#F0F9FF", "#FEFCE8", "#E0F2FE", "#1E293B",
];

function BrandingPanel({ onError }: { onError: (msg: string) => void }) {
  const [settings, setSettings] = useState<BrandingSettings | null>(null);
  const [themeColor, setThemeColor] = useState("#3B82F6");
  const [backgroundColor, setBackgroundColor] = useState("#F3F4F6");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      const s = await fetchBrandingSettings();
      if (s) {
        setSettings(s);
        setThemeColor(s.theme_color);
        setLogoUrl(s.logo_url);
        setBackgroundColor(s.background_color ?? "#F3F4F6");
      }
      setIsLoading(false);
    })();
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoFile(file);
    const reader = new FileReader();
    reader.onloadend = () => setLogoPreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    setBusy(true);
    setSuccess(false);
    try {
      let newLogoUrl = logoUrl;
      if (logoFile) {
        newLogoUrl = await uploadLogo(logoFile);
      }
      const saved = await saveBrandingSettings({
        theme_color: themeColor,
        logo_url: newLogoUrl,
        background_color: backgroundColor,
      });
      setSettings(saved);
      setLogoUrl(saved.logo_url);
      setBackgroundColor(saved.background_color ?? "#F3F4F6");
      setLogoFile(null);
      setLogoPreview(null);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (e) {
      onError(errorMessage(e, "デザインの保存に失敗しました"));
    } finally {
      setBusy(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="max-w-lg space-y-4">
      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-gray-800">デザイン設定</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            お客様向け予約画面のテーマカラー・背景色・ロゴを設定します
          </p>
        </div>

        <div className="space-y-8">
          {/* テーマカラー */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-3">テーマカラー</label>
            <div className="flex items-center gap-3 mb-4">
              <input
                type="color"
                value={themeColor}
                onChange={(e) => setThemeColor(e.target.value)}
                className="w-10 h-10 rounded-lg border border-gray-200 cursor-pointer p-0.5 bg-white"
              />
              <input
                type="text"
                value={themeColor}
                onChange={(e) => {
                  const v = e.target.value;
                  if (/^#[0-9A-Fa-f]{0,6}$/.test(v)) setThemeColor(v);
                }}
                placeholder="#3B82F6"
                className="w-28 px-3 py-2 rounded-lg border border-gray-200 text-sm font-mono outline-none focus:border-blue-500 bg-white"
              />
              <div
                className="w-10 h-10 rounded-lg border border-gray-200 flex-shrink-0 shadow-sm"
                style={{ backgroundColor: themeColor }}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              {THEME_PRESETS.map((c) => (
                <button
                  key={c}
                  onClick={() => setThemeColor(c)}
                  className={cn(
                    "w-8 h-8 rounded-full transition-transform hover:scale-110",
                    themeColor.toLowerCase() === c.toLowerCase() &&
                      "ring-2 ring-offset-2 ring-gray-700 scale-110"
                  )}
                  style={{ backgroundColor: c }}
                  title={c}
                />
              ))}
            </div>
          </div>

          {/* 背景色 */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-3">サイトの背景色</label>
            <div className="flex items-center gap-3 mb-4">
              <input
                type="color"
                value={backgroundColor}
                onChange={(e) => setBackgroundColor(e.target.value)}
                className="w-10 h-10 rounded-lg border border-gray-200 cursor-pointer p-0.5 bg-white"
              />
              <input
                type="text"
                value={backgroundColor}
                onChange={(e) => {
                  const v = e.target.value;
                  if (/^#[0-9A-Fa-f]{0,6}$/.test(v)) setBackgroundColor(v);
                }}
                placeholder="#F3F4F6"
                className="w-28 px-3 py-2 rounded-lg border border-gray-200 text-sm font-mono outline-none focus:border-blue-500 bg-white"
              />
              <div
                className="w-10 h-10 rounded-lg border border-gray-200 flex-shrink-0 shadow-sm"
                style={{ backgroundColor }}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              {BG_COLOR_PRESETS.map((c) => (
                <button
                  key={c}
                  onClick={() => setBackgroundColor(c)}
                  className={cn(
                    "w-8 h-8 rounded-full transition-transform hover:scale-110 border border-gray-200",
                    backgroundColor.toLowerCase() === c.toLowerCase() &&
                      "ring-2 ring-offset-2 ring-gray-700 scale-110"
                  )}
                  style={{ backgroundColor: c }}
                  title={c}
                />
              ))}
            </div>
          </div>

          {/* プレビュー */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-3">プレビュー</label>
            <div
              className="rounded-xl p-4 transition-colors"
              style={{ backgroundColor }}
            >
              <div className="bg-white rounded-xl border border-gray-200 p-4 max-w-xs mx-auto shadow-sm">
                <div className="flex items-center gap-2 mb-3">
                  {[1, 2, 3].map((n) => (
                    <div
                      key={n}
                      className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-semibold"
                      style={{ backgroundColor: themeColor }}
                    >
                      {n}
                    </div>
                  ))}
                </div>
                <p className="text-xs text-gray-500 mb-3">日時を選択してください</p>
                <button
                  className="w-full py-2 rounded-lg text-sm font-semibold text-white"
                  style={{ backgroundColor: themeColor }}
                >
                  この日時を追加
                </button>
              </div>
            </div>
          </div>

          <div className="border-t border-gray-100" />

          {/* ロゴアップロード */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-3">会社ロゴ</label>
            <div className="flex items-start gap-4">
              <div className="w-24 h-24 rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden flex-shrink-0">
                {logoPreview ? (
                  <img src={logoPreview} alt="プレビュー" className="w-full h-full object-contain p-2" />
                ) : logoUrl ? (
                  <img src={logoUrl} alt="現在のロゴ" className="w-full h-full object-contain p-2" />
                ) : (
                  <div className="text-center px-2">
                    <Palette className="w-6 h-6 text-gray-300 mx-auto mb-1" />
                    <p className="text-xs text-gray-400">未設定</p>
                  </div>
                )}
              </div>
              <div className="flex-1">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/svg+xml,image/webp"
                  onChange={handleFileChange}
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-200 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  <Upload className="w-4 h-4" />
                  {logoFile ? "ファイルを変更" : "ファイルを選択"}
                </button>
                {logoFile && (
                  <p className="text-xs text-gray-500 mt-2 truncate max-w-[200px]">{logoFile.name}</p>
                )}
                {logoUrl && !logoFile && (
                  <button
                    onClick={() => { setLogoUrl(null); setLogoPreview(null); }}
                    className="mt-2 text-xs text-red-500 hover:text-red-700 transition-colors"
                  >
                    ロゴを削除
                  </button>
                )}
                <p className="text-xs text-gray-400 mt-3 leading-relaxed">
                  PNG / JPG / SVG / WebP<br />
                  推奨サイズ: 200×200px 以上<br />
                  ※ アップロードには Supabase Storage に<br />
                  「logos」公開バケットが必要です
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8 pt-5 border-t border-gray-100 flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={busy}
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity disabled:opacity-50"
            style={{ backgroundColor: themeColor }}
          >
            {busy ? (
              <><Loader2 className="w-4 h-4 animate-spin" />保存中...</>
            ) : (
              <><Check className="w-4 h-4" />デザインを保存</>
            )}
          </button>
          {success && (
            <span className="text-sm text-green-600 flex items-center gap-1.5">
              <Check className="w-4 h-4" />
              保存しました
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
