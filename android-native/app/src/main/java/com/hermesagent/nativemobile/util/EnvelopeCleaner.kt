package com.hermesagent.nativemobile.util

object EnvelopeCleaner {
    private val CONTEXT_COMPACTION_REGEX = Regex("""\[CONTEXT COMPACTION[\s\S]*?\[/CONTEXT COMPACTION\]""", RegexOption.IGNORE_CASE)
    private val MODEL_SWITCH_REGEX = Regex("""\[System: The active model for this chat has changed[\s\S]*?\]""", RegexOption.IGNORE_CASE)
    private val OUT_OF_BAND_REGEX = Regex("""\[OUT-OF-BAND USER MESSAGE[\s\S]*?\]""", RegexOption.IGNORE_CASE)
    private val ATTACHED_CONTEXT_REGEX = Regex("""--- Attached Context ---[\s\S]*?--- End Attached Context ---""", RegexOption.IGNORE_CASE)

    fun clean(text: String): String {
        var result = text
        result = CONTEXT_COMPACTION_REGEX.replace(result, "")
        result = MODEL_SWITCH_REGEX.replace(result, "")
        result = OUT_OF_BAND_REGEX.replace(result, "")
        result = ATTACHED_CONTEXT_REGEX.replace(result, "")
        return result.trim()
    }
}
