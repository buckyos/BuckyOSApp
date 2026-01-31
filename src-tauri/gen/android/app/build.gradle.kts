import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

android {
    compileSdk = 36
    namespace = "com.buckyos.buckyosapp"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = "com.buckyos.buckyosapp"
        minSdk = 24
        targetSdk = 36
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
    }
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            isMinifyEnabled = true
            proguardFiles(
                *fileTree(".") { include("**/*.pro") }
                    .plus(getDefaultProguardFile("proguard-android-optimize.txt"))
                    .toList().toTypedArray()
            )
        }
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
    buildFeatures {
        buildConfig = true
    }
}

rust {
    rootDirRel = "../../../"
}

val hostTag = run {
    val osName = System.getProperty("os.name").lowercase()
    when {
        osName.contains("windows") -> "windows-x86_64"
        osName.contains("mac") -> "darwin-x86_64"
        osName.contains("linux") -> "linux-x86_64"
        else -> "linux-x86_64"
    }
}

tasks.register("copyCxxShared") {
    doLast {
        val ndkDir = try {
            android.ndkDirectory
        } catch (ex: Exception) {
            val envNdk = System.getenv("ANDROID_NDK_HOME")?.let { File(it) }
            if (envNdk != null && envNdk.exists()) {
                envNdk
            } else {
                throw GradleException("NDK is not installed. Please install NDK via Android Studio and set ANDROID_NDK_HOME.", ex)
            }
        }
        val toolchainRoot = File(ndkDir, "toolchains/llvm/prebuilt/$hostTag/sysroot/usr/lib")
        val mappings = listOf(
            "armeabi-v7a" to "arm-linux-androideabi",
            "arm64-v8a" to "aarch64-linux-android",
            "x86" to "i686-linux-android",
            "x86_64" to "x86_64-linux-android"
        )
        mappings.forEach { (abi, triple) ->
            val source = File(toolchainRoot, "$triple/libc++_shared.so")
            if (!source.exists()) return@forEach
            val destDir = File(projectDir, "src/main/jniLibs/$abi")
            destDir.mkdirs()
            source.copyTo(File(destDir, "libc++_shared.so"), overwrite = true)
        }
    }
}

tasks.named("preBuild") {
    dependsOn("copyCxxShared")
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = "tauri.build.gradle.kts")
