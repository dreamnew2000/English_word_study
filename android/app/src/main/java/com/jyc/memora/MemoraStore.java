package com.jyc.memora;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.Date;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;

/**
 * Shared storage & FSRS-5 scheduler for both the Capacitor WebView and the Android Home Screen Widget.
 */
public class MemoraStore {
    private static final String PREFS = "memora_widget_prefs";
    private static final String KEY_STATE = "state_json";
    private static final String KEY_CUR_ID = "widget_cur_id";
    private static final String KEY_REVEALED = "widget_revealed";
    private static final String KEY_LAST_TOAST = "widget_last_feedback";
    private static final String KEY_EXAMPLES_MERGED = "examples_merged_v2";

    // FSRS-5 default weights (19 parameters)
    private static final double[] W = {
        0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192,
        1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621
    };
    private static final double DECAY = -0.5;
    private static final double FACTOR = 19.0 / 81.0;
    private static final long DAY_MS = 86400000L;

    public static class WidgetData {
        public String id = "";
        public String word = "";
        public String pron = "";
        public String meaning = "";
        public String example = "";
        public String exampleKo = "";
        public String kind = "new"; // "review", "new", or "extra"
        public boolean revealed = false;
        public int newDone = 0;
        public int newTotal = 20;
        public int dueLeft = 0;
        public int streak = 0;
        public boolean todayDone = false;
        public int retrievabilityPct = -1;
        public double stability = 0;
        public float speechRate = 0.95f;
        public String lastFeedback = "";
    }

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public static String todayIso() {
        return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
    }

    public static String addDaysIso(String iso, int days) {
        try {
            SimpleDateFormat fmt = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
            Date d = fmt.parse(iso);
            long t = (d != null ? d.getTime() : System.currentTimeMillis()) + (days * DAY_MS);
            return fmt.format(new Date(t));
        } catch (Exception e) {
            return todayIso();
        }
    }

    public static synchronized JSONObject loadState(Context ctx) {
        SharedPreferences sp = prefs(ctx);
        String raw = sp.getString(KEY_STATE, null);
        JSONObject state = null;
        if (raw != null && !raw.isEmpty()) {
            try {
                state = new JSONObject(raw);
            } catch (Exception ignored) {}
        }
        if (state == null) {
            state = createDefaultState();
        }
        ensureStructure(state);
        JSONObject words = state.optJSONObject("words");
        if (words == null || words.length() == 0) {
            bootstrapFromAssets(ctx, state);
            saveStateInternal(ctx, state);
        } else if (!sp.getBoolean(KEY_EXAMPLES_MERGED, false)) {
            mergeExamplesFromAssets(ctx, state);
            saveStateInternal(ctx, state);
            sp.edit().putBoolean(KEY_EXAMPLES_MERGED, true).apply();
        }
        return state;
    }

    public static synchronized void saveStateFromWeb(Context ctx, String json) {
        if (json == null || json.isEmpty()) return;
        try {
            JSONObject incoming = new JSONObject(json);
            ensureStructure(incoming);
            if (!incoming.has("updatedAt")) {
                incoming.put("updatedAt", System.currentTimeMillis());
            }
            prefs(ctx).edit().putString(KEY_STATE, incoming.toString()).apply();
        } catch (Exception ignored) {}
    }

    private static void saveStateInternal(Context ctx, JSONObject state) {
        try {
            state.put("updatedAt", System.currentTimeMillis());
            prefs(ctx).edit().putString(KEY_STATE, state.toString()).apply();
        } catch (Exception ignored) {}
    }

    public static synchronized String getRawStateJson(Context ctx) {
        JSONObject st = loadState(ctx);
        return st.toString();
    }

