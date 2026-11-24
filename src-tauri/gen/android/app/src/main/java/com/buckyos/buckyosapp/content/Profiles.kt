package com.buckyos.buckyosapp.content

import android.content.Context
import android.util.Log
import android.webkit.CookieManager
import android.webkit.WebStorage
import android.webkit.WebView
import androidx.webkit.ProfileStore
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature

/**
 * One WebView profile per Zone: its own cookies and storage, and its own renderer process, so that
 * a page that hangs or crashes does not take the local pages with it. A WebView without profiles
 * keeps everything in the default one.
 */
object Profiles {
  private const val PREFERENCES = "content-profiles"
  private const val DOOMED = "doomed"

  val supported: Boolean get() = WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE)

  private val used = HashSet<String>()

  private fun preferences(context: Context) = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

  /** Profiles left to delete: one that was used in a run can only be deleted before its next use. */
  fun cleanUp(context: Context) {
    if (!supported) return
    val doomed = preferences(context).getStringSet(DOOMED, emptySet()).orEmpty()
    if (doomed.isEmpty()) return
    val left = doomed.filterTo(HashSet()) { name ->
      try {
        ProfileStore.getInstance().deleteProfile(name)
        false
      } catch (error: Exception) {
        Log.w("BuckyOS", "a profile could not be deleted: $error")
        true
      }
    }
    preferences(context).edit().putStringSet(DOOMED, left).apply()
  }

  fun use(webView: WebView, profile: String) {
    if (!supported) return
    ProfileStore.getInstance().getOrCreateProfile(profile)
    WebViewCompat.setProfile(webView, profile)
    used += profile
    val doomed = preferences(webView.context).getStringSet(DOOMED, emptySet()).orEmpty()
    if (profile in doomed) preferences(webView.context).edit().putStringSet(DOOMED, doomed - profile).apply()
  }

  fun cookies(profile: String): CookieManager {
    if (!supported) return CookieManager.getInstance()
    used += profile
    return ProfileStore.getInstance().getOrCreateProfile(profile).cookieManager
  }

  fun flush() {
    try {
      CookieManager.getInstance().flush()
      if (!supported) return
      for (name in used) ProfileStore.getInstance().getProfile(name)?.cookieManager?.flush()
    } catch (error: Exception) {
      Log.w("BuckyOS", "cookies were not saved: $error")
    }
  }

  /** Signs a Zone out: everything its pages stored goes. */
  fun clear(context: Context, profile: String, origins: List<String>, done: () -> Unit) {
    if (!supported) {
      val cookies = CookieManager.getInstance()
      for (origin in origins) {
        for (pair in cookies.getCookie(origin).orEmpty().split(";")) {
          val name = pair.substringBefore('=').trim()
          if (name.isNotEmpty()) cookies.setCookie(origin, "$name=; Path=/; Max-Age=0")
        }
        WebStorage.getInstance().deleteOrigin(origin)
      }
      cookies.flush()
      done()
      return
    }
    val found = ProfileStore.getInstance().getOrCreateProfile(profile)
    found.webStorage.deleteAllData()
    found.geolocationPermissions.clearAll()
    found.cookieManager.removeAllCookies {
      found.cookieManager.flush()
      done()
    }
    val doomed = preferences(context).getStringSet(DOOMED, emptySet()).orEmpty()
    preferences(context).edit().putStringSet(DOOMED, doomed + profile).apply()
  }
}
