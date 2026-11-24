package com.buckyos.buckyosapp

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import android.util.Log
import java.io.File
import java.io.RandomAccessFile
import java.security.KeyStore
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Small secrets (Zone credentials and sessions), each in a file encrypted with a key that never
 * leaves the Android Keystore. Both processes of the app use the same files.
 */
object Secrets {
  private const val ALIAS = "buckyosapp.secrets"
  private const val TRANSFORMATION = "AES/GCM/NoPadding"
  private const val VERSION: Byte = 1
  private const val IV_BYTES = 12

  private fun folder(context: Context) = File(context.noBackupFilesDir, "secrets").apply { mkdirs() }

  private fun file(context: Context, key: String): AtomicFile {
    val name = MessageDigest.getInstance("SHA-256").digest(key.toByteArray()).joinToString("") { "%02x".format(it) }
    return AtomicFile(File(folder(context), name))
  }

  private fun existingKey(): SecretKey? =
    KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.getKey(ALIAS, null) as? SecretKey

  private fun key(context: Context): SecretKey {
    existingKey()?.let { return it }
    // Two processes must not each make one: the second would replace the first.
    RandomAccessFile(File(folder(context), ".key-lock"), "rw").use { lockFile ->
      lockFile.channel.lock().use {
        existingKey()?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
          init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
              .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
              .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
              .setKeySize(256)
              .build()
          )
          generateKey()
        }
      }
    }
  }

  fun get(context: Context, key: String): ByteArray? {
    val stored = try {
      file(context, key).readFully()
    } catch (_: java.io.FileNotFoundException) {
      return null
    }
    if (stored.size <= 1 + IV_BYTES || stored[0] != VERSION) return null
    return try {
      val cipher = Cipher.getInstance(TRANSFORMATION)
      cipher.init(Cipher.DECRYPT_MODE, key(context), GCMParameterSpec(128, stored, 1, IV_BYTES))
      cipher.updateAAD(key.toByteArray())
      cipher.doFinal(stored, 1 + IV_BYTES, stored.size - 1 - IV_BYTES)
    } catch (error: Exception) {
      // The key is gone (data restored on another device, lock screen reset on some devices).
      Log.w("BuckyOS", "a stored secret cannot be read: $error")
      null
    }
  }

  fun set(context: Context, key: String, value: ByteArray) {
    val cipher = Cipher.getInstance(TRANSFORMATION)
    cipher.init(Cipher.ENCRYPT_MODE, key(context))
    cipher.updateAAD(key.toByteArray())
    val sealed = byteArrayOf(VERSION) + cipher.iv + cipher.doFinal(value)
    val file = file(context, key)
    val out = file.startWrite()
    try {
      out.write(sealed)
      file.finishWrite(out)
    } catch (error: Exception) {
      file.failWrite(out)
      throw error
    }
  }

  /** A random text only this app knows, made when it is first asked for. */
  fun token(context: Context, key: String): String {
    get(context, key)?.let { return String(it) }
    RandomAccessFile(File(folder(context), ".lock"), "rw").use { lockFile ->
      lockFile.channel.lock().use {
        get(context, key)?.let { return String(it) }
        val made = ByteArray(24).also { java.security.SecureRandom().nextBytes(it) }.joinToString("") { "%02x".format(it) }
        set(context, key, made.toByteArray())
        return made
      }
    }
  }

  fun delete(context: Context, key: String) = file(context, key).delete()
}
