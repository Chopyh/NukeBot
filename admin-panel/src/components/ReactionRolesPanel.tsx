import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';

export default function ReactionRolesPanel() {
  return (<>
<section aria-labelledby="reaction-roles-title">
  <div className="section-head">
    <div><h2 id="reaction-roles-title" className="section-title">Crear mensaje de roles</h2><p className="section-note">Diseña el mensaje, elige un canal y añade una opción por cada rol que quieras ofrecer.</p></div>
  </div>
  <form id="reaction-role-form" className="settings-form reaction-role-form">
    <div className="reaction-role-editor-grid">
      <div className="reaction-role-fields">
        <label className="field">Servidor<select id="reaction-role-guild" required><option value="">Cargando servidores…</option></select></label>
        <label className="field">Canal de publicación<select id="reaction-role-channel" required disabled><option value="">Selecciona un servidor</option></select></label>
        <label className="field">Título del mensaje<Input id="reaction-role-title-input" maxLength={256} placeholder="Elige tus roles" /></label>
        <label className="field">Color del mensaje<div className="reaction-role-color"><Input id="reaction-role-color" type="color" defaultValue="#5865F2" /><output id="reaction-role-color-value">#5865F2</output></div></label>
        <label className="field reaction-role-description-field">Descripción del mensaje
          <div className="rich-toolbar" role="toolbar" aria-label="Formato de texto">
            <Button variant="outline" type="button" data-format="bold" aria-label="Negrita"><strong>B</strong></Button><Button variant="outline" type="button" data-format="italic" aria-label="Cursiva"><em>I</em></Button><Button variant="outline" type="button" data-format="underline" aria-label="Subrayado"><u>U</u></Button><Button variant="outline" type="button" data-format="strike" aria-label="Tachado"><s>S</s></Button><Button variant="outline" type="button" data-format="code" aria-label="Código">&lt;/&gt;</Button><Button variant="outline" type="button" data-format="quote" aria-label="Cita">❞</Button>
          </div>
          <Textarea id="reaction-role-description" maxLength={4096} rows={7} placeholder="Reacciona debajo para elegir tus roles. Puedes usar formato de Discord con la barra de herramientas."></Textarea>
          <span className="field-hint">Admite formato de Discord. Máximo 4096 caracteres.</span>
        </label>
      </div>
      <aside className="embed-preview" aria-label="Vista previa del mensaje">
        <div className="embed-preview-label">VISTA PREVIA EN DISCORD</div>
        <div className="embed-preview-card"><div id="reaction-role-preview-bar" className="embed-preview-bar"></div><div className="embed-preview-content"><strong id="reaction-role-preview-title">Elige tus roles</strong><div id="reaction-role-preview-description">Reacciona debajo para elegir tus roles. Puedes usar formato de Discord con la barra de herramientas.</div></div></div>
      </aside>
    </div>
    <div className="reaction-role-options-heading"><div><h3 className="section-title">Opciones de roles</h3><p className="section-note">Cada emoji asigna el rol que el miembro seleccione.</p></div><Button variant="outline" id="reaction-role-add-option" className="button" type="button">＋ Añadir opción</Button></div>
    <div id="reaction-role-options" className="reaction-role-options"></div>
    <div className="reaction-role-form-footer"><Button variant="outline" id="reaction-role-save" className="button primary" type="submit">Publicar mensaje</Button><p id="reaction-role-form-message" className="message" role="status" aria-live="polite"></p></div>
  </form>

  <section className="section" aria-labelledby="reaction-role-list-title">
    <div className="section-head">
      <div><h2 id="reaction-role-list-title" className="section-title">Asociaciones activas</h2><p className="section-note">Configuradas desde este panel.</p></div>
      <Button variant="outline" id="refresh-reaction-roles" className="button" type="button">Actualizar</Button>
    </div>
    <div className="table-wrap">
      <table className="flat-table reaction-role-table">
        <thead><tr><th scope="col">Servidor</th><th scope="col">Emoji</th><th scope="col">Rol</th><th scope="col">Canal</th><th scope="col">Mensaje</th><th scope="col">Acciones</th></tr></thead>
        <tbody id="reaction-role-rows"></tbody>
      </table>
    </div>
    <p id="reaction-role-list-message" className="message" role="status" aria-live="polite">Cargando asociaciones…</p>
  </section>
</section>

  </>);
}
