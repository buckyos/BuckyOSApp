package com.buckyos.buckyosapp.content

import android.text.InputType
import android.text.method.PasswordTransformationMethod
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import com.buckyos.buckyosapp.Labels
import com.buckyos.buckyosapp.R
import com.google.android.material.dialog.MaterialAlertDialogBuilder

/** Questions a page must not be able to draw, read or answer by itself. */
object Dialogs {
  fun askMicrophone(activity: AppCompatActivity, app: String, done: (Boolean) -> Unit) {
    val labels = Labels.load(activity)
    var answered = false
    val answer = { allowed: Boolean ->
      if (!answered) {
        answered = true
        done(allowed)
      }
    }
    MaterialAlertDialogBuilder(activity)
      .setMessage(labels.micAsk.replace("{app}", app))
      .setPositiveButton(labels.allow) { _, _ -> answer(true) }
      .setNegativeButton(labels.deny) { _, _ -> answer(false) }
      .setOnDismissListener { answer(false) }
      .show()
  }

  /**
   * The wallet password for a signature a page asked for. It stays open while a password is tried:
   * `wrong` puts it back to the user, `close` ends it.
   */
  class SignPrompt(activity: AppCompatActivity, message: String, content: String, private val answer: (String?) -> Unit) {
    private val labels = Labels.load(activity)
    private val density = activity.resources.displayMetrics.density
    private val password = EditText(activity)
    private val error = TextView(activity)
    private val dialog: AlertDialog
    private var done = false

    init {
      val pad = (20 * density).toInt()
      val body = LinearLayout(activity).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(pad + pad / 5, 0, pad + pad / 5, 0)
      }
      val text = TextView(activity).apply {
        setText(content)
        typeface = android.graphics.Typeface.MONOSPACE
        textSize = 12f
        setTextIsSelectable(true)
      }
      val scroll = object : ScrollView(activity) {
        override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
          val max = View.MeasureSpec.makeMeasureSpec((200 * density).toInt(), View.MeasureSpec.AT_MOST)
          super.onMeasure(widthMeasureSpec, max)
        }
      }
      scroll.addView(text)
      text.setPadding(0, pad / 4, 0, pad / 4)
      body.addView(scroll, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
      password.apply {
        hint = labels.signPassword
        inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
        transformationMethod = PasswordTransformationMethod.getInstance()
        typeface = android.graphics.Typeface.DEFAULT
        imeOptions = EditorInfo.IME_ACTION_DONE or EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING
        isSaveEnabled = false
        setOnEditorActionListener { _, _, _ ->
          submit()
          true
        }
      }
      body.addView(password)
      error.setTextColor(activity.getColor(R.color.danger))
      error.visibility = View.GONE
      body.addView(error)
      dialog = MaterialAlertDialogBuilder(activity)
        .setTitle(labels.signTitle)
        .setMessage(message)
        .setView(body)
        .setPositiveButton(labels.confirm, null)
        .setNegativeButton(labels.cancel) { _, _ -> finish(null) }
        .setOnCancelListener { finish(null) }
        .create()
      dialog.setCanceledOnTouchOutside(false)
      dialog.window?.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE or WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
      dialog.show()
      dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener { submit() }
      password.requestFocus()
    }

    private fun enable(enabled: Boolean) {
      password.isEnabled = enabled
      dialog.getButton(AlertDialog.BUTTON_POSITIVE)?.isEnabled = enabled
    }

    private fun submit() {
      val value = password.text.toString()
      if (value.isEmpty() || done) return
      enable(false)
      error.visibility = View.GONE
      answer(value)
    }

    private fun finish(value: String?) {
      if (done) return
      done = true
      answer(value)
    }

    fun wrong() {
      error.text = labels.signWrong
      error.visibility = View.VISIBLE
      password.text.clear()
      enable(true)
      password.requestFocus()
      dialog.window?.let { WindowCompat.getInsetsController(it, password).show(WindowInsetsCompat.Type.ime()) }
    }

    fun close() {
      done = true
      password.text.clear()
      dialog.dismiss()
    }
  }
}