    private static JSONObject createDefaultState() {
        JSONObject s = new JSONObject();
        try {
            s.put("words", new JSONObject());
            s.put("cards", new JSONObject());
            s.put("days", new JSONObject());
            s.put("ai", new JSONObject());
            JSONObject settings = new JSONObject();
            settings.put("daily", 20);
            settings.put("retention", 0.9);
            settings.put("apiKey", "");
            settings.put("voice", "");
            settings.put("rate", 0.95);
            s.put("settings", settings);
            s.put("updatedAt", 0L);
        } catch (Exception ignored) {}
        return s;
    }

    private static void ensureStructure(JSONObject s) {
        try {
            if (!s.has("words") || s.optJSONObject("words") == null) s.put("words", new JSONObject());
            if (!s.has("cards") || s.optJSONObject("cards") == null) s.put("cards", new JSONObject());
            if (!s.has("days") || s.optJSONObject("days") == null) s.put("days", new JSONObject());
            if (!s.has("ai") || s.optJSONObject("ai") == null) s.put("ai", new JSONObject());
            if (!s.has("settings") || s.optJSONObject("settings") == null) {
                JSONObject settings = new JSONObject();
                settings.put("daily", 20);
                settings.put("retention", 0.9);
                settings.put("rate", 0.95);
                s.put("settings", settings);
            }
        } catch (Exception ignored) {}
    }

    private static JSONArray readAssetWords(Context ctx) {
        try (InputStream is = ctx.getAssets().open("public/words.json")) {
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            int n;
            while ((n = is.read(buf)) != -1) {
                bos.write(buf, 0, n);
            }
            JSONObject root = new JSONObject(new String(bos.toByteArray(), StandardCharsets.UTF_8));
            return root.optJSONArray("words");
        } catch (Exception e) {
            return null;
        }
    }

    /** 기존 설치본: 학습 기록은 유지하고 네이버 예문만 단어에 추가 */
    private static void mergeExamplesFromAssets(Context ctx, JSONObject state) {
        JSONArray list = readAssetWords(ctx);
        JSONObject words = state.optJSONObject("words");
        if (list == null || words == null) return;
        java.util.HashMap<String, JSONArray> byWord = new java.util.HashMap<>();
        for (int i = 0; i < list.length(); i++) {
            JSONObject item = list.optJSONObject(i);
            if (item == null) continue;
            JSONArray ex = item.optJSONArray("examples");
            if (ex != null && ex.length() > 0) byWord.put(item.optString("word", "").trim().toLowerCase(Locale.US), ex);
        }
        Iterator<String> keys = words.keys();
        while (keys.hasNext()) {
            JSONObject w = words.optJSONObject(keys.next());
            if (w == null) continue;
            JSONArray ex = byWord.get(w.optString("word", "").trim().toLowerCase(Locale.US));
            if (ex != null) {
                try { w.put("examples", ex); } catch (Exception ignored) {}
            }
        }
    }

    private static void bootstrapFromAssets(Context ctx, JSONObject state) {
        try {
            JSONArray list = readAssetWords(ctx);
            if (list == null) return;
            JSONObject wordsObj = state.optJSONObject("words");
            int order = 0;
            for (int i = 0; i < list.length(); i++) {
                JSONObject item = list.optJSONObject(i);
                if (item == null) continue;
                String word = item.optString("word", "").trim();
                if (word.isEmpty()) continue;
                String rawId = item.optString("id", word).replaceAll("\\W", "");
                if (rawId.length() > 40) rawId = rawId.substring(0, 40);
                String id = "w" + rawId + "_" + order;
                JSONObject w = new JSONObject();
                w.put("id", id);
                w.put("word", word);
                w.put("pron", item.optString("pron", ""));
                w.put("part", item.optString("part", ""));
                w.put("meaning", item.optString("meaning", ""));
                JSONArray ex = item.optJSONArray("examples");
                if (ex != null) w.put("examples", ex);
                w.put("order", order++);
                wordsObj.put(id, w);
            }
        } catch (Exception ignored) {}
    }

