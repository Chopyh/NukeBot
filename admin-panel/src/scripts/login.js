const messages = {
      forbidden: 'Tu cuenta no tiene el rol Dios en el servidor principal.',
      discord_denied: 'Se canceló el acceso de Discord.',
      invalid_oauth: 'La sesión de Discord expiró o no es válida. Inténtalo de nuevo.',
      oauth: 'No se pudo completar el acceso con Discord. Inténtalo de nuevo.',
    };
    document.querySelector('#login-message').textContent = messages[new URLSearchParams(location.search).get('error')] ?? '';
