import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { DiscordIcon } from './ui/icons';

export default function LoginPanel() {
  return <main className="login">
    <div className="brand"><div className="brand-mark">N</div><div>NUKE BOT<small>ADMINISTRACIÓN</small></div></div>
    <Card>
      <CardHeader className="p-7 pb-0">
        <CardTitle className="text-2xl tracking-tight">Tu comunidad, en orden.</CardTitle>
        <CardDescription className="mt-2">Inicia sesión para gestionar Nuke Bot y configurar tu servidor.</CardDescription>
      </CardHeader>
      <CardContent className="p-7">
        <a className="discord-login" href="/auth/discord"><DiscordIcon /> Continuar con Discord</a>
        <p id="login-message" role="status" aria-live="polite" />
        <p className="mt-4 text-center text-xs text-muted-foreground">Solo para administradores autorizados.</p>
      </CardContent>
    </Card>
    <footer>Panel privado · Nuke Bot</footer>
  </main>;
}
