# Proguard rules for Hermes Native
-keepattributes *Annotation*
-dontwarn okhttp3.**
-dontwarn okio.**
-keep class kotlinx.serialization.** { *; }
-keepclassmembers class * {
    @kotlinx.serialization.SerialName <fields>;
}
-keep class com.hermesagent.nativemobile.data.model.** { *; }
