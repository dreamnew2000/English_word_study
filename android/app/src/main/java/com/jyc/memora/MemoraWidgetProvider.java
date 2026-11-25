package com.jyc.memora;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.view.View;
import android.widget.RemoteViews;

/**
 * Home Screen Widget for Memora Vocabulary App.
 * Top bar: << 이전 | 새단어 0/20 | 다음 >>
 * Word row: word + pron on left, 🔊 sound button right-aligned.
 * Bottom area: Active Recall (tap to reveal meaning & example), 2-button marking (✗ 몰라요 / ✓ 외웠어요).
 */
public class MemoraWidgetProvider extends AppWidgetProvider {
    public static final String ACTION_REVEAL = "com.jyc.memora.widget.ACTION_REVEAL";
    public static final String ACTION_HIDE = "com.jyc.memora.widget.ACTION_HIDE";
    public static final String ACTION_PREV = "com.jyc.memora.widget.ACTION_PREV";
    public static final String ACTION_NEXT = "com.jyc.memora.widget.ACTION_NEXT";
    public static final String ACTION_TTS = "com.jyc.memora.widget.ACTION_TTS";
    public static final String ACTION_TTS_EXAMPLE = "com.jyc.memora.widget.ACTION_TTS_EXAMPLE";
    public static final String ACTION_MARK_NO = "com.jyc.memora.widget.ACTION_MARK_NO";
    public static final String ACTION_MARK_YES = "com.jyc.memora.widget.ACTION_MARK_YES";

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        updateAllWidgets(context);
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        if (intent == null || intent.getAction() == null) return;
        String action = intent.getAction();

