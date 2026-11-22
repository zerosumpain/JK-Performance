package com.jkperformance.app.design.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import com.jkperformance.app.design.JKColors
import com.jkperformance.app.design.JKShape
import com.jkperformance.app.design.JKSize
import com.jkperformance.app.design.JKSpace
import com.jkperformance.app.design.JKType
import com.jkperformance.app.design.monospacedDigit

/** What the client is working towards. */
sealed interface GoalLineState {
    /** A set goal: the sentence, progress 0..1 and the distance left ("4.6 kg to go"). */
    class Set(val sentence: String, val progress: Float, val toGo: String) : GoalLineState
    /** JK hasn't set one yet. */
    data object NotSet : GoalLineState
    /** Reached; JK sets the next one with the client. */
    class Reached(val sentence: String) : GoalLineState
}

/** The goal block on Today: a serif sentence, the 2dp accent rule, and a tabular "x to go". */
@Composable
fun GoalLine(state: GoalLineState, modifier: Modifier = Modifier) {
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(JKSpace.m)) {
        when (state) {
            is GoalLineState.Set -> {
                Text(state.sentence, style = JKType.title, color = JKColors.text)
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(JKSpace.m)) {
                    Box(Modifier.weight(1f).height(JKSize.rule).background(JKColors.track, JKShape.pill)) {
                        Box(Modifier.fillMaxHeight().fillMaxWidth(state.progress.coerceIn(0f, 1f)).background(JKColors.accent, JKShape.pill))
                    }
                    Text(state.toGo, style = JKType.caption.monospacedDigit(), color = JKColors.textSecondary)
                }
            }
            GoalLineState.NotSet -> {
                Text("JK will set your goal with you.", style = JKType.title, color = JKColors.textSecondary)
            }
            is GoalLineState.Reached -> {
                Text(state.sentence, style = JKType.title, color = JKColors.text)
                Box(Modifier.fillMaxWidth().height(JKSize.rule).background(JKColors.accent, JKShape.pill))
                Text("Reached. JK will set the next one with you", style = JKType.caption, color = JKColors.textSecondary)
            }
        }
    }
}
