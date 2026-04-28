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

      view.updatePadding(
        left = systemBars.left,
        top = systemBars.top,
        right = systemBars.right,
        bottom = bottomInset,
      )

      insets
    }

    ViewCompat.requestApplyInsets(webView)
  }
}
