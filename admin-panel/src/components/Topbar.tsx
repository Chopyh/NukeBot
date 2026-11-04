import { Button } from './ui/button';

export default function Topbar() {
  return (<>
<header className="topbar">
  <div className="crumb">Nuke Bot <span className="crumb-separator">/</span> <span id="current-section">Resumen</span></div>
  <div className="top-actions"><span id="session-name" className="session-name">Acceso verificado</span><Button variant="outline" id="logout" className="logout">Cerrar sesión</Button></div>
</header>

  </>);
}
