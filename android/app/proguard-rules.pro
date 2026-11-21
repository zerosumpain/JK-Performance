# kotlinx.serialization keeps its generated serializers through its own rules;
# keep the model classes' companions too so release builds decode JSON.
-keepattributes *Annotation*, InnerClasses
-keep,includedescriptorclasses class com.jkperformance.app.**$$serializer { *; }
-keepclassmembers class com.jkperformance.app.** { *** Companion; }
-keepclasseswithmembers class com.jkperformance.app.** { kotlinx.serialization.KSerializer serializer(...); }