    private static JSONObject getDayRec(JSONObject state, String dateIso) {
        JSONObject days = state.optJSONObject("days");
        JSONObject d = days.optJSONObject(dateIso);
        if (d == null) {
            d = new JSONObject();
            try {
                d.put("newIds", new JSONArray());
                d.put("learned", new JSONArray());
                d.put("reviewed", new JSONArray());
                d.put("done", false);
                days.put(dateIso, d);
            } catch (Exception ignored) {}
        }
        return d;
    }

    private static boolean jsonArrayContains(JSONArray arr, String val) {
        if (arr == null) return false;
        for (int i = 0; i < arr.length(); i++) {
            if (val.equals(arr.optString(i))) return true;
        }
        return false;
    }

    private static List<String> ensureTodaysNew(JSONObject state, String today) {
        JSONObject d = getDayRec(state, today);
        JSONArray newIds = d.optJSONArray("newIds");
        if (newIds == null) {
            newIds = new JSONArray();
            try { d.put("newIds", newIds); } catch (Exception ignored) {}
        }
        int daily = state.optJSONObject("settings").optInt("daily", 20);
        int need = daily - newIds.length();
        JSONObject words = state.optJSONObject("words");
        JSONObject cards = state.optJSONObject("cards");

        if (need > 0 && words != null) {
            List<JSONObject> fresh = new ArrayList<>();
            Iterator<String> keys = words.keys();
            while (keys.hasNext()) {
                String id = keys.next();
                if (cards != null && cards.has(id)) continue;
                if (jsonArrayContains(newIds, id)) continue;
                JSONObject w = words.optJSONObject(id);
                if (w != null) fresh.add(w);
            }
            Collections.sort(fresh, new Comparator<JSONObject>() {
                @Override
                public int compare(JSONObject a, JSONObject b) {
                    return Integer.compare(a.optInt("order", 0), b.optInt("order", 0));
                }
            });
            for (int i = 0; i < Math.min(need, fresh.size()); i++) {
                newIds.put(fresh.get(i).optString("id"));
            }
        }
        List<String> out = new ArrayList<>();
        for (int i = 0; i < newIds.length(); i++) {
            String id = newIds.optString(i);
            if (words != null && words.has(id)) out.add(id);
        }
        return out;
    }

    private static List<String> getDueReviewIds(JSONObject state, String today) {
        JSONObject d = getDayRec(state, today);
        JSONArray learned = d.optJSONArray("learned");
        JSONArray reviewed = d.optJSONArray("reviewed");
        JSONObject cards = state.optJSONObject("cards");
        JSONObject words = state.optJSONObject("words");
        List<String> due = new ArrayList<>();
        if (cards == null || words == null) return due;

        Iterator<String> keys = cards.keys();
        while (keys.hasNext()) {
            String id = keys.next();
            if (!words.has(id)) continue;
            JSONObject c = cards.optJSONObject(id);
            if (c == null) continue;
            String dueIso = c.optString("due", "9999-99-99");
            if (dueIso.compareTo(today) <= 0) {
                due.add(id);
            }
        }
        final long now = System.currentTimeMillis();
        Collections.sort(due, new Comparator<String>() {
            @Override
            public int compare(String a, String b) {
                JSONObject ca = cards.optJSONObject(a);
                JSONObject cb = cards.optJSONObject(b);
                long la = ca != null ? ca.optLong("last", 0) : 0;
                long lb = cb != null ? cb.optLong("last", 0) : 0;
                return Long.compare(la, lb);
            }
        });
        return due;
    }

    private static double getCardRetrievability(JSONObject c, long now) {
        if (c == null) return 1.0;
        double s = Math.max(0.1, c.optDouble("S", 1.0));
        long last = c.optLong("last", now);
        double t = Math.max(0.0, (now - last) / (double) DAY_MS);
        return retrievability(t, s);
    }

