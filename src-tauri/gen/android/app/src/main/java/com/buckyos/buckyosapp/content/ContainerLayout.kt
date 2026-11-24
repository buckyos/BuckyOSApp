package com.buckyos.buckyosapp.content

import android.content.Context
import android.graphics.Rect
import android.view.MotionEvent
import android.view.View
import android.view.WindowInsets
import android.widget.FrameLayout

/**
 * The local pages (the main WebView), transparent where a content view shows through. Gestures
 * that begin there are left to the content view below.
 */
class MainHost(context: Context) : FrameLayout(context) {
  var pass: Rect? = null
  var blocks: List<Rect> = emptyList()
  var modal = false

  private fun passes(event: MotionEvent): Boolean {
    if (modal) return false
    val x = event.x.toInt()
    val y = event.y.toInt()
    return pass?.contains(x, y) == true && blocks.none { it.contains(x, y) }
  }

  override fun dispatchTouchEvent(event: MotionEvent): Boolean =
    if (event.actionMasked == MotionEvent.ACTION_DOWN && passes(event)) false else super.dispatchTouchEvent(event)

  override fun dispatchGenericMotionEvent(event: MotionEvent): Boolean =
    if (passes(event)) false else super.dispatchGenericMotionEvent(event)

  // Also how a screen reader explores by touch.
  override fun dispatchHoverEvent(event: MotionEvent): Boolean =
    if (passes(event)) false else super.dispatchHoverEvent(event)
}

/** Content views below, the local pages above. */
class ContainerLayout(context: Context, val mainView: View) : FrameLayout(context) {
  val contentHost = FrameLayout(context)
  val mainHost = MainHost(context)
  val fullscreenHost = FrameLayout(context)

  init {
    isMotionEventSplittingEnabled = false
    val fill = { LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT) }
    addView(contentHost, fill())
    mainHost.addView(mainView, fill())
    addView(mainHost, fill())
    fullscreenHost.visibility = View.GONE
    addView(fullscreenHost, fill())
  }

  // Every child gets the window's own insets: before API 30 one child that consumes them would
  // keep them from the next.
  override fun dispatchApplyWindowInsets(insets: WindowInsets): WindowInsets {
    for (index in 0 until childCount) getChildAt(index).dispatchApplyWindowInsets(WindowInsets(insets))
    return insets
  }
}
