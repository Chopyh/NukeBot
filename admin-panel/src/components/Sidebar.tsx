import { Button } from './ui/button';
import { useState } from 'react';
import { MorphIcon } from 'morphicons/react';
import { Cake, Gamepad2, House, Settings2, Shield } from '../lib/icons';

export default function Sidebar() {
  const [expanded, setExpanded] = useState(false);
  return (<>
<aside className="sidebar">
  <a className="brand" href="/#overview" aria-label="Nuke Bot, ir al resumen">
    <span className="brand-mark">N</span>
    <span>NUKE BOT<small>ADMINISTRACIÓN</small></span>
  </a>
  <Button variant="outline" type="button" className="mobile-menu" aria-label={expanded ? 'Cerrar navegación' : 'Abrir navegación'} aria-expanded={expanded} aria-controls="sidebar-navigation" onClick={() => setExpanded(!expanded)}>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d={expanded ? 'm6 6 12 12M6 18 18 6' : 'M4 6h16M4 12h16M4 18h16'} /></svg>
  </Button>
  <div id="sidebar-navigation" className="sidebar-navigation" data-expanded={expanded} onClick={(event) => {
    if ((event.target as HTMLElement).closest('[data-page]')) {
      setExpanded(false);
      if (window.matchMedia('(max-width: 760px)').matches) document.querySelector<HTMLButtonElement>('.mobile-menu')?.focus({ preventScroll: true });
    }
  }} onKeyDown={(event) => { if (event.key === 'Escape') { setExpanded(false); document.querySelector<HTMLButtonElement>('.mobile-menu')?.focus(); } }}>
  <div className="nav-label">GENERAL</div>
  <nav className="nav-group" aria-label="Navegación principal">
    <Button variant="outline" className="nav-link active" data-page="overview"><span className="nav-icon"><MorphIcon icon={House} size={16} /></span>Resumen</Button>
  </nav>
  <div className="nav-label">COMUNIDAD</div>
  <nav className="nav-group" aria-label="Comunidad">
    <Button variant="outline" className="nav-link" data-page="birthdays"><span className="nav-icon"><MorphIcon icon={Cake} size={16} /></span>Cumpleaños</Button>
    <Button variant="outline" className="nav-link" data-page="reaction-roles"><span className="nav-icon"><MorphIcon icon={Shield} size={16} /></span>Roles por reacción</Button>
    <Button variant="outline" className="nav-link" data-page="game-roles"><span className="nav-icon"><MorphIcon icon={Gamepad2} size={16} /></span>Roles de juegos</Button>
  </nav>
  <div className="nav-label">SISTEMA</div>
  <nav className="nav-group" aria-label="Sistema">
    <Button variant="outline" className="nav-link" data-page="settings"><span className="nav-icon"><MorphIcon icon={Settings2} size={16} /></span>Configuración</Button>
  </nav>
  </div>
  <div className="sidebar-bottom"><span><i id="sidebar-dot" className="status-dot"></i><span id="sidebar-status">Comprobando conexión</span></span></div>
</aside>

  </>);
}