    private static boolean updateDayDone(JSONObject state, String today) {
        JSONObject d = getDayRec(state, today);
        JSONArray newIds = d.optJSONArray("newIds");
        JSONArray learned = d.optJSONArray("learned");
        JSONArray reviewed = d.optJSONArray("reviewed");
        int newLeft = 0;
        if (newIds != null) {
            for (int i = 0; i < newIds.length(); i++) {
                if (!jsonArrayContains(learned, newIds.optString(i))) newLeft++;
            }
        }
        int dueLeft = getDueReviewIds(state, today).size();
        int totalDone = (learned != null ? learned.length() : 0) + (reviewed != null ? reviewed.length() : 0);
        boolean done = (newLeft == 0 && dueLeft == 0 && totalDone > 0);
        try { d.put("done", done); } catch (Exception ignored) {}
        return done;
    }

    private static int calcStreak(JSONObject state, String today) {
        JSONObject days = state.optJSONObject("days");
        if (days == null) return 0;
        int n = 0;
        String date = today;
        JSONObject d0 = days.optJSONObject(date);
        if (d0 == null || !d0.optBoolean("done", false)) {
            date = addDaysIso(date, -1);
        }
        while (true) {
            JSONObject rec = days.optJSONObject(date);
            if (rec != null && rec.optBoolean("done", false)) {
                n++;
                date = addDaysIso(date, -1);
            } else {
                break;
            }
        }
        return n;
    }

    /** 위젯 순서: 밀린 복습 → 오늘의 새 단어 → 오늘 '몰라요'로 넘긴 단어 */
    private static List<String> buildQueue(List<String> dueIds, List<String> unlearnedNew, JSONObject cards) {
        long dayStart;
        try {
            dayStart = new SimpleDateFormat("yyyy-MM-dd", Locale.US).parse(todayIso()).getTime();
        } catch (Exception e) {
            dayStart = System.currentTimeMillis() - DAY_MS;
        }
        List<String> oldDue = new ArrayList<>();
        List<String> failedToday = new ArrayList<>();
        for (String id : dueIds) {
            JSONObject c = cards != null ? cards.optJSONObject(id) : null;
            long last = c != null ? c.optLong("last", 0) : 0;
            if (last >= dayStart) failedToday.add(id); else oldDue.add(id);
        }
        List<String> q = new ArrayList<>(oldDue);
        q.addAll(unlearnedNew);
        q.addAll(failedToday);
        return q;
    }

    public static synchronized WidgetData getWidgetData(Context ctx) {
        JSONObject state = loadState(ctx);
        String today = todayIso();
        List<String> todaysNew = ensureTodaysNew(state, today);
        List<String> dueIds = getDueReviewIds(state, today);
        boolean done = updateDayDone(state, today);
        saveStateInternal(ctx, state);

        JSONObject d = getDayRec(state, today);
        JSONArray learned = d.optJSONArray("learned");
        List<String> unlearnedNew = new ArrayList<>();
        for (String id : todaysNew) {
            if (!jsonArrayContains(learned, id)) unlearnedNew.add(id);
        }

        SharedPreferences sp = prefs(ctx);
        String curId = sp.getString(KEY_CUR_ID, "");
        boolean revealed = sp.getBoolean(KEY_REVEALED, false);

        JSONObject words = state.optJSONObject("words");
        JSONObject cards = state.optJSONObject("cards");
        List<String> queue = buildQueue(dueIds, unlearnedNew, cards);

        String kind = "new";
        if (queue.isEmpty()) {
            // Goal done or all queues empty: fallback to learned cards sorted by lowest R, or all words
            if (words != null) {
                Iterator<String> keys = words.keys();
                while (keys.hasNext()) queue.add(keys.next());
            }
            kind = "extra";
        }

        if (!queue.contains(curId) && !queue.isEmpty()) {
            curId = queue.get(0);
            revealed = false;
            sp.edit().putString(KEY_CUR_ID, curId).putBoolean(KEY_REVEALED, false).apply();
        }
        if (dueIds.contains(curId)) {
            kind = "review";
        } else if (unlearnedNew.contains(curId)) {
            kind = "new";
        } else {
            kind = "extra";
        }

        WidgetData wd = new WidgetData();
        wd.id = curId;
        wd.kind = kind;
        wd.revealed = revealed;
        wd.newDone = learned != null ? learned.length() : 0;
        wd.newTotal = todaysNew.size();
        wd.dueLeft = dueIds.size();
        wd.todayDone = done;
        wd.streak = calcStreak(state, today);
        wd.lastFeedback = sp.getString(KEY_LAST_TOAST, "");
        JSONObject settings = state.optJSONObject("settings");
        if (settings != null) {
            wd.speechRate = (float) settings.optDouble("rate", 0.95);
        }

        if (words != null && words.has(curId)) {
            JSONObject w = words.optJSONObject(curId);
            if (w != null) {
                wd.word = w.optString("word", "");
                wd.pron = w.optString("pron", "");
                wd.meaning = w.optString("meaning", "");
                JSONArray exs = w.optJSONArray("examples");
                JSONObject ex0 = exs != null ? exs.optJSONObject(0) : null;
                if (ex0 != null) {
                    wd.example = ex0.optString("en", "");
                    wd.exampleKo = ex0.optString("ko", "");
                }
            }
        }
        if (cards != null && cards.has(curId)) {
            JSONObject c = cards.optJSONObject(curId);
            if (c != null) {
                wd.stability = c.optDouble("S", 0);
                wd.retrievabilityPct = (int) Math.round(getCardRetrievability(c, System.currentTimeMillis()) * 100.0);
            }
        }
        return wd;
    }

