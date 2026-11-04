import { Button } from './ui/button';
import { useState } from 'react';
import { MorphIcon } from 'morphicons/react';
import { ChevronDown, House, Settings2 } from '../lib/icons';
import { DiscordIcon } from './ui/icons';

export default function Sidebar() {
  const [expanded, setExpanded] = useState(false);
  return (<>
<nav className="server-rail" aria-label="Espacios de Nuke Bot">
  <Button variant="ghost" className="server-icon rail-home" data-open-page="overview" aria-label="Inicio de Nuke Bot" title="Inicio"><DiscordIcon /></Button>
  <div className="rail-divider" />
  <Button variant="ghost" className="server-icon selected" data-open-page="overview" aria-label="Administración de Nuke Bot" title="Nuke Bot">N</Button>
  <div className="rail-spacer" />
  <Button variant="ghost" className="server-icon rail-settings" data-open-page="settings" aria-label="Configuración del bot" title="Configuración"><MorphIcon icon={Settings2} size={22} /></Button>
</nav>
<aside className="sidebar">
  <a className="brand" href="/#overview" aria-label="Nuke Bot, ir al resumen">
    <span>Nuke Bot <small>Panel de administración</small></span>
    <MorphIcon icon={ChevronDown} size={18} />
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
  <div className="server-banner"><span className="banner-orbit" aria-hidden="true">✦</span><span>TU SERVIDOR.<br />TUS REGLAS.</span><small>Un espacio para tu comunidad.</small></div>
  <div className="nav-label"><span aria-hidden="true">⌄</span> GENERAL</div>
  <nav className="nav-group" aria-label="Navegación principal">
    <Button variant="outline" className="nav-link active" data-page="overview" aria-current="page"><span className="nav-icon"><MorphIcon icon={House} size={20} /></span>resumen</Button>
  </nav>
  <div className="nav-label"><span aria-hidden="true">⌄</span> COMUNIDAD</div>
  <nav className="nav-group" aria-label="Comunidad">
    <Button variant="outline" className="nav-link" data-page="birthdays"><span className="nav-icon channel-hash" aria-hidden="true">#</span>cumpleaños</Button>
    <Button variant="outline" className="nav-link" data-page="reaction-roles"><span className="nav-icon channel-hash" aria-hidden="true">#</span>roles-por-reacción</Button>
    <Button variant="outline" className="nav-link" data-page="game-roles"><span className="nav-icon channel-hash" aria-hidden="true">#</span>roles-de-juegos</Button>
  </nav>
  <div className="nav-label"><span aria-hidden="true">⌄</span> SISTEMA</div>
  <nav className="nav-group" aria-label="Sistema">
    <Button variant="outline" className="nav-link" data-page="settings"><span className="nav-icon"><MorphIcon icon={Settings2} size={20} /></span>configuración</Button>
  </nav>
  </div>
  <div className="sidebar-bottom"><div className="profile-avatar" aria-hidden="true">N<i id="sidebar-dot" className="status-dot" /></div><div className="profile-info"><span id="session-name" className="session-name">Acceso verificado</span><span id="sidebar-status">Comprobando conexión</span></div></div>
</aside>

  </>);
}
