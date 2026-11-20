package com.jyc.memora;

import android.content.Context;
import android.speech.tts.TextToSpeech;

import java.util.Locale;

/**
 * Native Android Text-to-Speech helper used by both the Home Screen Widget and the WebView app.
 */
public class MemoraTtsHelper {
    private static TextToSpeech tts;
    private static boolean ready = false;
    private static String pendingText = null;
    private static float pendingRate = 0.95f;

    public static synchronized void stop() {
        pendingText = null;
        if (tts != null && ready) {
            try {
                tts.stop();
            } catch (Exception ignored) {}
        }
    }

    public static synchronized void speak(Context context, final String text, final float rate) {
        if (text == null || text.trim().isEmpty()) return;
        final Context appCtx = context.getApplicationContext();

        if (tts == null) {
            pendingText = text;
            pendingRate = rate > 0 ? rate : 0.95f;
            tts = new TextToSpeech(appCtx, new TextToSpeech.OnInitListener() {
                @Override
                public void onInit(int status) {
                    synchronized (MemoraTtsHelper.class) {
                        if (status == TextToSpeech.SUCCESS && tts != null) {
                            int res = tts.setLanguage(Locale.US);
                            if (res == TextToSpeech.LANG_MISSING_DATA || res == TextToSpeech.LANG_NOT_SUPPORTED) {
                                tts.setLanguage(Locale.ENGLISH);
                            }
                            ready = true;
                            if (pendingText != null) {
                                tts.setSpeechRate(pendingRate);
                                tts.speak(pendingText, TextToSpeech.QUEUE_FLUSH, null, "memora_utt");
                                pendingText = null;
                            }
                        }
                    }
                }
            });
            return;
        }

        if (!ready) {
            pendingText = text;
            pendingRate = rate > 0 ? rate : 0.95f;
            return;
        }

        tts.setSpeechRate(rate > 0 ? rate : 0.95f);
        tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "memora_utt");
    }
}
