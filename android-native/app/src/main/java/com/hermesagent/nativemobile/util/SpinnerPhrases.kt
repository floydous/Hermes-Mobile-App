package com.hermesagent.nativemobile.util

object SpinnerPhrases {
    val INITIAL_PHRASES = listOf(
        "Digesting…",
        "Reading prompt…",
        "Pondering…",
        "Gathering thoughts…",
        "Analyzing…",
        "Looking into it…",
        "Making sense…",
        "Formulating…",
        "Brewing…",
        "Thinking…"
    )

    val PROGRESSIVE_PHRASES = listOf(
        "Piecing together…",
        "Synthesizing…",
        "Connecting dots…",
        "Reasoning…",
        "Deliberating…",
        "Refining…",
        "Working through…",
        "Distilling…",
        "Constructing…",
        "Forming thoughts…"
    )

    fun getInitialPhrase(): String = INITIAL_PHRASES.random()
    fun getProgressivePhrase(): String = PROGRESSIVE_PHRASES.random()
}