    public static synchronized void setRevealed(Context ctx, boolean revealed) {
        prefs(ctx).edit().putBoolean(KEY_REVEALED, revealed).putString(KEY_LAST_TOAST, "").apply();
    }

    public static synchronized void stepWord(Context ctx, int delta) {
        JSONObject state = loadState(ctx);
        String today = todayIso();
        List<String> todaysNew = ensureTodaysNew(state, today);
        List<String> dueIds = getDueReviewIds(state, today);
        JSONObject d = getDayRec(state, today);
        JSONArray learned = d.optJSONArray("learned");

        List<String> unlearnedNew = new ArrayList<>();
        for (String id : todaysNew) {
            if (!jsonArrayContains(learned, id)) unlearnedNew.add(id);
        }
        List<String> queue = buildQueue(dueIds, unlearnedNew, state.optJSONObject("cards"));
        if (queue.isEmpty()) {
            JSONObject words = state.optJSONObject("words");
            if (words != null) {
                Iterator<String> keys = words.keys();
                while (keys.hasNext()) queue.add(keys.next());
            }
        }
        if (queue.isEmpty()) return;

        SharedPreferences sp = prefs(ctx);
        String cur = sp.getString(KEY_CUR_ID, "");
        int idx = queue.indexOf(cur);
        int nextIdx = (idx < 0) ? 0 : (idx + delta + queue.size()) % queue.size();
        sp.edit()
            .putString(KEY_CUR_ID, queue.get(nextIdx))
            .putBoolean(KEY_REVEALED, false)
            .putString(KEY_LAST_TOAST, "")
            .apply();
    }

