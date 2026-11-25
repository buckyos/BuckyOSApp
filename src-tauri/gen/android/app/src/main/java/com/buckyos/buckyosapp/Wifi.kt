package com.buckyos.buckyosapp

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest

/**
 * Which network is the Wi-Fi. Where it has no internet the system's default is another one, and
 * connections to devices in the home have to say that they mean this one (`route/net.rs`).
 */
class Wifi(context: Context, private val changed: () -> Unit) {
  private val connectivity = context.getSystemService(ConnectivityManager::class.java)
  private var current: Network? = null
  private val callback = object : ConnectivityManager.NetworkCallback() {
    override fun onAvailable(network: Network) = use(network)

    override fun onLost(network: Network) {
      if (network == current) use(null)
    }
  }

  private fun use(network: Network?) {
    current = network
    if (NativeBridge.wifiNetwork(network?.networkHandle ?: 0)) changed()
  }

  fun watch() {
    val request = NetworkRequest.Builder()
      .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
      .removeCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
      .build()
    connectivity.registerNetworkCallback(request, callback)
  }

  fun stop() = connectivity.unregisterNetworkCallback(callback)
}
