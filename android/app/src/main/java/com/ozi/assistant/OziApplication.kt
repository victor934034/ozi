package com.ozi.assistant

import android.app.Application
import com.ozi.assistant.data.OziRepository

class OziApplication : Application() {
    // Uma unica instancia pro app inteiro - service e UI compartilham o
    // mesmo estado (ver comentario no topo de OziRepository.kt).
    val repository: OziRepository by lazy { OziRepository(this) }
}