    public static synchronized void markCurrentWord(Context ctx, boolean known) {
        int grade = known ? 3 : 1;
        WidgetData wd = getWidgetData(ctx);
        if (wd.id == null || wd.id.isEmpty()) return;

        JSONObject state = loadState(ctx);
        String today = todayIso();
        JSONObject cards = state.optJSONObject("cards");
        JSONObject prev = cards.optJSONObject(wd.id);
        double retention = state.optJSONObject("settings").optDouble("retention", 0.9);

        JSONObject updated = fsrsReview(prev, grade, System.currentTimeMillis(), retention);
        int interval = known ? updated.optInt("interval", 1) : 0;
        String due = known ? addDaysIso(today, interval) : today;
        try {
            updated.put("due", due);
            updated.put("interval", interval);
            cards.put(wd.id, updated);
        } catch (Exception ignored) {}

        JSONObject d = getDayRec(state, today);
        try {
            if ("new".equals(wd.kind)) {
                JSONArray learned = d.optJSONArray("learned");
                if (!jsonArrayContains(learned, wd.id)) learned.put(wd.id);
            } else {
                JSONArray reviewed = d.optJSONArray("reviewed");
                if (!jsonArrayContains(reviewed, wd.id)) reviewed.put(wd.id);
            }
        } catch (Exception ignored) {}

        boolean done = updateDayDone(state, today);
        saveStateInternal(ctx, state);

        String feedback = !known
            ? "✗ 복습 목록으로"
            : (done ? "🎉 오늘 목표 달성! (" + interval + "일 뒤 복습)" : "✓ " + interval + "일 뒤 복습 예약");

        SharedPreferences sp = prefs(ctx);
        sp.edit()
            .putString(KEY_CUR_ID, "")
            .putBoolean(KEY_REVEALED, false)
            .putString(KEY_LAST_TOAST, feedback)
            .apply();
    }

    // ---------- FSRS-5 Math ----------
    private static double clamp(double x, double a, double b) {
        return Math.min(b, Math.max(a, x));
    }

    public static double retrievability(double tDays, double S) {
        return Math.pow(1.0 + (FACTOR * tDays) / Math.max(0.1, S), DECAY);
    }

    private static int nextInterval(double S, double retention) {
        long iv = Math.round((S / FACTOR) * (Math.pow(retention, 1.0 / DECAY) - 1.0));
        return (int) Math.min(36500L, Math.max(1L, iv));
    }

    private static double initD(int g) {
        return clamp(W[4] - Math.exp(W[5] * (g - 1)) + 1.0, 1.0, 10.0);
    }

    private static double initS(int g) {
        int idx = Math.min(3, Math.max(0, g - 1));
        return Math.max(W[idx], 0.1);
    }

    private static double nextD(double D, int g) {
        double delta = -W[6] * (g - 3);
        double damped = D + (delta * (10.0 - D)) / 9.0;
        return clamp(W[7] * initD(4) + (1.0 - W[7]) * damped, 1.0, 10.0);
    }

    private static double recallS(double D, double S, double R, int g) {
        double hard = (g == 2) ? W[15] : 1.0;
        double easy = (g == 4) ? W[16] : 1.0;
        return S * (Math.exp(W[8]) * (11.0 - D) * Math.pow(S, -W[9]) * (Math.exp(W[10] * (1.0 - R)) - 1.0) * hard * easy + 1.0);
    }

    private static double forgetS(double D, double S, double R) {
        return Math.min(S, W[11] * Math.pow(D, -W[12]) * (Math.pow(S + 1.0, W[13]) - 1.0) * Math.exp(W[14] * (1.0 - R)));
    }

    private static JSONObject fsrsReview(JSONObject prev, int g, long now, double retention) {
        JSONObject c = new JSONObject();
        int reps = (prev != null) ? prev.optInt("reps", 0) : 0;
        int lapses = (prev != null) ? prev.optInt("lapses", 0) : 0;
        double D, S;

        if (reps == 0 || prev == null) {
            D = initD(g);
            S = initS(g);
        } else {
            double prevD = prev.optDouble("D", 5.0);
            double prevS = Math.max(0.1, prev.optDouble("S", 1.0));
            long last = prev.optLong("last", now);
            double t = Math.max(0.0, (now - last) / (double) DAY_MS);
            double R = retrievability(t, prevS);
            D = nextD(prevD, g);
            if (g == 1) {
                S = forgetS(prevD, prevS, R);
                lapses++;
            } else {
                S = recallS(prevD, prevS, R, g);
            }
        }
        reps++;
        int interval = (g == 1) ? 1 : nextInterval(S, retention);
        try {
            c.put("D", D);
            c.put("S", S);
            c.put("reps", reps);
            c.put("lapses", lapses);
            c.put("last", now);
            c.put("interval", interval);
        } catch (Exception ignored) {}
        return c;
    }
}
