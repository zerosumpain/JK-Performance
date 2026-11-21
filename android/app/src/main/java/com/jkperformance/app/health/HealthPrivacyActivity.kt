package com.jkperformance.app

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import com.jkperformance.app.net.APIClient

/**
 * Health Connect refuses to show its permission screen to an app that can't
 * explain why it reads health data, so it opens this (Android 13's rationale
 * action, and Android 14's "permission usage" alias in the manifest). It hands
 * over to the privacy policy, the same page Account › Privacy policy opens.
 */
class HealthPrivacyActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        try {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(APIClient.privacyURL)))
        } catch (_: ActivityNotFoundException) {
            // No browser on the phone: nothing to show, and nothing to recover.
        }
        finish()
    }
}
