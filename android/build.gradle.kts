plugins {
    id("com.android.application") version "8.7.2" apply false
    id("org.jetbrains.kotlin.android") version "2.0.21" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.0.21" apply false
    // Le o app/google-services.json e injeta a config do Firebase no build -
    // sem isso o plugin do modulo (app/build.gradle.kts) nao funciona.
    id("com.google.gms.google-services") version "4.4.2" apply false
}
