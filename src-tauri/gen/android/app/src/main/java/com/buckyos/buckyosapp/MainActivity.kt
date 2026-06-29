package com.buckyos.buckyosapp

import android.content.pm.ActivityInfo
import android.content.res.Configuration
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updatePadding

class MainActivity : TauriActivity() {
  private var latestInsetsScript: String? = null
  private var pendingInsetsApply: Runnable? = null
  private var pendingInsetsReplayApply: Runnable? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    applySystemBarsTheme(isSystemLightTheme())

    super.onCreate(savedInstanceState)
    lockPortraitOrientation()
  }

  override fun onResume() {
    super.onResume()
    lockPortraitOrientation()
  }

  private fun lockPortraitOrientation() {
    requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)

    webView.addJavascriptInterface(SystemBarsBridge(), "BuckySystemBars")

    ViewCompat.setOnApplyWindowInsetsListener(webView) { view, insets ->
      val systemBars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
      val navigationBars = insets.getInsets(WindowInsetsCompat.Type.navigationBars())
      val tappableElement = insets.getInsets(WindowInsetsCompat.Type.tappableElement())
      val systemGestures = insets.getInsets(WindowInsetsCompat.Type.systemGestures())
      val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
      val density = webView.resources.displayMetrics.density
      val systemInsetTop = systemBars.top / density
      val systemInsetRight = systemBars.right / density
      val systemInsetBottom = systemBars.bottom / density
      val systemInsetLeft = systemBars.left / density
      val keyboardInsetBottom = ime.bottom / density
      val navigationInsetBottom = navigationBars.bottom / density
      val tappableInsetBottom = tappableElement.bottom / density
      val gestureInsetBottom = systemGestures.bottom / density

      view.updatePadding(
        left = 0,
        top = 0,
        right = 0,
        bottom = 0,
      )

      injectAndroidInsets(
        webView,
        systemInsetTop,
        systemInsetRight,
        systemInsetBottom,
        systemInsetLeft,
        keyboardInsetBottom,
        navigationInsetBottom,
        tappableInsetBottom,
        gestureInsetBottom,
      )

      insets
    }

    ViewCompat.requestApplyInsets(webView)
  }

  private fun isSystemLightTheme(): Boolean {
    return (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) != Configuration.UI_MODE_NIGHT_YES
  }

  private fun applySystemBarsTheme(isLightTheme: Boolean) {
    WindowCompat.setDecorFitsSystemWindows(window, false)
    window.statusBarColor = Color.TRANSPARENT
    window.navigationBarColor = Color.TRANSPARENT

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      window.navigationBarDividerColor = Color.TRANSPARENT
    }

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      window.isStatusBarContrastEnforced = false
      window.isNavigationBarContrastEnforced = false
    }

    WindowCompat.getInsetsController(window, window.decorView).apply {
      isAppearanceLightStatusBars = isLightTheme
      isAppearanceLightNavigationBars = isLightTheme
    }
  }

  private inner class SystemBarsBridge {
    @JavascriptInterface
    fun setTheme(theme: String) {
      runOnUiThread {
        applySystemBarsTheme(theme == "light")
      }
    }
  }

  private fun injectAndroidInsets(
    webView: WebView,
    systemInsetTop: Float,
    systemInsetRight: Float,
    systemInsetBottom: Float,
    systemInsetLeft: Float,
    keyboardInsetBottom: Float,
    navigationInsetBottom: Float,
    tappableInsetBottom: Float,
    gestureInsetBottom: Float,
  ) {
    val insetsKey = listOf(
      systemInsetTop,
      systemInsetRight,
      systemInsetBottom,
      systemInsetLeft,
      keyboardInsetBottom,
      navigationInsetBottom,
      tappableInsetBottom,
      gestureInsetBottom,
    ).joinToString("|")

    val script = """
      (() => {
        const insetsKey = "${insetsKey}";
        const systemInsetTop = ${systemInsetTop};
        const systemInsetRight = ${systemInsetRight};
        const systemInsetBottom = ${systemInsetBottom};
        const systemInsetLeft = ${systemInsetLeft};
        const keyboardInsetBottom = ${keyboardInsetBottom};
        const navigationInsetBottom = ${navigationInsetBottom};
        const tappableInsetBottom = ${tappableInsetBottom};
        const gestureInsetBottom = ${gestureInsetBottom};
        const root = document.documentElement;
        if (!root) return;
        if (root.dataset.androidInsetsKey === insetsKey) return;
        root.dataset.androidInsetsKey = insetsKey;
        root.style.setProperty('--android-system-inset-top', `${'$'}{systemInsetTop}px`);
        root.style.setProperty('--android-system-inset-right', `${'$'}{systemInsetRight}px`);
        root.style.setProperty('--android-system-inset-bottom', `${'$'}{systemInsetBottom}px`);
        root.style.setProperty('--android-system-inset-left', `${'$'}{systemInsetLeft}px`);
        root.style.setProperty('--keyboard-inset-bottom', `${'$'}{keyboardInsetBottom}px`);
        root.style.setProperty('--android-navigation-inset-bottom', `${'$'}{navigationInsetBottom}px`);
        root.style.setProperty('--android-tappable-inset-bottom', `${'$'}{tappableInsetBottom}px`);
        root.style.setProperty('--android-system-gesture-inset-bottom', `${'$'}{gestureInsetBottom}px`);
        window.dispatchEvent(new CustomEvent('android-window-insets-change', {
          detail: {
            systemInsetTop,
            systemInsetRight,
            systemInsetBottom,
            systemInsetLeft,
            keyboardInsetBottom,
            navigationInsetBottom,
            tappableInsetBottom,
            gestureInsetBottom
          }
        }));
      })();
    """.trimIndent()

    latestInsetsScript = script
    evaluateLatestInsetsScript(webView)

    pendingInsetsApply?.let { webView.removeCallbacks(it) }
    pendingInsetsApply = Runnable {
      evaluateLatestInsetsScript(webView)
    }
    webView.postDelayed(pendingInsetsApply, 180L)

    pendingInsetsReplayApply?.let { webView.removeCallbacks(it) }
    pendingInsetsReplayApply = Runnable {
      evaluateLatestInsetsScript(webView)
    }
    webView.postDelayed(pendingInsetsReplayApply, 700L)
  }

  private fun evaluateLatestInsetsScript(webView: WebView) {
    latestInsetsScript?.let { script ->
      webView.evaluateJavascript(script, null)
    }
  }
}
