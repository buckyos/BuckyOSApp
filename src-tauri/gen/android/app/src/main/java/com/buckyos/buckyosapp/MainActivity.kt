package com.buckyos.buckyosapp

import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.webkit.WebView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updatePadding

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    WindowCompat.setDecorFitsSystemWindows(window, false)
    window.statusBarColor = Color.TRANSPARENT
    window.navigationBarColor = Color.TRANSPARENT

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      window.isStatusBarContrastEnforced = false
      window.isNavigationBarContrastEnforced = false
    }

    WindowCompat.getInsetsController(window, window.decorView).apply {
      isAppearanceLightStatusBars = false
      isAppearanceLightNavigationBars = false
    }

    super.onCreate(savedInstanceState)
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)

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
    val script = """
      (() => {
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

    listOf(0L, 100L, 500L, 1500L, 3000L, 5000L).forEach { delay ->
      webView.postDelayed({
        webView.evaluateJavascript(script, null)
      }, delay)
    }
  }
}
