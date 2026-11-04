import { Button } from './ui/button';
import { Input } from './ui/input';

export default function BirthdayTable() {
  return (<>
<section className="birthday-section" aria-labelledby="birthday-table-title">
  <div className="section-head">
    <div>
      <h2 id="birthday-table-title" className="section-title">Registros</h2>
      <p className="section-note">Fechas, emojis y roles elegidos por los usuarios.</p>
    </div>
    <span id="birthday-count" className="section-note"></span>
  </div>
  <div className="table-wrap">
    <table className="flat-table">
      <thead>
        <tr>
          <th scope="col">Servidor</th>
          <th scope="col">Usuario</th>
          <th scope="col">Fecha</th>
          <th scope="col">Emoji</th>
          <th scope="col">Rol de cumpleaños</th>
          <th scope="col">Color del rol</th>
          <th scope="col">Estado</th>
          <th scope="col">Acciones</th>
        </tr>
      </thead>
      <tbody id="birthday-rows"></tbody>
    </table>
  </div>
  <p id="birthday-message" className="message" role="status" aria-live="polite">Cargando cumpleaños…</p>

  <dialog id="birthday-edit-dialog" className="birthday-dialog" aria-labelledby="birthday-edit-title" aria-describedby="birthday-edit-member">
    <form id="birthday-edit-form" className="birthday-edit-form">
      <div className="birthday-dialog-heading">
        <div><h2 id="birthday-edit-title" className="section-title">Editar cumpleaños</h2><p className="section-note" id="birthday-edit-member"></p></div>
        <Button variant="outline" className="button birthday-dialog-close" type="button" data-close-birthday-dialog aria-label="Cerrar">×</Button>
      </div>
      <label className="field" htmlFor="birthday-edit-day">Día<Input id="birthday-edit-day" name="day" type="number" min="1" max="31" required /></label>
      <label className="field" htmlFor="birthday-edit-month">Mes<Input id="birthday-edit-month" name="month" type="number" min="1" max="12" required /></label>
      <label className="field" htmlFor="birthday-edit-emoji">Emoji<Input id="birthday-edit-emoji" name="emoji" maxLength={64} required /></label>
      <label className="field" htmlFor="birthday-edit-role">Nombre del rol<Input id="birthday-edit-role" name="roleName" maxLength={100} required /></label>
      <label className="field" htmlFor="birthday-edit-color">Color del rol<div className="birthday-color-field"><Input id="birthday-edit-color" name="color" type="color" required /><output id="birthday-edit-color-value">#D3FF75</output></div></label>
      <p id="birthday-edit-message" className="message" role="status" aria-live="polite"></p>
      <div className="birthday-dialog-actions"><Button variant="outline" className="button" type="button" data-close-birthday-dialog>Cancelar</Button><Button variant="outline" className="button primary" id="birthday-edit-save" type="submit">Guardar</Button></div>
      <Input type="hidden" id="birthday-edit-guild" name="guildId" />
      <Input type="hidden" id="birthday-edit-user" name="userId" />
    </form>
  </dialog>
</section>

  </>);
}