        switch (action) {
            case ACTION_REVEAL:
                MemoraStore.setRevealed(context, true);
                updateAllWidgets(context);
                break;
            case ACTION_HIDE:
                MemoraStore.setRevealed(context, false);
                updateAllWidgets(context);
                break;
            case ACTION_PREV:
                MemoraStore.stepWord(context, -1);
                updateAllWidgets(context);
                break;
            case ACTION_NEXT:
                MemoraStore.stepWord(context, 1);
                updateAllWidgets(context);
                break;
            case ACTION_TTS: {
                MemoraStore.WidgetData wd = MemoraStore.getWidgetData(context);
                MemoraTtsHelper.speak(context, wd.word, wd.speechRate);
                break;
            }
            case ACTION_TTS_EXAMPLE: {
                MemoraStore.WidgetData wd = MemoraStore.getWidgetData(context);
                MemoraTtsHelper.speak(context, wd.example, wd.speechRate);
                break;
            }
            case ACTION_MARK_NO:
                handleMark(context, false);
                break;
            case ACTION_MARK_YES:
                handleMark(context, true);
                break;
        }
    }

    private void handleMark(Context context, boolean known) {
        MemoraStore.markCurrentWord(context, known);
        updateAllWidgets(context);
        MainActivity.notifyWebIfRunning();
    }

    public static void updateAllWidgets(Context context) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(context);
        ComponentName cn = new ComponentName(context, MemoraWidgetProvider.class);
        int[] ids = mgr.getAppWidgetIds(cn);
        if (ids == null || ids.length == 0) return;

        MemoraStore.WidgetData wd = MemoraStore.getWidgetData(context);
        for (int widgetId : ids) {
            RemoteViews rv = buildRemoteViews(context, wd);
            mgr.updateAppWidget(widgetId, rv);
        }
    }

    private static PendingIntent broadcastPi(Context ctx, String action, int reqCode) {
        Intent i = new Intent(ctx, MemoraWidgetProvider.class);
        i.setAction(action);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        return PendingIntent.getBroadcast(ctx, reqCode, i, flags);
    }

    private static PendingIntent openAppPi(Context ctx) {
        Intent i = new Intent(ctx, MainActivity.class);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        return PendingIntent.getActivity(ctx, 100, i, flags);
    }

    private static RemoteViews buildRemoteViews(Context ctx, MemoraStore.WidgetData wd) {
        RemoteViews rv = new RemoteViews(ctx.getPackageName(), R.layout.memora_widget);

        // 1. 맨윗줄: 오늘 날짜 | 새단어 10 · 복습 5
        rv.setTextViewText(R.id.widget_top_date, MemoraStore.getTodayFormatted());
        int newRem = Math.max(0, wd.newTotal - wd.newDone);
        String statsText = wd.todayDone ? "🎉 완료" : ("새단어 " + newRem + " · 복습 " + wd.dueLeft);
        rv.setTextViewText(R.id.widget_top_stats, statsText);
        rv.setOnClickPendingIntent(R.id.widget_top_date, openAppPi(ctx));
        rv.setOnClickPendingIntent(R.id.widget_top_stats, openAppPi(ctx));

        // 2. 단어 및 발음기호
        rv.setTextViewText(R.id.widget_word, wd.word.isEmpty() ? "Memora" : wd.word);
        String pronText = (wd.pron == null || wd.pron.isEmpty()) ? "" : wd.pron;
        rv.setTextViewText(R.id.widget_pron, pronText);

        // 3. 뜻 및 예문
        rv.setTextViewText(R.id.widget_meaning, wd.meaning.isEmpty() ? "(뜻 정보 없음)" : wd.meaning);
        if (wd.example != null && !wd.example.isEmpty()) {
            String ex = "“" + wd.example + "”" + (wd.exampleKo.isEmpty() ? "" : "\n" + wd.exampleKo);
            rv.setTextViewText(R.id.widget_example, ex);
            rv.setViewVisibility(R.id.widget_example, View.VISIBLE);
        } else {
            rv.setViewVisibility(R.id.widget_example, View.GONE);
        }

        if (wd.revealed) {
            rv.setViewVisibility(R.id.widget_reveal_prompt, View.GONE);
            rv.setViewVisibility(R.id.widget_revealed_box, View.VISIBLE);
        } else {
            rv.setViewVisibility(R.id.widget_reveal_prompt, View.VISIBLE);
            rv.setViewVisibility(R.id.widget_revealed_box, View.GONE);
        }

        // 4. 맨 아랫줄: << 이전 | 새단어 1/10 (or 복습 2/5) | 다음 >>
        String badge;
        if (wd.todayDone) {
            badge = "🎉 오늘 목표 달성 (" + wd.newDone + "/" + wd.newTotal + ")";
        } else if ("review".equals(wd.kind)) {
            badge = "복습 " + wd.curIndex + "/" + wd.curTotal;
        } else {
            badge = "새단어 " + wd.curIndex + "/" + wd.curTotal;
        }
        rv.setTextViewText(R.id.widget_badge, badge);

        rv.setOnClickPendingIntent(R.id.widget_btn_prev, broadcastPi(ctx, ACTION_PREV, 2));
        rv.setOnClickPendingIntent(R.id.widget_badge, openAppPi(ctx));
        rv.setOnClickPendingIntent(R.id.widget_btn_next, broadcastPi(ctx, ACTION_NEXT, 3));

        // 단어 발음 TTS
        rv.setOnClickPendingIntent(R.id.widget_btn_tts, broadcastPi(ctx, ACTION_TTS, 1));
        rv.setOnClickPendingIntent(R.id.widget_word, openAppPi(ctx));
        rv.setOnClickPendingIntent(R.id.widget_pron, openAppPi(ctx));

        // 정답 확인 및 숨기기, 예문 TTS
        rv.setOnClickPendingIntent(R.id.widget_reveal_prompt, broadcastPi(ctx, ACTION_REVEAL, 4));
        rv.setOnClickPendingIntent(R.id.widget_meaning, broadcastPi(ctx, ACTION_HIDE, 5));
        rv.setOnClickPendingIntent(R.id.widget_example, broadcastPi(ctx, ACTION_TTS_EXAMPLE, 6));

        // 몰라요 / 외웠어요
        rv.setOnClickPendingIntent(R.id.widget_mark_no, broadcastPi(ctx, ACTION_MARK_NO, 11));
        rv.setOnClickPendingIntent(R.id.widget_mark_yes, broadcastPi(ctx, ACTION_MARK_YES, 12));

        return rv;
    }
}
