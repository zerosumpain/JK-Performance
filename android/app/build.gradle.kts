import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

// Firebase (push) switches on when CI drops google-services.json in; without it
// the app builds and runs with push off.
if (file("google-services.json").exists()) {
    apply(plugin = "com.google.gms.google-services")
}

// Release signing comes from the environment (CI secrets); local builds are debug-signed.
val keystoreFile = System.getenv("JK_KEYSTORE_FILE")
val buildNumber = (System.getenv("JK_BUILD_NUMBER") ?: "1").toInt()

android {
    namespace = "com.jkperformance.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.jkperformance.app"
        minSdk = 28
        targetSdk = 35
        versionCode = buildNumber
        versionName = "0.1.$buildNumber"
        // The API; override with -PapiBase=http://100.83.68.108:5671 for the local preview.
        // Plain http only for builds pointed at the local preview (-PapiBase=http://…).
        manifestPlaceholders["allowHttp"] = (project.findProperty("apiBase")?.toString()?.startsWith("http://") == true).toString()
        buildConfigField("String", "API_BASE", "\"${project.findProperty("apiBase") ?: "https://jk.strangeramblings.com"}\"")
    }

    signingConfigs {
        if (keystoreFile != null) {
            create("release") {
                storeFile = file(keystoreFile)
                storePassword = System.getenv("JK_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("JK_KEY_ALIAS") ?: "jk-release"
                keyPassword = System.getenv("JK_KEY_PASSWORD") ?: System.getenv("JK_KEYSTORE_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = if (keystoreFile != null) signingConfigs.getByName("release") else signingConfigs.getByName("debug")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    packaging { resources.excludes += "/META-INF/{AL2.0,LGPL2.1}" }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.process)
    implementation(libs.androidx.navigation.compose)
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.graphics)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.compose.foundation)
    implementation(libs.compose.material3)
    implementation(libs.compose.material.icons)
    debugImplementation(libs.compose.ui.tooling)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.coroutines.play)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.okhttp)
    implementation(libs.androidx.credentials)
    implementation(libs.androidx.credentials.play)
    implementation(libs.googleid)
    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.messaging)
    implementation(libs.health.connect)
    implementation(libs.androidx.browser)
    implementation(libs.androidx.security.crypto)
    implementation(libs.coil.compose)
    implementation(libs.androidx.splashscreen)
}
