import { useEffect } from 'react';
import { initializeAdmin } from '../scripts/admin';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import BirthdayTable from './BirthdayTable';
import BirthdayTestPanel from './BirthdayTestPanel';
import ReactionRolesPanel from './ReactionRolesPanel';
import type { ReactNode } from 'react';

function PageHeading({title, description, children}: {title: string; description: string; children?: ReactNode}) {
  return <div className="page-heading"><div><p className="page-eyebrow">TU COMUNIDAD, EN ORDEN</p><h1>{title}</h1><p className="subtitle">{description}</p></div>{children}</div>;
}

export default function AdminApp() {
  useEffect(() => initializeAdmin(), []);
  return (<>
  <div className="layout">
    <Sidebar />

    <div className="main">
      <Topbar />
      <main className="content">
        <section id="page-overview" className="page active">
          <PageHeading title="Resumen" description="Estado del bot y actividad del servidor." />
          <div className="stats" aria-live="polite">
            <div className="stat"><div className="stat-label">Conexión</div><div id="status" className="stat-value">Comprobando</div><div id="bot-name" className="stat-detail">Esperando al bot</div></div>
            <div className="stat"><div className="stat-label">Servidores de Discord</div><div id="guilds" className="stat-value">—</div><div className="stat-detail">Servidores conectados</div></div>
            <div className="stat"><div className="stat-label">Tiempo activo</div><div id="uptime" className="stat-value">—</div><div className="stat-detail">Desde el último inicio</div></div>
          </div>
          <section className="section"><div className="section-head"><div><h2 className="section-title">Cumpleaños registrados</h2><p className="section-note">Vista rápida de los registros guardados.</p></div><Button variant="outline" className="button" data-open-page="birthdays">Ver todos</Button></div><div id="overview-birthdays" className="empty">Cargando registros…</div></section>
          <footer>Panel privado · Actualización del estado cada 15 segundos</footer>
        </section>

        <section id="page-birthdays" className="page">
          <PageHeading title="Cumpleaños" description="Registros y pruebas temporales de la decoración y el rol."><Button variant="outline" id="refresh-birthdays" className="button">Actualizar</Button></PageHeading>
          <BirthdayTable />

          <BirthdayTestPanel  />
        </section>

        <section id="page-reaction-roles" className="page">
          <PageHeading title="Roles por reacción" description="Asigna roles a miembros desde reacciones en mensajes de Discord." />
          <ReactionRolesPanel />
        </section>

        <section id="page-game-roles" className="page">
          <PageHeading title="Roles de juegos" description="Gestiona opciones de juegos y sus roles desde un mensaje persistente de Discord." />
          <Card className="section game-roles-panel"><CardContent className="p-5 sm:p-7">
            <div className="game-role-fields">
              <label className="field">Servidor<select id="game-role-guild" required><option value="">Cargando servidores…</option></select></label>
              <label className="field">Canal del mensaje<select id="game-role-channel" required disabled><option value="">Selecciona un servidor</option></select></label>
              <label className="field">Categoría para canales creados automáticamente<select id="game-role-category" disabled><option value="">Sin categoría</option></select></label>
              <label className="field game-role-rich-field">Texto inicial
                <div className="rich-toolbar game-role-rich-toolbar" role="toolbar" aria-label="Formato del texto inicial">
                  <Button variant="outline" type="button" data-game-format="bold" aria-label="Negrita"><strong>B</strong></Button><Button variant="outline" type="button" data-game-format="italic" aria-label="Cursiva"><em>I</em></Button><Button variant="outline" type="button" data-game-format="underline" aria-label="Subrayado"><u>U</u></Button><Button variant="outline" type="button" data-game-format="strike" aria-label="Tachado"><s>S</s></Button><Button variant="outline" type="button" data-game-format="code" aria-label="Código">&lt;/&gt;</Button><Button variant="outline" type="button" data-game-format="quote" aria-label="Cita">❞</Button><Button variant="outline" type="button" data-game-format="link" aria-label="Enlace">↗</Button>
                </div>
                <Textarea id="game-role-intro" maxLength={1500} rows={4} placeholder="Elige los juegos que juegas:"></Textarea>
                <span className="field-hint">Markdown de Discord · Máximo 1500 caracteres.</span>
              </label>
              <div className="game-role-list-head"><div><h2 className="section-title">Juegos</h2><p className="section-note">Cada juego crea y administra su propio rol.</p></div><Button variant="outline" id="game-role-add" className="button" type="button">＋ Añadir juego</Button></div>
              <div id="game-role-games" className="game-role-games"></div>
              <label className="field game-role-rich-field">Texto final
                <div className="rich-toolbar game-role-rich-toolbar" role="toolbar" aria-label="Formato del texto final">
                  <Button variant="outline" type="button" data-game-format="bold" aria-label="Negrita"><strong>B</strong></Button><Button variant="outline" type="button" data-game-format="italic" aria-label="Cursiva"><em>I</em></Button><Button variant="outline" type="button" data-game-format="underline" aria-label="Subrayado"><u>U</u></Button><Button variant="outline" type="button" data-game-format="strike" aria-label="Tachado"><s>S</s></Button><Button variant="outline" type="button" data-game-format="code" aria-label="Código">&lt;/&gt;</Button><Button variant="outline" type="button" data-game-format="quote" aria-label="Cita">❞</Button><Button variant="outline" type="button" data-game-format="link" aria-label="Enlace">↗</Button>
                </div>
                <Textarea id="game-role-outro" maxLength={1500} rows={4} placeholder="Puedes cambiar tu selección cuando quieras."></Textarea>
                <span className="field-hint">Markdown de Discord · Máximo 1500 caracteres.</span>
              </label>
              <div className="game-role-save"><Button variant="outline" id="game-role-save" className="button primary" type="button">Guardar y actualizar mensaje</Button><p id="game-role-message" className="message" role="status" aria-live="polite"></p></div>
              <p id="game-role-persistent" className="field-hint">El mensaje se crea al guardar por primera vez y conserva su ID al actualizar juegos y textos.</p>
            </div>
          </CardContent></Card>
        </section>

        <section id="page-settings" className="page">
          <PageHeading title="Configuración" description="Presencia y actividad que muestra el bot en Discord." />
          <Card><CardHeader><CardTitle>Presencia del bot</CardTitle><CardDescription>Personaliza cómo aparece Nuke Bot en tu servidor.</CardDescription></CardHeader><CardContent><form id="settings-form" className="settings-form">
            <label className="field">Texto de actividad <Input id="activity-text" maxLength={128} placeholder="Ej. gestionando la comunidad" /></label>
            <label className="field">Tipo de actividad<select id="activity-type"><option value="playing">Jugando a</option><option value="listening">Escuchando</option><option value="watching">Viendo</option><option value="competing">Compitiendo en</option></select></label>
            <label className="field">Estado de presencia<select id="presence-status"><option value="online">En línea</option><option value="idle">Ausente</option><option value="dnd">No molestar</option><option value="invisible">Invisible</option></select></label>
            <Button variant="outline" id="save-button" className="button primary" type="submit">Guardar cambios</Button><p id="save-message" className="message" role="status"></p>
          </form></CardContent></Card>
        </section>
      </main>
    </div>
  </div>


  </>);
}
