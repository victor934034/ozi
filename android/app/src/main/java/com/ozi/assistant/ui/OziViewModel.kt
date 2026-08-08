package com.ozi.assistant.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import com.ozi.assistant.data.OziRepository
import com.ozi.assistant.data.OziUiState
import com.ozi.assistant.data.SecurePrefs
import kotlinx.coroutines.flow.StateFlow

class OziViewModel(private val repository: OziRepository) : ViewModel() {

    val uiState: StateFlow<OziUiState> = repository.uiState

    fun conectar() = repository.conectar()
    fun desconectar() = repository.desconectar()
    fun comecarAEscutar() = repository.comecarAEscutar()
    fun enviarTextoDigitado(texto: String) = repository.enviarTextoDigitado(texto)
    fun limparErro() = repository.limparErro()
    fun preferencias(): SecurePrefs = repository.preferencias()

    suspend fun entrarComEmailSenha(email: String, senha: String) = repository.entrarComEmailSenha(email, senha)
    suspend fun criarConta(email: String, senha: String, nome: String) = repository.criarContaComEmailSenha(email, senha, nome)
    suspend fun entrarComGoogle(idToken: String) = repository.entrarComGoogle(idToken)
    fun sair() = repository.sair()

    class Factory(private val repository: OziRepository) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T {
            return OziViewModel(repository) as T
        }
    }
}
