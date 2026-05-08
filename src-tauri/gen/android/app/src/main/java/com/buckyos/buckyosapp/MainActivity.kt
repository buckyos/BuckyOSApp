package com.buckyos.buckyosapp

import android.os.Bundle
import android.webkit.WebView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updatePadding

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)

    ViewCompat.setOnApplyWindowInsetsListener(webView) { view, insets ->
      val systemBars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
      val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
      val bottomInset = maxOf(systemBars.bottom, ime.bottom)
      val density = webView.resources.displayMetrics.density
      val keyboardInsetBottom = ime.bottom / density

      view.updatePadding(
        left = systemBars.left,
        top = systemBars.top,
        right = systemBars.right,
        bottom = bottomInset,
      )

      webView.post {
        webView.evaluateJavascript(
          """
          (() => {
            const keyboardInsetBottom = ${keyboardInsetBottom};
            const root = document.documentElement;
            root.style.setProperty('--keyboard-inset-bottom', `${'$'}{keyboardInsetBottom}px`);
            window.dispatchEvent(new CustomEvent('android-window-insets-change', {
              detail: { keyboardInsetBottom }
            }));
          })();
          """.trimIndent(),
          null,
        )
      }

      insets
    }

    ViewCompat.requestApplyInsets(webView)
  }
}
