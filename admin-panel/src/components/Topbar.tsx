import { Button } from './ui/button';

export default function Topbar() {
  return (<>
<header className="topbar">
  <div className="crumb"><span className="channel-hash" aria-hidden="true">#</span><span id="current-section">Resumen</span><span className="channel-description">El centro de control de tu comunidad</span></div>
  <div className="top-actions"><span className="private-badge">Panel privado</span><Button variant="ghost" id="logout" className="logout">Cerrar sesión</Button></div>
</header>

  </>);
}
