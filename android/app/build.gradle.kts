plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "com.ozi.assistant"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.ozi.assistant"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
        freeCompilerArgs += "-opt-in=androidx.compose.material3.ExperimentalMaterial3Api"
    }

    buildFeatures {
        compose = true
    }
}

dependencies {
    implementation(platform("androidx.compose:compose-bom:2024.12.01"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")

    // Armazenamento local criptografado (config do servidor, identidade do
    // dispositivo) - ver src/data/SecurePrefs.kt
    implementation("androidx.security:security-crypto:1.1.0-alpha06")

    // Cliente WebSocket - mesmo protocolo que o server.js ja usa
    implementation("com.squareup.okhttp3:okhttp:4.12.0")

    // Motor de wake word local (deteccao de "Ozi" offline, sem gastar
    // bateria/dados). Requer AccessKey da Picovoice + arquivo .ppn treinado
    // pra "Ozi" (ver WakeWordDetector.kt pra instrucoes).
    implementation("ai.picovoice:porcupine-android:3.0.3")

    // "Entrar com Google" - API moderna (Credential Manager), substitui a
    // antiga GoogleSignInClient. Precisa do google_web_client_id
    // configurado (ver res/values/strings.xml e README) pra funcionar de
    // verdade - sem isso, so o botao de email/senha funciona.
    implementation("androidx.credentials:credentials:1.3.0")
    implementation("androidx.credentials:credentials-play-services-auth:1.3.0")
    implementation("com.google.android.libraries.identity.googleid:googleid:1.1.1")

    // Notificacoes push (Firebase Cloud Messaging). So funciona de verdade
    // depois de adicionar app/google-services.json e aplicar o plugin
    // com.google.gms.google-services (ver README - precisa criar um
    // projeto Firebase primeiro, e uma etapa manual sua).
    implementation(platform("com.google.firebase:firebase-bom:33.7.0"))
    implementation("com.google.firebase:firebase-messaging-ktx")
}
