# Proguard rules for Hermes Native
-keepattributes *Annotation*
-dontwarn okhttp3.**
-dontwarn okio.**
-keep class kotlinx.serialization.** { *; }
