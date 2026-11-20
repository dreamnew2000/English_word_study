package com.jyc.memora;

import android.annotation.SuppressLint;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.os.Build;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

import java.lang.ref.WeakReference;

public class MainActivity extends BridgeActivity {
    private static WeakReference<MainActivity> currentInstance;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        currentInstance = new WeakReference<>(this);
        MemoraStore.loadState(this);
        super.onCreate(savedInstanceState);
        MemoraWidgetProvider.updateAllWidgets(this);
    }

    @SuppressLint("JavascriptInterface")
    @Override
    protected void load() {
        // Attach JavascriptInterface BEFORE super.load() calls webView.loadUrl()
        WebView wv = findViewById(com.getcapacitor.android.R.id.webview);
        if (wv != null) {
            wv.addJavascriptInterface(new MemoraJsBridge(), "MemoraNative");
        }
        bridgeBuilder.addWebViewListener(new WebViewListener() {
            @Override
            public void onPageLoaded(WebView webView) {
                dispatchUpdateToWeb();
            }
        });
        super.load();
    }

    @Override
    public void onResume() {
        super.onResume();
        currentInstance = new WeakReference<>(this);
        dispatchUpdateToWeb();
        MemoraWidgetProvider.updateAllWidgets(this);
    }

    public static void notifyWebIfRunning() {
        MainActivity act = currentInstance != null ? currentInstance.get() : null;
        if (act != null) {
            act.dispatchUpdateToWeb();
        }
    }

    private void dispatchUpdateToWeb() {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (getBridge() != null && getBridge().getWebView() != null) {
                    getBridge().getWebView().evaluateJavascript(
                        "window.dispatchEvent(new CustomEvent('memora-native-updated'));",
                        null
                    );
                }
            }
        });
    }

    public class MemoraJsBridge {
        @JavascriptInterface
        public void syncState(String json) {
            MemoraStore.saveStateFromWeb(MainActivity.this, json);
            MemoraWidgetProvider.updateAllWidgets(MainActivity.this);
        }

        @JavascriptInterface
        public String pullState() {
            return MemoraStore.getRawStateJson(MainActivity.this);
        }

        @JavascriptInterface
        public void speak(String text, float rate) {
            MemoraTtsHelper.speak(MainActivity.this, text, rate);
        }

        @JavascriptInterface
        public void stopSpeak() {
            MemoraTtsHelper.stop();
        }

        @JavascriptInterface
        public void refreshWidget() {
            MemoraWidgetProvider.updateAllWidgets(MainActivity.this);
        }

        @JavascriptInterface
        public boolean requestPinWidget() {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                AppWidgetManager mgr = getSystemService(AppWidgetManager.class);
                ComponentName cn = new ComponentName(MainActivity.this, MemoraWidgetProvider.class);
                if (mgr != null && mgr.isRequestPinAppWidgetSupported()) {
                    return mgr.requestPinAppWidget(cn, null, null);
                }
            }
            return false;
        }
    }
}
