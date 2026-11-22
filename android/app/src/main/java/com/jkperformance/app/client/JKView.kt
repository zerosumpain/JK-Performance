package com.jkperformance.app

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import com.jkperformance.app.net.AppSession

// STUB (foundation): replaced by the Atelier port.

@Composable
fun JKView() { MessagesThreadView(clientId = null, otherName = AppSession.me?.coach?.name ?: "JK", subtitle = "") }
