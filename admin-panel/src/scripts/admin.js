const statusEl = document.querySelector('#status');
    const pageNames = { overview: 'Resumen', birthdays: 'Cumpleaños', settings: 'Configuración' };
    const formatDuration = (seconds) => {
      const days = Math.floor(seconds / 86400); seconds %= 86400;
      const hours = Math.floor(seconds / 3600); seconds %= 3600;
      const minutes = Math.floor(seconds / 60);
      return [days && `${days} d`, hours && `${hours} h`, `${minutes} min`].filter(Boolean).join(' ');
    };
    async function api(path, options = {}) {
      const response = await fetch(path, { cache: 'no-store', ...options, headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers ?? {}) } });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) { location.href = '/login'; throw new Error('La sesión expiró.'); }
      if (!response.ok) throw new Error(data.error ?? 'No se pudo completar la solicitud.');
      return data;
    }
    function openPage(name) {
      document.querySelectorAll('.page').forEach((page) => page.classList.toggle('active', page.id === `page-${name}`));
      document.querySelectorAll('.nav-link').forEach((link) => link.classList.toggle('active', link.dataset.page === name));
      document.querySelector('#current-section').textContent = pageNames[name];
      history.replaceState(null, '', `#${name}`);
    }
    document.querySelectorAll('.nav-link').forEach((link) => link.addEventListener('click', () => openPage(link.dataset.page)));
    document.querySelectorAll('[data-open-page]').forEach((button) => button.addEventListener('click', () => openPage(button.dataset.openPage)));
    const initialPage = location.hash.slice(1);
    if (pageNames[initialPage]) openPage(initialPage);

    async function refreshStatus() {
      try {
        const data = await api('/api/status');
        const online = data.status === 'online';
        statusEl.textContent = online ? 'En línea' : data.status === 'starting' ? 'Iniciando' : 'Sin conexión';
        document.querySelector('#bot-name').textContent = data.botName ?? 'El bot todavía no está conectado';
        document.querySelector('#guilds').textContent = data.guilds ?? '—';
        document.querySelector('#uptime').textContent = Number.isFinite(data.uptimeSeconds) ? formatDuration(data.uptimeSeconds) : '—';
        document.querySelector('#sidebar-dot').className = `status-dot ${online ? 'online' : 'offline'}`;
        document.querySelector('#sidebar-status').textContent = online ? 'Bot conectado' : 'Bot desconectado';
      } catch {
        statusEl.textContent = 'Sin conexión';
        document.querySelector('#sidebar-dot').className = 'status-dot offline';
        document.querySelector('#sidebar-status').textContent = 'Bot desconectado';
      }
    }
    async function loadSettings() {
      const { settings } = await api('/api/settings');
      document.querySelector('#activity-text').value = settings.activityText;
      document.querySelector('#activity-type').value = settings.activityType;
      document.querySelector('#presence-status').value = settings.presenceStatus;
    }
    async function loadSession() {
      const { user } = await api('/api/session');
      if (user) document.querySelector('#session-name').textContent = `@${user.username}`;
    }
    function addIdentityCell(row, { name, detail, avatar, fallback }) {
      const cell = document.createElement('td');
      const identity = document.createElement('div'); identity.className = 'table-identity';
      if (avatar) {
        const image = document.createElement('img'); image.className = 'table-avatar'; image.src = avatar; image.alt = ''; image.loading = 'lazy';
        identity.append(image);
      } else {
        const placeholder = document.createElement('span'); placeholder.className = 'table-avatar placeholder'; placeholder.textContent = fallback;
        identity.append(placeholder);
      }
      const labels = document.createElement('div');
      const primary = document.createElement('div'); primary.className = 'table-primary'; primary.textContent = name;
      const secondary = document.createElement('div'); secondary.className = 'table-secondary'; secondary.textContent = detail;
      labels.append(primary, secondary); identity.append(labels); cell.append(identity); row.append(cell);
    }
    function openBirthdayEditor(birthday) {
      const dialog = document.querySelector('#birthday-edit-dialog');
      document.querySelector('#birthday-edit-guild').value = birthday.guild_id;
      document.querySelector('#birthday-edit-user').value = birthday.user_id;
      document.querySelector('#birthday-edit-member').textContent = `${birthday.display_name} · ${birthday.guild_name}`;
      document.querySelector('#birthday-edit-day').value = birthday.day;
      document.querySelector('#birthday-edit-month').value = birthday.month;
      document.querySelector('#birthday-edit-emoji').value = birthday.emoji;
      document.querySelector('#birthday-edit-role').value = birthday.role_name;
      const color = /^#[0-9a-f]{6}$/i.test(birthday.color ?? '') ? birthday.color : '#D3FF75';
      document.querySelector('#birthday-edit-color').value = color;
      document.querySelector('#birthday-edit-color-value').textContent = color.toUpperCase();
      const message = document.querySelector('#birthday-edit-message');
      message.textContent = '';
      message.className = 'message';
      dialog.showModal();
    }
    document.querySelectorAll('[data-close-birthday-dialog]').forEach((button) => button.addEventListener('click', () => {
      document.querySelector('#birthday-edit-dialog').close();
    }));
    document.querySelector('#birthday-edit-color').addEventListener('input', (event) => {
      document.querySelector('#birthday-edit-color-value').textContent = event.target.value.toUpperCase();
    });
    document.querySelector('#birthday-edit-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = document.querySelector('#birthday-edit-save');
      const message = document.querySelector('#birthday-edit-message');
      const guildId = form.elements.guildId.value;
      const userId = form.elements.userId.value;
      button.disabled = true;
      message.textContent = 'Guardando cambios…';
      message.className = 'message';
      try {
        await api(`/api/bot/guilds/${guildId}/birthdays/${userId}`, {
          method: 'PUT',
          body: JSON.stringify({
            day: Number(form.elements.day.value),
            month: Number(form.elements.month.value),
            emoji: form.elements.emoji.value,
            roleName: form.elements.roleName.value,
            color: form.elements.color.value,
          }),
        });
        document.querySelector('#birthday-edit-dialog').close();
        await loadBirthdays();
      } catch (error) {
        message.textContent = error.message;
        message.classList.add('error');
      } finally {
        button.disabled = false;
      }
    });
    async function loadBirthdays() {
      const message = document.querySelector('#birthday-message');
      const rows = document.querySelector('#birthday-rows');
      message.textContent = 'Cargando registros…';
      message.className = 'message';
      rows.replaceChildren();
      try {
        const { birthdays } = await api('/api/bot/birthdays');
        for (const birthday of birthdays) {
          const row = document.createElement('tr');
          addIdentityCell(row, { name: birthday.guild_name, detail: `ID ${birthday.guild_id}`, avatar: birthday.guild_icon, fallback: birthday.guild_name?.slice(0, 1)?.toUpperCase() ?? 'D' });
          addIdentityCell(row, {
            name: birthday.display_name,
            detail: birthday.username ? `@${birthday.username} · ID ${birthday.user_id}` : `ID ${birthday.user_id}`,
            avatar: birthday.avatar,
            fallback: birthday.display_name?.slice(0, 1)?.toUpperCase() ?? '?',
          });
          const dateCell = document.createElement('td'); dateCell.className = 'table-date';
          dateCell.textContent = `${String(birthday.day).padStart(2, '0')}/${String(birthday.month).padStart(2, '0')}`; row.append(dateCell);
          const emojiCell = document.createElement('td'); emojiCell.className = 'table-emoji'; emojiCell.textContent = birthday.emoji; row.append(emojiCell);
          const roleCell = document.createElement('td'); roleCell.className = 'table-role'; roleCell.textContent = `${birthday.emoji} - ${birthday.role_name}`; row.append(roleCell);
          const colorCell = document.createElement('td');
          const color = /^#[0-9a-f]{6}$/i.test(birthday.color ?? '') ? birthday.color : '#D3FF75';
          const colorLabel = document.createElement('span'); colorLabel.className = 'birthday-color';
          const swatch = document.createElement('i'); swatch.className = 'birthday-color-swatch'; swatch.style.backgroundColor = color;
          const colorValue = document.createElement('span'); colorValue.textContent = color.toUpperCase();
          colorLabel.append(swatch, colorValue); colorCell.append(colorLabel); row.append(colorCell);
          const statusCell = document.createElement('td');
          const status = document.createElement('span'); status.className = `state-pill ${birthday.ends_at ? 'active' : ''}`; status.textContent = birthday.ends_at ? 'Activo hoy' : 'Registrado';
          statusCell.append(status); row.append(statusCell);
          const actionsCell = document.createElement('td');
          const actions = document.createElement('div'); actions.className = 'birthday-actions';
          const editButton = document.createElement('button'); editButton.type = 'button'; editButton.className = 'button birthday-action'; editButton.textContent = 'Editar';
          editButton.addEventListener('click', () => openBirthdayEditor(birthday));
          const deleteButton = document.createElement('button'); deleteButton.type = 'button'; deleteButton.className = 'button danger birthday-action'; deleteButton.textContent = 'Eliminar';
          deleteButton.addEventListener('click', async () => {
            if (!window.confirm(`¿Eliminar el cumpleaños de ${birthday.display_name}? Si tiene un rol activo, también se quitará.`)) return;
            deleteButton.disabled = true;
            try {
              await api(`/api/bot/guilds/${birthday.guild_id}/birthdays/${birthday.user_id}`, { method: 'DELETE' });
              await loadBirthdays();
            } catch (error) {
              document.querySelector('#birthday-message').textContent = error.message;
              document.querySelector('#birthday-message').className = 'message error';
              deleteButton.disabled = false;
            }
          });
          actions.append(editButton, deleteButton); actionsCell.append(actions); row.append(actionsCell);
          rows.append(row);
        }
        const summary = birthdays.length ? `${birthdays.length} registros` : 'Sin registros';
        document.querySelector('#birthday-count').textContent = summary;
        message.textContent = birthdays.length ? '' : 'Todavía no hay cumpleaños registrados.';
        const overview = document.querySelector('#overview-birthdays');
        overview.textContent = birthdays.length ? `${birthdays.length} cumpleaños registrados en ${new Set(birthdays.map((item) => item.guild_id)).size} servidor(es).` : 'Todavía no hay cumpleaños registrados.';
      } catch (error) { message.textContent = error.message; message.classList.add('error'); }
    }
    document.querySelector('#refresh-birthdays').addEventListener('click', () => { loadBirthdays(); window.dispatchEvent(new Event('birthday-tests-refresh')); });
    document.querySelector('#settings-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = document.querySelector('#save-button'); const message = document.querySelector('#save-message');
      button.disabled = true; message.textContent = 'Guardando…'; message.className = 'message';
      try {
        await api('/api/settings', { method: 'PUT', body: JSON.stringify({
          activityText: document.querySelector('#activity-text').value,
          activityType: document.querySelector('#activity-type').value,
          presenceStatus: document.querySelector('#presence-status').value,
        }) });
        message.textContent = 'Cambios guardados. Se aplicarán en unos segundos.'; message.classList.add('success');
      } catch (error) { message.textContent = error.message; message.classList.add('error'); }
      finally { button.disabled = false; }
    });
    document.querySelector('#logout').addEventListener('click', async () => { await fetch('/api/logout', { method: 'POST' }); location.href = '/login'; });
    refreshStatus(); loadSession(); loadSettings().catch((error) => { document.querySelector('#save-message').textContent = error.message; });
    loadBirthdays();
    setInterval(refreshStatus, 15000);
