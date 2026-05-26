"use client";
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Check,
  CheckCircle2,
  Loader2,
  AlertCircle,
  Users,
  UserMinus,
  SlidersHorizontal,
} from "lucide-react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import {
  createReservation,
  fetchTimeSlotsInRange,
  fetchSlotBookingCounts,
  fetchCategories,
  fetchStaffs,
  fetchFormFields,
  fetchBrandingSettings,
  type TimeSlot,
  type Category,
  type Staff,
  type FormField,
  type BrandingSettings,
  type SlotBookingCount,
} from "@/lib/supabase";

function cn(...inputs: (string | undefined | null | boolean)[]) {
  return twMerge(clsx(inputs));
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}

function generateReservationNumber() {
  const ts = Date.now().toString(36).toUpperCase();
  const rnd = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `RSV-${ts.slice(-4)}${rnd}`;
}

function formatDateForDB(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatDateStrForDB(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** "HH:MM:SS" → "H:MM" */
function fmtTime(t: string): string {
  if (!t) return "";
  const [h, m] = t.split(":");
  return `${parseInt(h)}:${m.padStart(2, "0")}`;
}

function durationMin(start: string, end: string): number {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  return (eh * 60 + em) - (sh * 60 + sm);
}

const STEPS = [
  { id: 1, label: "日時の選択" },
  { id: 2, label: "お客様情報" },
  { id: 3, label: "内容確認" },
];

interface CustomerInfo {
  name: string;
  email: string;
  phone: string;
  notes: string;
}

type StaffFilter = "all" | "none" | string;

// =========================================================
// Step bar
// =========================================================
function StepBar({
  currentStep,
  allDone,
  themeColor = "#3B82F6",
}: {
  currentStep: number;
  allDone?: boolean;
  themeColor?: string;
}) {
  return (
    <div className="mb-8">
      <div className="flex items-center justify-between">
        {STEPS.map((step, index) => {
          const done = allDone || currentStep > step.id;
          const active = currentStep === step.id && !allDone;
          return (
            <div key={step.id} className="flex items-center">
              <div className="flex flex-col items-center">
                <div
                  className={cn(
                    "w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-all",
                    !done && !active && "bg-gray-100 text-gray-400"
                  )}
                  style={
                    done || allDone
                      ? { backgroundColor: themeColor, color: "white" }
                      : active
                      ? {
                          backgroundColor: themeColor,
                          color: "white",
                          boxShadow: `0 0 0 4px ${themeColor}33`,
                        }
                      : {}
                  }
                >
                  {done || allDone ? <Check className="w-4 h-4" /> : step.id}
                </div>
                <span
                  className={cn(
                    "text-xs mt-2 whitespace-nowrap",
                    (done || active || allDone)
                      ? "text-gray-800 font-medium"
                      : "text-gray-400"
                  )}
                >
                  {step.label}
                </span>
              </div>
              {index < STEPS.length - 1 && (
                <div
                  className="flex-1 h-0.5 mx-3 mt-[-1rem]"
                  style={{
                    width: 60,
                    backgroundColor:
                      done || allDone ? themeColor : "#e5e7eb",
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// =========================================================
// Custom field input renderer
// =========================================================
function CustomFieldInput({
  field,
  value,
  onChange,
}: {
  field: FormField;
  value: string;
  onChange: (val: string) => void;
}) {
  const baseClass =
    "w-full px-4 py-3 rounded-xl border border-gray-300 bg-white themed-input text-gray-800";

  if (field.field_type === "select") {
    return (
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(baseClass, "bg-white")}
      >
        <option value="">選択してください</option>
        {(field.options ?? []).map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
    );
  }
  if (field.field_type === "textarea") {
    return (
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        className={cn(baseClass, "placeholder-gray-400 resize-none")}
      />
    );
  }
  return (
    <input
      type={field.field_type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(baseClass, "placeholder-gray-400")}
    />
  );
}

// =========================================================
// Main page
// =========================================================
export default function ReservationPage() {
  const today = new Date();

  const [currentStep, setCurrentStep] = useState(1);
  const [isCompleted, setIsCompleted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [reservationNumber, setReservationNumber] = useState("");

  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null);
  const [staffFilter, setStaffFilter] = useState<StaffFilter>("all");

  const [monthSlots, setMonthSlots] = useState<TimeSlot[]>([]);
  const [slotBookingCounts, setSlotBookingCounts] = useState<Map<string, SlotBookingCount>>(new Map());
  const [isSlotsLoading, setIsSlotsLoading] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [staffs, setStaffs] = useState<Staff[]>([]);
  const [formFields, setFormFields] = useState<FormField[]>([]);

  // 検索条件フィルター
  const [searchCategoryId, setSearchCategoryId] = useState<string>("");
  const [searchStaffId, setSearchStaffId] = useState<string>("");
  const [searchWeekday, setSearchWeekday] = useState<string>("");
  const [searchTimeRange, setSearchTimeRange] = useState<string>("");

  const [customerInfo, setCustomerInfo] = useState<CustomerInfo>({
    name: "", email: "", phone: "", notes: "",
  });
  const [customAnswers, setCustomAnswers] = useState<Record<string, string>>({});
  const [branding, setBranding] = useState<BrandingSettings | null>(null);
  const theme = branding?.theme_color ?? "#3B82F6";
  const bgColor = branding?.background_color ?? "#F3F4F6";

  // Load master data once
  useEffect(() => {
    (async () => {
      try {
        const [cats, stfs, fields, brand] = await Promise.all([
          fetchCategories(),
          fetchStaffs(),
          fetchFormFields(),
          fetchBrandingSettings(),
        ]);
        setCategories(cats);
        setStaffs(stfs);
        setFormFields(fields);
        if (brand) setBranding(brand);
      } catch (e) {
        console.error("マスターデータの読み込みに失敗:", e);
      }
    })();
  }, []);

  // Load slots for current month + fetch which are already booked
  const loadMonthSlots = useCallback(async () => {
    setIsSlotsLoading(true);
    setSlotBookingCounts(new Map());
    try {
      const start = formatDateStrForDB(currentYear, currentMonth, 1);
      const lastDay = getDaysInMonth(currentYear, currentMonth);
      const end = formatDateStrForDB(currentYear, currentMonth, lastDay);
      const slots = await fetchTimeSlotsInRange(start, end);
      setMonthSlots(slots);
      // 予約件数・定員情報を取得（失敗してもスロット表示は妨げない）
      fetchSlotBookingCounts(slots.map((s) => s.id))
        .then((counts) => setSlotBookingCounts(counts))
        .catch((err) => console.warn("予約件数の取得に失敗（無視）:", err));
    } catch (e) {
      console.error("予約枠の読み込みに失敗:", e);
    } finally {
      setIsSlotsLoading(false);
    }
  }, [currentYear, currentMonth]);

  useEffect(() => { loadMonthSlots(); }, [loadMonthSlots]);

  const categoryMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const staffMap = useMemo(() => new Map(staffs.map((s) => [s.id, s])), [staffs]);

  const slotsByDate = useMemo(() => {
    const map = new Map<string, TimeSlot[]>();
    for (const s of monthSlots) {
      const list = map.get(s.slot_date) ?? [];
      list.push(s);
      map.set(s.slot_date, list);
    }
    return map;
  }, [monthSlots]);

  const selectedDateStr = selectedDate ? formatDateForDB(selectedDate) : null;
  const slotsForDate: TimeSlot[] = selectedDateStr ? (slotsByDate.get(selectedDateStr) ?? []) : [];

  const staffsInDate = useMemo(() => {
    const ids = new Set(slotsForDate.filter((s) => s.staff_id).map((s) => s.staff_id!));
    const hasNone = slotsForDate.some((s) => !s.staff_id);
    return { ids, hasNone };
  }, [slotsForDate]);

  const displaySlots = useMemo(() => {
    let list = slotsForDate;
    if (staffFilter === "none") list = list.filter((s) => !s.staff_id);
    else if (staffFilter !== "all") list = list.filter((s) => s.staff_id === staffFilter);
    if (searchCategoryId) list = list.filter((s) => s.category_id === searchCategoryId);
    if (searchStaffId) list = list.filter((s) => s.staff_id === searchStaffId);
    if (searchTimeRange) {
      list = list.filter((s) => {
        const hour = parseInt(s.start_time.split(":")[0]);
        if (searchTimeRange === "morning") return hour < 12;
        if (searchTimeRange === "afternoon") return hour >= 12 && hour < 17;
        if (searchTimeRange === "evening") return hour >= 17;
        return true;
      });
    }
    return [...list].sort((a, b) => a.start_time.localeCompare(b.start_time));
  }, [slotsForDate, staffFilter, searchCategoryId, searchStaffId, searchTimeRange]);

  const daysInMonth = getDaysInMonth(currentYear, currentMonth);
  const firstDayOfMonth = getFirstDayOfMonth(currentYear, currentMonth);
  const calendarDays: (number | null)[] = [];
  for (let i = 0; i < firstDayOfMonth; i++) calendarDays.push(null);
  for (let d = 1; d <= daysInMonth; d++) calendarDays.push(d);

  const isAvailableDay = (day: number) => {
    // 曜日フィルター
    const dayOfWeek = (firstDayOfMonth + day - 1) % 7;
    if (searchWeekday !== "" && dayOfWeek !== parseInt(searchWeekday)) return false;

    const ds = formatDateStrForDB(currentYear, currentMonth, day);
    const slots = slotsByDate.get(ds) ?? [];
    if (slots.length === 0) return false;
    return slots.some((s) => {
      const info = slotBookingCounts.get(s.id);
      if (info && info.count >= info.capacity) return false;
      if (searchCategoryId && s.category_id !== searchCategoryId) return false;
      if (searchStaffId && s.staff_id !== searchStaffId) return false;
      if (searchTimeRange) {
        const hour = parseInt(s.start_time.split(":")[0]);
        if (searchTimeRange === "morning" && hour >= 12) return false;
        if (searchTimeRange === "afternoon" && (hour < 12 || hour >= 17)) return false;
        if (searchTimeRange === "evening" && hour < 17) return false;
      }
      return true;
    });
  };

  const dotsForDay = (day: number): string[] => {
    const ds = formatDateStrForDB(currentYear, currentMonth, day);
    const slots = slotsByDate.get(ds) ?? [];
    const colorSet = new Set<string>();
    for (const s of slots) {
      const c = categoryMap.get(s.category_id);
      if (c) colorSet.add(c.color);
    }
    return Array.from(colorSet).slice(0, 4);
  };

  const goToPreviousMonth = () => {
    if (currentMonth === 0) { setCurrentMonth(11); setCurrentYear((y) => y - 1); }
    else setCurrentMonth((m) => m - 1);
    clearDateSelection();
  };

  const goToNextMonth = () => {
    if (currentMonth === 11) { setCurrentMonth(0); setCurrentYear((y) => y + 1); }
    else setCurrentMonth((m) => m + 1);
    clearDateSelection();
  };

  const clearDateSelection = () => {
    setSelectedDate(null);
    setSelectedSlot(null);
    setStaffFilter("all");
  };

  const handleDateClick = (day: number) => {
    if (!isAvailableDay(day)) return;
    setSelectedDate(new Date(currentYear, currentMonth, day));
    setSelectedSlot(null);
    setStaffFilter("all");
    // 日付選択のたびに予約件数・定員情報を最新化し、満席枠をリアルタイム反映
    if (monthSlots.length > 0) {
      fetchSlotBookingCounts(monthSlots.map((s) => s.id))
        .then((counts) => setSlotBookingCounts(counts))
        .catch((err) => console.warn("日付選択時の予約件数取得に失敗:", err));
    }
  };

  const formatSelectedDate = () => {
    if (!selectedDate) return "";
    return `${selectedDate.getMonth() + 1}月${selectedDate.getDate()}日（${WEEKDAYS[selectedDate.getDay()]}）`;
  };

  const formatFullDate = () => {
    if (!selectedDate) return "";
    return `${selectedDate.getFullYear()}年${selectedDate.getMonth() + 1}月${selectedDate.getDate()}日（${WEEKDAYS[selectedDate.getDay()]}）`;
  };

  const isStep1Complete = selectedDate !== null && selectedSlot !== null;
  const isStep2Complete =
    customerInfo.name.trim() !== "" &&
    customerInfo.email.trim() !== "" &&
    customerInfo.phone.trim() !== "" &&
    formFields.every((f) => !f.is_required || (customAnswers[f.field_name] ?? "").trim() !== "");

  const goToNextStep = () => { if (currentStep < 3) setCurrentStep((s) => s + 1); };
  const goToPreviousStep = () => { if (currentStep > 1) setCurrentStep((s) => s - 1); };

  const confirmReservation = async () => {
    if (!selectedDate || !selectedSlot) return;
    setIsSubmitting(true);
    setSubmitError(null);
    const number = generateReservationNumber();
    try {
      const filledAnswers = Object.fromEntries(
        Object.entries(customAnswers).filter(([, v]) => v.trim() !== "")
      );
      await createReservation({
        slot_id: selectedSlot.id,
        reservation_date: formatDateForDB(selectedDate),
        reservation_time: selectedSlot.start_time,
        name: customerInfo.name,
        customer_email: customerInfo.email,
        phone: customerInfo.phone,
        notes: customerInfo.notes || undefined,
        custom_answers: Object.keys(filledAnswers).length > 0 ? filledAnswers : undefined,
      });
      setReservationNumber(number);
      setIsCompleted(true);

      // メール送信（失敗しても予約完了は妨げない）
      try {
        await fetch("/api/send-confirmation", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: customerInfo.name,
            email: customerInfo.email,
            date: formatFullDate(),
            time: slotDisplay?.timeRange ?? "",
            reservationNumber: number,
            customAnswers: filledAnswers,
          }),
        });
      } catch (emailErr) {
        console.warn("確認メール送信に失敗しました（予約は完了しています）:", emailErr);
      }
    } catch (err: unknown) {
      const e = err as { message?: string };
      setSubmitError(e?.message ?? "予約の保存に失敗しました。");
      // 満席エラーの場合は枠の空き状況を再取得して画面に反映
      void loadMonthSlots();
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetToTop = () => {
    setCurrentStep(1);
    setIsCompleted(false);
    setIsSubmitting(false);
    setSubmitError(null);
    setReservationNumber("");
    clearDateSelection();
    setCustomerInfo({ name: "", email: "", phone: "", notes: "" });
    setCustomAnswers({});
    setCurrentYear(today.getFullYear());
    setCurrentMonth(today.getMonth());
  };

  const updateCustomerInfo = (field: keyof CustomerInfo, value: string) =>
    setCustomerInfo((prev) => ({ ...prev, [field]: value }));

  const updateCustomAnswer = (fieldName: string, value: string) =>
    setCustomAnswers((prev) => ({ ...prev, [fieldName]: value }));

  const addButtonRef = useRef<HTMLDivElement>(null);

  const handleSlotSelect = useCallback((slot: TimeSlot) => {
    setSelectedSlot(slot);
    setTimeout(() => {
      addButtonRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 100);
  }, []);

  const slotDisplay = selectedSlot
    ? {
        timeRange: `${fmtTime(selectedSlot.start_time)}〜${fmtTime(selectedSlot.end_time)}`,
        duration: durationMin(selectedSlot.start_time, selectedSlot.end_time),
        category: categoryMap.get(selectedSlot.category_id),
        staff: selectedSlot.staff_id ? staffMap.get(selectedSlot.staff_id) : null,
      }
    : null;

  // =========================================================
  // Completion screen
  // =========================================================
  if (isCompleted) {
    const filledCustomAnswers = formFields.filter(
      (f) => (customAnswers[f.field_name] ?? "").trim() !== ""
    );

    return (
      <div className="min-h-screen py-8 px-4 transition-colors" style={{ backgroundColor: bgColor }}>
        <div className="max-w-md mx-auto">
          {/* ロゴ / 会社名ヘッダー */}
          {branding?.logo_url ? (
            <div className="text-center mb-6">
              <img
                src={branding.logo_url}
                alt="会社ロゴ"
                className="h-16 mx-auto object-contain"
              />
            </div>
          ) : (
            <div className="text-center mb-6">
              <div
                className="inline-block w-12 h-12 rounded-2xl mb-2"
                style={{ backgroundColor: theme }}
              />
              <p className="text-sm font-semibold text-gray-700">ご予約</p>
            </div>
          )}

          <StepBar currentStep={3} allDone themeColor={theme} />

          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="text-center mb-8">
              <div className="inline-flex items-center justify-center w-20 h-20 bg-green-100 rounded-full mb-6">
                <CheckCircle2 className="w-10 h-10 text-green-500" />
              </div>
              <h1 className="text-2xl font-bold text-gray-800 mb-2">
                ご予約ありがとうございました！
              </h1>
              <p className="text-gray-500 text-sm">
                確認メールをお送りしましたのでご確認ください
              </p>
            </div>

            <div className="bg-blue-50 rounded-xl p-6 mb-6 text-center">
              <p className="text-sm text-gray-600 mb-2">予約番号</p>
              <p className="text-2xl font-bold text-blue-600 tracking-wider">
                {reservationNumber}
              </p>
            </div>

            <div className="bg-gray-50 rounded-xl p-5 mb-8 space-y-4">
              <h2 className="text-sm font-medium text-gray-800 border-b border-gray-200 pb-3">
                ご予約内容
              </h2>
              <div>
                <p className="text-sm text-gray-500 mb-1">ご予約日時</p>
                <p className="text-base font-medium text-gray-800">{formatFullDate()}</p>
                {slotDisplay && (
                  <>
                    <p className="text-base font-medium text-gray-800">
                      {slotDisplay.timeRange}（{slotDisplay.duration}分間）
                    </p>
                    <div className="flex flex-wrap gap-2 mt-1">
                      {slotDisplay.category && (
                        <span
                          className="text-xs px-2 py-0.5 rounded-full font-medium text-white"
                          style={{ backgroundColor: slotDisplay.category.color }}
                        >
                          {slotDisplay.category.name}
                        </span>
                      )}
                      {slotDisplay.staff && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-gray-200 text-gray-700">
                          {slotDisplay.staff.name}
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>
              <div className="border-t border-gray-200 pt-4">
                <p className="text-sm text-gray-500 mb-1">お名前</p>
                <p className="text-base font-medium text-gray-800">{customerInfo.name}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500 mb-1">メールアドレス</p>
                <p className="text-base font-medium text-gray-800">{customerInfo.email}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500 mb-1">電話番号</p>
                <p className="text-base font-medium text-gray-800">{customerInfo.phone}</p>
              </div>
              {customerInfo.notes && (
                <div>
                  <p className="text-sm text-gray-500 mb-1">備考</p>
                  <p className="text-base font-medium text-gray-800">{customerInfo.notes}</p>
                </div>
              )}
              {filledCustomAnswers.map((field) => (
                <div key={field.id}>
                  <p className="text-sm text-gray-500 mb-1">{field.field_name}</p>
                  <p className="text-base font-medium text-gray-800">
                    {customAnswers[field.field_name]}
                  </p>
                </div>
              ))}
            </div>

            <button
              onClick={resetToTop}
              className="w-full py-4 rounded-xl text-base font-medium text-white shadow-lg transition-all"
              style={{ backgroundColor: theme }}
            >
              トップに戻る
            </button>
          </div>
        </div>
      </div>
    );
  }

  // =========================================================
  // Main flow
  // =========================================================
  return (
    <div className="min-h-screen py-8 px-4 transition-colors" style={{ backgroundColor: bgColor }}>
      <div className="max-w-md mx-auto">
        {/* ロゴ / 会社名ヘッダー */}
        {branding?.logo_url ? (
          <div className="text-center mb-6">
            <img
              src={branding.logo_url}
              alt="会社ロゴ"
              className="h-16 mx-auto object-contain"
            />
          </div>
        ) : (
          <div className="text-center mb-6">
            <div
              className="inline-block w-12 h-12 rounded-2xl mb-2"
              style={{ backgroundColor: theme }}
            />
            <p className="text-sm font-semibold text-gray-700">ご予約</p>
          </div>
        )}

        <StepBar currentStep={currentStep} themeColor={theme} />

        {/* ---- Step 1: 日時・枠を選ぶ ---- */}
        {currentStep === 1 && (
          <div className="animate-in fade-in slide-in-from-right-4 duration-300">
            <div className="mb-6">
              <h1 className="text-lg font-medium text-gray-800 mb-1">
                日時を選択してください
              </h1>
              <p className="text-sm text-gray-500">
                予約可能な日付は色付きの丸で表示されています
              </p>
            </div>

            {/* 検索条件エリア */}
            <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-1.5">
                  <SlidersHorizontal className="w-4 h-4 text-gray-500" />
                  <h3 className="text-sm font-medium text-gray-700">絞り込み検索</h3>
                </div>
                {(searchCategoryId || searchStaffId || searchWeekday || searchTimeRange) && (
                  <button
                    onClick={() => {
                      setSearchCategoryId("");
                      setSearchStaffId("");
                      setSearchWeekday("");
                      setSearchTimeRange("");
                      clearDateSelection();
                    }}
                    className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    条件をクリア
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {categories.length > 0 && (
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">メニュー</label>
                    <select
                      value={searchCategoryId}
                      onChange={(e) => { setSearchCategoryId(e.target.value); clearDateSelection(); }}
                      className="w-full px-2.5 py-2 rounded-lg border border-gray-200 text-sm bg-white text-gray-700 outline-none focus:border-blue-400 cursor-pointer"
                    >
                      <option value="">すべて</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                )}
                {staffs.length > 0 && (
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">担当者</label>
                    <select
                      value={searchStaffId}
                      onChange={(e) => { setSearchStaffId(e.target.value); clearDateSelection(); }}
                      className="w-full px-2.5 py-2 rounded-lg border border-gray-200 text-sm bg-white text-gray-700 outline-none focus:border-blue-400 cursor-pointer"
                    >
                      <option value="">すべて</option>
                      {staffs.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <label className="block text-xs text-gray-500 mb-1">曜日</label>
                  <select
                    value={searchWeekday}
                    onChange={(e) => { setSearchWeekday(e.target.value); clearDateSelection(); }}
                    className="w-full px-2.5 py-2 rounded-lg border border-gray-200 text-sm bg-white text-gray-700 outline-none focus:border-blue-400 cursor-pointer"
                  >
                    <option value="">すべて</option>
                    {WEEKDAYS.map((d, i) => (
                      <option key={i} value={String(i)}>{d}曜日</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">時間帯</label>
                  <select
                    value={searchTimeRange}
                    onChange={(e) => { setSearchTimeRange(e.target.value); clearDateSelection(); }}
                    className="w-full px-2.5 py-2 rounded-lg border border-gray-200 text-sm bg-white text-gray-700 outline-none focus:border-blue-400 cursor-pointer"
                  >
                    <option value="">すべて</option>
                    <option value="morning">午前（〜12時）</option>
                    <option value="afternoon">午後（12〜17時）</option>
                    <option value="evening">夜（17時〜）</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Calendar */}
            <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
              <div className="flex items-center justify-between mb-5">
                <button
                  onClick={goToPreviousMonth}
                  className="p-2 hover:bg-gray-100 rounded-full transition-colors"
                >
                  <ChevronLeft className="w-5 h-5 text-gray-400" />
                </button>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-medium text-gray-800">
                    {currentYear}年{currentMonth + 1}月
                  </h2>
                  {isSlotsLoading && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}
                </div>
                <button
                  onClick={goToNextMonth}
                  className="p-2 hover:bg-gray-100 rounded-full transition-colors"
                >
                  <ChevronRight className="w-5 h-5 text-gray-400" />
                </button>
              </div>

              <div className="grid grid-cols-7 gap-1 mb-2">
                {WEEKDAYS.map((day, index) => (
                  <div
                    key={day}
                    className={cn(
                      "text-center text-xs font-medium py-2",
                      index === 0 && "text-red-400",
                      index === 6 && "text-blue-400",
                      index !== 0 && index !== 6 && "text-gray-400"
                    )}
                  >
                    {day}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-1">
                {calendarDays.map((day, index) => {
                  if (day === null) return <div key={`e-${index}`} className="h-12" />;
                  const isSelected =
                    selectedDate?.getDate() === day &&
                    selectedDate?.getMonth() === currentMonth &&
                    selectedDate?.getFullYear() === currentYear;
                  const available = isAvailableDay(day);
                  const dots = dotsForDay(day);
                  const dayOfWeek = (firstDayOfMonth + day - 1) % 7;

                  return (
                    <button
                      key={day}
                      onClick={() => handleDateClick(day)}
                      disabled={!available}
                      className={cn(
                        "h-12 mx-auto w-full rounded-lg text-sm font-medium transition-all flex flex-col items-center justify-center gap-0.5",
                        !available && "text-gray-300 cursor-default",
                        !available && dayOfWeek === 0 && "text-red-200",
                        available && !isSelected && "cursor-pointer hover:bg-gray-50",
                        available && !isSelected && dayOfWeek === 0 && "text-red-500",
                        available && !isSelected && dayOfWeek === 6 && "text-blue-500",
                        available && !isSelected && dayOfWeek !== 0 && dayOfWeek !== 6 && "text-gray-800",
                        isSelected && "text-white"
                      )}
                      style={isSelected ? { backgroundColor: theme } : {}}
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
            </div>

            {selectedDate && (
              <div className="animate-in fade-in slide-in-from-top-2 duration-300">
                {(staffs.length > 0 || staffsInDate.hasNone) && slotsForDate.length > 0 && (
                  <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
                    <div className="flex items-center gap-1.5 mb-3">
                      <Users className="w-4 h-4 text-gray-500" />
                      <h3 className="text-sm font-medium text-gray-700">
                        担当スタッフで絞り込む
                      </h3>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => { setStaffFilter("all"); setSelectedSlot(null); }}
                        className={cn(
                          "px-3 py-1.5 rounded-full text-sm border transition-all",
                          staffFilter === "all"
                            ? "bg-gray-800 text-white border-gray-800"
                            : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
                        )}
                      >
                        すべて
                      </button>
                      {Array.from(staffsInDate.ids).map((sid) => {
                        const s = staffMap.get(sid);
                        if (!s) return null;
                        return (
                          <button
                            key={sid}
                            onClick={() => { setStaffFilter(sid); setSelectedSlot(null); }}
                            className={cn(
                              "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm border transition-all",
                              staffFilter === sid
                                ? "bg-gray-800 text-white border-gray-800"
                                : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
                            )}
                          >
                            <span
                              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                              style={{ backgroundColor: s.color }}
                            />
                            {s.name}
                          </button>
                        );
                      })}
                      {staffsInDate.hasNone && (
                        <button
                          onClick={() => { setStaffFilter("none"); setSelectedSlot(null); }}
                          className={cn(
                            "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm border transition-all",
                            staffFilter === "none"
                              ? "bg-gray-800 text-white border-gray-800"
                              : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
                          )}
                        >
                          <UserMinus className="w-3.5 h-3.5" />
                          指定なし
                        </button>
                      )}
                    </div>
                  </div>
                )}

                <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
                  <h3 className="text-sm font-medium text-gray-800 mb-1">
                    予約可能な時間枠
                  </h3>
                  <p className="text-xs text-gray-500 mb-4">{formatSelectedDate()}</p>

                  {displaySlots.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-4">
                      {staffFilter === "all"
                        ? "この日の予約枠はありません"
                        : "選択したスタッフの空き枠がありません"}
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {displaySlots.map((slot) => {
                        const cat = categoryMap.get(slot.category_id);
                        const staff = slot.staff_id ? staffMap.get(slot.staff_id) : null;
                        const dur = durationMin(slot.start_time, slot.end_time);
                        const timeRange = `${fmtTime(slot.start_time)}〜${fmtTime(slot.end_time)}`;
                        const isSelected = selectedSlot?.id === slot.id;
                        const info = slotBookingCounts.get(slot.id);
                        const bookingCount = info?.count ?? 0;
                        const slotCapacity = info?.capacity ?? 1;
                        const isBooked = bookingCount >= slotCapacity;
                        const remaining = slotCapacity - bookingCount;
                        const showCapacityInfo = slotCapacity > 1;

                        return (
                          <button
                            key={slot.id}
                            onClick={() => !isBooked && handleSlotSelect(slot)}
                            disabled={isBooked}
                            className={cn(
                              "w-full text-left p-3.5 rounded-xl border-2 transition-all",
                              isBooked
                                ? "border-gray-100 bg-gray-50 cursor-not-allowed opacity-75"
                                : isSelected
                                ? "bg-blue-50"
                                : "border-gray-200 bg-white hover:border-blue-300 hover:bg-blue-50/40"
                            )}
                            style={!isBooked && isSelected ? { borderColor: theme } : {}}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1">
                                <p
                                  className={cn(
                                    "text-base font-semibold",
                                    isBooked
                                      ? "text-gray-400"
                                      : isSelected
                                      ? "text-blue-700"
                                      : "text-gray-800"
                                  )}
                                >
                                  {timeRange}
                                  <span className="text-sm font-normal ml-1.5 text-gray-500">
                                    （{dur}分間）
                                  </span>
                                </p>
                                <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                                  {cat && (
                                    <span
                                      className={cn(
                                        "text-xs px-2 py-0.5 rounded-full font-medium",
                                        isBooked ? "bg-gray-200 text-gray-400" : "text-white"
                                      )}
                                      style={isBooked ? {} : { backgroundColor: cat.color }}
                                    >
                                      {cat.name}
                                    </span>
                                  )}
                                  {staff ? (
                                    <span
                                      className={cn(
                                        "text-xs px-2 py-0.5 rounded-full font-medium",
                                        isBooked ? "bg-gray-200 text-gray-400" : "text-white"
                                      )}
                                      style={isBooked ? {} : { backgroundColor: staff.color }}
                                    >
                                      {staff.name}
                                    </span>
                                  ) : (
                                    <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-400">
                                      スタッフ指定なし
                                    </span>
                                  )}
                                  {showCapacityInfo && !isBooked && (
                                    <span className="text-xs text-gray-400">
                                      {bookingCount}/{slotCapacity}人
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div className="flex-shrink-0 mt-0.5">
                                {isBooked ? (
                                  <span className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-red-100 text-red-600 font-semibold whitespace-nowrap">
                                    ✕ 満席
                                  </span>
                                ) : !isBooked && showCapacityInfo && remaining === 1 ? (
                                  <span className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-amber-100 text-amber-700 font-semibold whitespace-nowrap">
                                    残りわずか
                                  </span>
                                ) : (
                                  <div
                                    className={cn(
                                      "w-5 h-5 rounded-full border-2 flex items-center justify-center",
                                      isSelected
                                        ? "border-blue-500 bg-blue-500"
                                        : "border-gray-300"
                                    )}
                                  >
                                    {isSelected && <Check className="w-3 h-3 text-white" />}
                                  </div>
                                )}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

            <div ref={addButtonRef}>
              {selectedSlot && slotDisplay && (
                <div className="bg-blue-50 rounded-xl p-4 mb-4 animate-in fade-in duration-200">
                  <p className="text-xs text-gray-500 mb-1">選択中の日時・枠</p>
                  <p className="text-base font-semibold text-gray-800">
                    {formatSelectedDate()} {slotDisplay.timeRange}（{slotDisplay.duration}分間）
                  </p>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {slotDisplay.category && (
                      <span
                        className="text-xs px-2 py-0.5 rounded-full font-medium text-white"
                        style={{ backgroundColor: slotDisplay.category.color }}
                      >
                        {slotDisplay.category.name}
                      </span>
                    )}
                    {slotDisplay.staff && (
                      <span
                        className="text-xs px-2 py-0.5 rounded-full font-medium text-white"
                        style={{ backgroundColor: slotDisplay.staff.color }}
                      >
                        {slotDisplay.staff.name}
                      </span>
                    )}
                  </div>
                </div>
              )}

              <button
                disabled={!isStep1Complete}
                onClick={goToNextStep}
                className={cn(
                  "w-full py-4 rounded-xl text-base font-medium transition-all",
                  isStep1Complete
                    ? "text-white shadow-lg"
                    : "bg-gray-100 text-gray-400 cursor-not-allowed"
                )}
                style={isStep1Complete ? { backgroundColor: theme } : {}}
              >
                この日時を追加
              </button>
            </div>
          </div>
        )}

        {/* ---- Step 2: お客様情報 ---- */}
        {currentStep === 2 && (
          <div className="animate-in fade-in slide-in-from-right-4 duration-300">
            <div className="mb-6">
              <h1 className="text-lg font-medium text-gray-800 mb-1">
                お客様情報を入力してください
              </h1>
              <p className="text-sm text-gray-500">ご予約に必要な情報をご入力ください</p>
            </div>

            {slotDisplay && (
              <div className="bg-blue-50 rounded-xl p-4 mb-6">
                <p className="text-xs text-gray-500 mb-1">選択した日時・枠</p>
                <p className="text-base font-semibold text-gray-800">
                  {formatSelectedDate()} {slotDisplay.timeRange}（{slotDisplay.duration}分間）
                </p>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {slotDisplay.category && (
                    <span
                      className="text-xs px-2 py-0.5 rounded-full font-medium text-white"
                      style={{ backgroundColor: slotDisplay.category.color }}
                    >
                      {slotDisplay.category.name}
                    </span>
                  )}
                  {slotDisplay.staff && (
                    <span
                      className="text-xs px-2 py-0.5 rounded-full font-medium text-white"
                      style={{ backgroundColor: slotDisplay.staff.color }}
                    >
                      {slotDisplay.staff.name}
                    </span>
                  )}
                </div>
              </div>
            )}

            <div
              className="bg-white rounded-xl shadow-md p-6 mb-8 space-y-4"
              style={{ '--theme-color': theme } as React.CSSProperties}
            >
              {/* 基本情報 */}
              <div>
                <label className="block text-sm font-medium text-gray-800 mb-2">
                  お名前 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={customerInfo.name}
                  onChange={(e) => updateCustomerInfo("name", e.target.value)}
                  placeholder="山田 太郎"
                  className="w-full px-4 py-3 rounded-xl border border-gray-300 bg-white themed-input text-gray-800 placeholder-gray-400"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-800 mb-2">
                  メールアドレス <span className="text-red-500">*</span>
                </label>
                <input
                  type="email"
                  value={customerInfo.email}
                  onChange={(e) => updateCustomerInfo("email", e.target.value)}
                  placeholder="example@email.com"
                  className="w-full px-4 py-3 rounded-xl border border-gray-300 bg-white themed-input text-gray-800 placeholder-gray-400"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-800 mb-2">
                  電話番号 <span className="text-red-500">*</span>
                </label>
                <input
                  type="tel"
                  value={customerInfo.phone}
                  onChange={(e) => updateCustomerInfo("phone", e.target.value)}
                  placeholder="090-1234-5678"
                  className="w-full px-4 py-3 rounded-xl border border-gray-300 bg-white themed-input text-gray-800 placeholder-gray-400"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-800 mb-2">
                  備考
                </label>
                <textarea
                  value={customerInfo.notes}
                  onChange={(e) => updateCustomerInfo("notes", e.target.value)}
                  placeholder="ご要望やご質問があればご記入ください"
                  rows={3}
                  className="w-full px-4 py-3 rounded-xl border border-gray-300 bg-white themed-input text-gray-800 placeholder-gray-400 resize-none"
                />
              </div>

              {/* カスタムフィールド（動的生成） */}
              {formFields.length > 0 && (
                <div className="border-t border-gray-100 pt-4 space-y-4">
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                    その他ご記入ください
                  </p>
                  {formFields.map((field) => (
                    <div key={field.id}>
                      <label className="block text-sm font-medium text-gray-800 mb-2">
                        {field.field_name}
                        {field.is_required && (
                          <span className="text-red-500 ml-1">*</span>
                        )}
                      </label>
                      <CustomFieldInput
                        field={field}
                        value={customAnswers[field.field_name] ?? ""}
                        onChange={(val) => updateCustomAnswer(field.field_name, val)}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex gap-3">
              <button
                onClick={goToPreviousStep}
                className="flex-1 py-4 rounded-xl text-base font-medium border border-gray-200 text-gray-700 hover:bg-gray-50 transition-all"
              >
                戻る
              </button>
              <button
                disabled={!isStep2Complete}
                onClick={goToNextStep}
                className={cn(
                  "flex-1 py-4 rounded-xl text-base font-medium transition-all",
                  isStep2Complete
                    ? "text-white shadow-lg"
                    : "bg-gray-100 text-gray-400 cursor-not-allowed"
                )}
                style={isStep2Complete ? { backgroundColor: theme } : {}}
              >
                内容確認へ
              </button>
            </div>
          </div>
        )}

        {/* ---- Step 3: 内容確認 ---- */}
        {currentStep === 3 && (
          <div className="animate-in fade-in slide-in-from-right-4 duration-300">
            <div className="mb-6">
              <h1 className="text-lg font-medium text-gray-800 mb-1">
                ご予約内容の確認
              </h1>
              <p className="text-sm text-gray-500">
                以下の内容でよろしければ「予約を確定する」を押してください
              </p>
            </div>

            {submitError && (
              <div className="bg-red-50 border-2 border-red-300 rounded-xl p-5 mb-6 animate-in fade-in duration-200">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-6 h-6 text-red-500 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <h3 className="text-base font-semibold text-red-800 mb-2">
                      予約の保存に失敗しました
                    </h3>
                    <p className="text-sm text-red-700 whitespace-pre-wrap break-words">
                      {submitError}
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="bg-gray-50 rounded-xl p-5 mb-6 space-y-4">
              <div>
                <p className="text-sm text-gray-500 mb-1">ご予約日時・枠</p>
                <p className="text-base font-medium text-gray-800">{formatFullDate()}</p>
                {slotDisplay && (
                  <>
                    <p className="text-base font-medium text-gray-800">
                      {slotDisplay.timeRange}（{slotDisplay.duration}分間）
                    </p>
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {slotDisplay.category && (
                        <span
                          className="text-xs px-2 py-0.5 rounded-full font-medium text-white"
                          style={{ backgroundColor: slotDisplay.category.color }}
                        >
                          {slotDisplay.category.name}
                        </span>
                      )}
                      {slotDisplay.staff ? (
                        <span
                          className="text-xs px-2 py-0.5 rounded-full font-medium text-white"
                          style={{ backgroundColor: slotDisplay.staff.color }}
                        >
                          {slotDisplay.staff.name}
                        </span>
                      ) : (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-gray-200 text-gray-500">
                          スタッフ指定なし
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>
              <div className="border-t border-gray-200 pt-4">
                <p className="text-sm text-gray-500 mb-1">お名前</p>
                <p className="text-base font-medium text-gray-800">{customerInfo.name}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500 mb-1">メールアドレス</p>
                <p className="text-base font-medium text-gray-800">{customerInfo.email}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500 mb-1">電話番号</p>
                <p className="text-base font-medium text-gray-800">{customerInfo.phone}</p>
              </div>
              {customerInfo.notes && (
                <div>
                  <p className="text-sm text-gray-500 mb-1">備考</p>
                  <p className="text-base font-medium text-gray-800">{customerInfo.notes}</p>
                </div>
              )}
              {/* カスタム回答の確認表示 */}
              {formFields
                .filter(
                  (f) =>
                    (customAnswers[f.field_name] ?? "").trim() !== "" || f.is_required
                )
                .map((field) => (
                  <div key={field.id}>
                    <p className="text-sm text-gray-500 mb-1">{field.field_name}</p>
                    <p className="text-base font-medium text-gray-800">
                      {(customAnswers[field.field_name] ?? "").trim() || (
                        <span className="text-gray-400 font-normal">未入力</span>
                      )}
                    </p>
                  </div>
                ))}
            </div>

            <div className="flex gap-3">
              <button
                onClick={goToPreviousStep}
                disabled={isSubmitting}
                className="flex-1 py-4 rounded-xl text-base font-medium border border-gray-200 text-gray-700 hover:bg-gray-50 transition-all disabled:opacity-50"
              >
                戻る
              </button>
              <button
                onClick={confirmReservation}
                disabled={isSubmitting}
                className="flex-1 py-4 rounded-xl text-base font-medium text-white shadow-lg transition-all disabled:opacity-70 flex items-center justify-center gap-2"
                style={{ backgroundColor: theme }}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    処理中...
                  </>
                ) : (
                  "予約を確定する"
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
