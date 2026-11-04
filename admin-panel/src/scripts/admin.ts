import { createSelect } from '../components/ui/select';

interface PanelElement extends HTMLElement {
  value: string;
  disabled: boolean;
  showModal(): void;
  close(): void;
  add(option: HTMLOptionElement): void;
  elements: HTMLFormControlsCollection & Record<string, HTMLInputElement>;
  selectionStart: number | null;
  selectionEnd: number | null;
  setRangeText(replacement: string, start?: number, end?: number, selectMode?: SelectionMode): void;
  focus(options?: FocusOptions): void;
  style: CSSStyleDeclaration;
}

type BirthdayRow = {
  guild_id: string; user_id: string; guild_name: string; guild_icon: string | null;
  display_name: string; username: string | null; avatar: string | null; day: number; month: number;
  emoji: string; role_name: string; color: string | null; ends_at: string | null;
};
type ReactionEmoji = { id: string; name: string; animated: boolean };
type ReactionRoleMapping = {
  guild_id: string; message_id: string; channel_id: string; guild_name: string;
  emoji_display: string; role_name: string;
};
type ReactionRoleCatalog = { roles: { id: string; name: string }[]; emojis: ReactionEmoji[] };

function query(selector: string): PanelElement {
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`No se encontró el elemento requerido: ${selector}`);
  return element as PanelElement;
}

function queryAll(selector: string): PanelElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(selector)) as PanelElement[];
}

const statusEl = query('#status');
    const pageNames: Record<string, string> = { overview: 'Resumen', birthdays: 'Cumpleaños', 'reaction-roles': 'Roles por reacción', 'game-roles': 'Roles de juegos', settings: 'Configuración' };
    const formatDuration = (seconds: number): string => {
      const days = Math.floor(seconds / 86400); seconds %= 86400;
      const hours = Math.floor(seconds / 3600); seconds %= 3600;
      const minutes = Math.floor(seconds / 60);
      return [days && `${days} d`, hours && `${hours} h`, `${minutes} min`].filter(Boolean).join(' ');
    };
    async function api(path: string, options: RequestInit = {}): Promise<any> {
      const response = await fetch(path, { cache: 'no-store', ...options, headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers ?? {}) } });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) { location.href = '/login'; throw new Error('La sesión expiró.'); }
      if (!response.ok) throw new Error(data.error ?? 'No se pudo completar la solicitud.');
      return data;
    }
    function errorMessage(error: unknown): string {
      return error instanceof Error ? error.message : 'No se pudo completar la solicitud.';
    }
    function openPage(name: string): void {
      queryAll('.page').forEach((page) => page.classList.toggle('active', page.id === `page-${name}`));
      queryAll('.nav-link').forEach((link) => link.classList.toggle('active', link.dataset.page === name));
      query('#current-section').textContent = pageNames[name] ?? 'Resumen';
      history.replaceState(null, '', `#${name}`);
    }
    queryAll('.nav-link').forEach((link) => link.addEventListener('click', () => openPage(link.dataset.page ?? 'overview')));
    queryAll('[data-open-page]').forEach((button) => button.addEventListener('click', () => openPage(button.dataset.openPage ?? 'overview')));
    const initialPage = location.hash.slice(1);
    if (Object.hasOwn(pageNames, initialPage)) openPage(initialPage);

    async function refreshStatus() {
      try {
        const data = await api('/api/status');
        const online = data.status === 'online';
        statusEl.textContent = online ? 'En línea' : data.status === 'starting' ? 'Iniciando' : 'Sin conexión';
        query('#bot-name').textContent = data.botName ?? 'El bot todavía no está conectado';
        query('#guilds').textContent = data.guilds ?? '—';
        query('#uptime').textContent = Number.isFinite(data.uptimeSeconds) ? formatDuration(data.uptimeSeconds) : '—';
        query('#sidebar-dot').className = `status-dot ${online ? 'online' : 'offline'}`;
        query('#sidebar-status').textContent = online ? 'Bot conectado' : 'Bot desconectado';
      } catch {
        statusEl.textContent = 'Sin conexión';
        query('#sidebar-dot').className = 'status-dot offline';
        query('#sidebar-status').textContent = 'Bot desconectado';
      }
    }
    refreshStatus();
    setInterval(refreshStatus, 15000);
    async function loadSettings() {
      const { settings } = await api('/api/settings');
      query('#activity-text').value = settings.activityText;
      query('#activity-type').value = settings.activityType;
      query('#presence-status').value = settings.presenceStatus;
    }
    async function loadSession() {
      const { user } = await api('/api/session');
      if (user) query('#session-name').textContent = `@${user.username}`;
    }
    function addIdentityCell(row: HTMLTableRowElement, { name, detail, avatar, fallback }: { name: string; detail: string; avatar: string | null; fallback: string }): void {
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
    function openBirthdayEditor(birthday: BirthdayRow): void {
      const dialog = query('#birthday-edit-dialog');
      query('#birthday-edit-guild').value = birthday.guild_id;
      query('#birthday-edit-user').value = birthday.user_id;
      query('#birthday-edit-member').textContent = `${birthday.display_name} · ${birthday.guild_name}`;
      query('#birthday-edit-day').value = String(birthday.day);
      query('#birthday-edit-month').value = String(birthday.month);
      query('#birthday-edit-emoji').value = birthday.emoji;
      query('#birthday-edit-role').value = birthday.role_name;
      const color = birthday.color && /^#[0-9a-f]{6}$/i.test(birthday.color) ? birthday.color : '#D3FF75';
      query('#birthday-edit-color').value = color;
      query('#birthday-edit-color-value').textContent = color.toUpperCase();
      const message = query('#birthday-edit-message');
      message.textContent = '';
      message.className = 'message';
      dialog.showModal();
    }
    queryAll('[data-close-birthday-dialog]').forEach((button) => button.addEventListener('click', () => {
      query('#birthday-edit-dialog').close();
    }));
    query('#birthday-edit-color').addEventListener('input', (event) => {
      query('#birthday-edit-color-value').textContent = (event.currentTarget as HTMLInputElement).value.toUpperCase();
    });
    query('#birthday-edit-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget as HTMLFormElement;
      const button = query('#birthday-edit-save');
      const message = query('#birthday-edit-message');
      const field = (name: string): string => (form.elements.namedItem(name) as HTMLInputElement).value;
      const guildId = field('guildId');
      const userId = field('userId');
      button.disabled = true;
      message.textContent = 'Guardando cambios…';
      message.className = 'message';
      try {
        await api(`/api/bot/guilds/${guildId}/birthdays/${userId}`, {
          method: 'PUT',
          body: JSON.stringify({
            day: Number(field('day')),
            month: Number(field('month')),
            emoji: field('emoji'),
            roleName: field('roleName'),
            color: field('color'),
          }),
        });
        query('#birthday-edit-dialog').close();
        await loadBirthdays();
      } catch (error: unknown) {
        message.textContent = errorMessage(error);
        message.classList.add('error');
      } finally {
        button.disabled = false;
      }
    });
    async function loadBirthdays() {
      const message = query('#birthday-message');
      const rows = query('#birthday-rows');
      message.textContent = 'Cargando registros…';
      message.className = 'message';
      rows.replaceChildren();
      try {
        const { birthdays } = await api('/api/bot/birthdays') as { birthdays: BirthdayRow[] };
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
          const color = birthday.color && /^#[0-9a-f]{6}$/i.test(birthday.color) ? birthday.color : '#D3FF75';
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
            } catch (error: unknown) {
              query('#birthday-message').textContent = errorMessage(error);
              query('#birthday-message').className = 'message error';
              deleteButton.disabled = false;
            }
          });
          actions.append(editButton, deleteButton); actionsCell.append(actions); row.append(actionsCell);
          rows.append(row);
        }
        const summary = birthdays.length ? `${birthdays.length} registros` : 'Sin registros';
        query('#birthday-count').textContent = summary;
        message.textContent = birthdays.length ? '' : 'Todavía no hay cumpleaños registrados.';
        const overview = query('#overview-birthdays');
        overview.textContent = birthdays.length ? `${birthdays.length} cumpleaños registrados en ${new Set(birthdays.map((item) => item.guild_id)).size} servidor(es).` : 'Todavía no hay cumpleaños registrados.';
      } catch (error: unknown) { message.textContent = errorMessage(error); message.classList.add('error'); }
    }
    query('#refresh-birthdays').addEventListener('click', () => { loadBirthdays(); window.dispatchEvent(new Event('birthday-tests-refresh')); });
    const reactionRoleGuild = query('#reaction-role-guild');
    const reactionRoleChannel = query('#reaction-role-channel');
    const reactionRoleOptions = query('#reaction-role-options');
    let reactionRoleCatalog: ReactionRoleCatalog = { roles: [], emojis: [] };
    const commonEmojis = ['😀','😃','😄','😁','😆','😅','😂','🙂','😉','😊','😍','🥰','😎','🤔','🙌','👏','👍','👎','❤️','💙','💚','💜','🧡','💛','🔥','✨','⭐','🌟','🎉','🎊','🎂','🎮','🎵','🎨','📚','💬','✅','❌','⚽','🏀','🎯','🌈','☀️','🌙','🍕','☕','🐱','🐶','🦊','🐸','🌸','🍀'];
    async function loadReactionRoleGuilds() {
      try {
        const guilds = await api('/api/bot/guilds');
        reactionRoleGuild.replaceChildren(new Option('Selecciona un servidor', ''));
        for (const guild of guilds) reactionRoleGuild.add(new Option(guild.name, guild.id));
      } catch (error: unknown) {
        reactionRoleGuild.replaceChildren(new Option(errorMessage(error), ''));
      }
    }
    reactionRoleGuild.addEventListener('change', async () => {
      reactionRoleChannel.disabled = true;
      reactionRoleChannel.replaceChildren(new Option('Cargando canales…', ''));
      if (!reactionRoleGuild.value) {
        reactionRoleCatalog = { roles: [], emojis: [] };
        reactionRoleChannel.replaceChildren(new Option('Selecciona un servidor', ''));
        reactionRoleOptions.replaceChildren();
        addReactionRoleOption();
        return;
      }
      try {
        const [roles, channels, emojis] = await Promise.all([
          api(`/api/bot/guilds/${reactionRoleGuild.value}/roles`),
          api(`/api/bot/guilds/${reactionRoleGuild.value}/channels`),
          api(`/api/bot/guilds/${reactionRoleGuild.value}/emojis`),
        ]);
        reactionRoleCatalog = { roles, emojis };
        reactionRoleChannel.replaceChildren(new Option('Selecciona un canal', ''));
        for (const channel of channels) reactionRoleChannel.add(new Option(`# ${channel.name}`, channel.id));
        reactionRoleChannel.disabled = false;
        if (!channels.length) reactionRoleChannel.replaceChildren(new Option('No hay canales de texto disponibles', ''));
        reactionRoleOptions.replaceChildren();
        addReactionRoleOption();
      } catch (error: unknown) {
        reactionRoleCatalog = { roles: [], emojis: [] };
        reactionRoleChannel.replaceChildren(new Option(errorMessage(error), ''));
      }
    });
    function addReactionRoleOption() {
      if (reactionRoleOptions.querySelectorAll('.reaction-option').length >= 20) return;
      const row = document.createElement('div'); row.className = 'reaction-option';
      const roleField = document.createElement('label'); roleField.className = 'field'; roleField.textContent = 'Rol que se asignará';
      const roleSelect = document.createElement('select'); roleSelect.required = true;
      roleSelect.add(new Option(reactionRoleCatalog.roles.length ? 'Selecciona un rol' : 'Elige primero un servidor', ''));
      for (const role of reactionRoleCatalog.roles) roleSelect.add(new Option(role.name, role.id));
      roleSelect.addEventListener('change', refreshEmbedPreview);
      roleField.append(roleSelect);

      const emojiField = document.createElement('div'); emojiField.className = 'field';
      const emojiLabel = document.createElement('span'); emojiLabel.textContent = 'Emoji de reacción'; emojiField.append(emojiLabel);
      const picker = document.createElement('details'); picker.className = 'reaction-emoji-picker';
      const summary = document.createElement('summary'); summary.textContent = '🙂  Elige un emoji'; picker.append(summary);
      const grid = document.createElement('div'); grid.className = 'emoji-picker-grid';
      const emojiInput = document.createElement('input'); emojiInput.type = 'hidden';
      function addEmojiChoice(value: string, label: string, customEmoji: ReactionEmoji | null = null): void {
        const choice = document.createElement('button'); choice.type = 'button'; choice.className = 'emoji-choice'; choice.title = label;
        if (customEmoji) {
          const image = document.createElement('img'); image.src = `https://cdn.discordapp.com/emojis/${customEmoji.id}.${customEmoji.animated ? 'gif' : 'png'}?size=48`; image.alt = label; choice.append(image);
        } else choice.textContent = value;
        choice.addEventListener('click', () => {
          emojiInput.value = value;
          summary.replaceChildren();
          if (customEmoji) {
            const image = document.createElement('img'); image.className = 'emoji-choice-preview'; image.src = `https://cdn.discordapp.com/emojis/${customEmoji.id}.${customEmoji.animated ? 'gif' : 'png'}?size=48`; image.alt = label; summary.append(image);
          } else summary.textContent = value;
          summary.append(document.createTextNode(` ${label}`));
          picker.open = false;
          refreshEmbedPreview();
        });
        grid.append(choice);
      }
      const unicodeLabel = document.createElement('span'); unicodeLabel.className = 'emoji-picker-label'; unicodeLabel.textContent = 'EMOJI'; grid.append(unicodeLabel);
      for (const emoji of commonEmojis) addEmojiChoice(emoji, emoji);
      if (reactionRoleCatalog.emojis.length) {
        const serverLabel = document.createElement('span'); serverLabel.className = 'emoji-picker-label'; serverLabel.textContent = 'EMOJIS DEL SERVIDOR'; grid.append(serverLabel);
        for (const emoji of reactionRoleCatalog.emojis) {
          const value = `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>`;
          addEmojiChoice(value, `:${emoji.name}:`, emoji);
        }
      }
      picker.append(grid); emojiField.append(picker, emojiInput);
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'button danger reaction-option-remove'; remove.textContent = 'Quitar';
      remove.addEventListener('click', () => { row.remove(); refreshEmbedPreview(); query('#reaction-role-add-option').disabled = false; });
      row.append(roleField, emojiField, remove);
      reactionRoleOptions.append(row);
      query('#reaction-role-add-option').disabled = reactionRoleOptions.querySelectorAll('.reaction-option').length >= 20;
      refreshEmbedPreview();
    }
    query('#reaction-role-add-option').addEventListener('click', addReactionRoleOption);

    const editor = query('#reaction-role-description');
    const previewTitle = query('#reaction-role-preview-title');
    const previewDescription = query('#reaction-role-preview-description');
    const previewBar = query('#reaction-role-preview-bar');
    const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character as '&' | '<' | '>' | '"' | "'"]);
    function renderDiscordMarkdown(value: string): string {
      let html = escapeHtml(value).replace(/&lt;a?:([A-Za-z0-9_]{2,32}):(\d{17,20})&gt;/g, (match, name: string, id: string) => {
        const emoji = reactionRoleCatalog.emojis.find((item) => item.id === id && item.name === name);
        return emoji ? `<img class="embed-preview-emoji" src="https://cdn.discordapp.com/emojis/${emoji.id}.${emoji.animated ? 'gif' : 'png'}?size=32" alt=":${escapeHtml(name)}:">` : match;
      }).replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/__(.+?)__/g, '<u>$1</u>')
        .replace(/~~(.+?)~~/g, '<s>$1</s>').replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/^&gt; (.*)$/gm, '<span class="preview-quote">$1</span>');
      return html.replace(/\n/g, '<br>');
    }
    function refreshEmbedPreview() {
      const title = query('#reaction-role-title-input').value.trim();
      previewTitle.textContent = title || 'Elige tus roles';
      const roleLines = [...reactionRoleOptions.querySelectorAll('.reaction-option')].map((row) => {
        const emoji = row.querySelector<HTMLInputElement>('input[type="hidden"]')?.value ?? '';
        const role = row.querySelector<HTMLSelectElement>('select')?.selectedOptions[0]?.textContent;
        return emoji && role && !role.startsWith('Selecciona') && !role.startsWith('Elige primero') ? `${emoji} — **${role}**` : '';
      }).filter(Boolean).join('\n');
      const description = [editor.value || 'Reacciona con el emoji correspondiente para obtener el rol.', roleLines].filter(Boolean).join('\n\n');
      previewDescription.innerHTML = renderDiscordMarkdown(description);
      const color = query('#reaction-role-color').value;
      previewBar.style.backgroundColor = color;
      query('#reaction-role-color-value').textContent = color.toUpperCase();
    }
    query('#reaction-role-title-input').addEventListener('input', refreshEmbedPreview);
    editor.addEventListener('input', refreshEmbedPreview);
    query('#reaction-role-color').addEventListener('input', refreshEmbedPreview);
    const formatTokens: Record<string, [string, string]> = { bold: ['**', '**'], italic: ['*', '*'], underline: ['__', '__'], strike: ['~~', '~~'], code: ['`', '`'], quote: ['> ', ''] };
    queryAll('[data-format]').forEach((button) => button.addEventListener('click', () => {
      const [before, after] = formatTokens[button.dataset.format ?? 'bold'] ?? ['**', '**'];
      const start = editor.selectionStart ?? 0; const end = editor.selectionEnd ?? start; const selected = editor.value.slice(start, end) || 'texto';
      editor.setRangeText(`${before}${selected}${after}`, start, end, 'select'); editor.focus(); editor.dispatchEvent(new Event('input'));
    }));
    addReactionRoleOption();
    refreshEmbedPreview();
    async function loadReactionRoles() {
      const message = query('#reaction-role-list-message');
      const rows = query('#reaction-role-rows');
      message.textContent = 'Cargando asociaciones…';
      message.className = 'message';
      rows.replaceChildren();
      try {
        const mappings = await api('/api/bot/reaction-roles') as ReactionRoleMapping[];
        for (const mapping of mappings) {
          const row = document.createElement('tr');
          const guild = document.createElement('td'); guild.textContent = mapping.guild_name; row.append(guild);
          const emoji = document.createElement('td'); emoji.className = 'table-emoji'; emoji.textContent = mapping.emoji_display; row.append(emoji);
          const role = document.createElement('td'); role.textContent = mapping.role_name; row.append(role);
          for (const id of [mapping.channel_id, mapping.message_id]) {
            const cell = document.createElement('td');
            const code = document.createElement('code'); code.textContent = id; cell.append(code); row.append(cell);
          }
          const actions = document.createElement('td');
          const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'button danger birthday-action'; remove.textContent = 'Eliminar';
          remove.addEventListener('click', async () => {
            if (!window.confirm(`¿Eliminar la asociación ${mapping.emoji_display} → ${mapping.role_name}?`)) return;
            remove.disabled = true;
            try {
              const query = new URLSearchParams({ emoji: mapping.emoji_display });
              await api(`/api/bot/reaction-roles/${mapping.guild_id}/${mapping.message_id}?${query}`, { method: 'DELETE' });
              await loadReactionRoles();
            } catch (error: unknown) {
              message.textContent = errorMessage(error);
              message.className = 'message error';
              remove.disabled = false;
            }
          });
          actions.append(remove); row.append(actions); rows.append(row);
        }
        message.textContent = mappings.length ? `${mappings.length} asociaciones` : 'Todavía no hay asociaciones de roles por reacción.';
      } catch (error: unknown) { message.textContent = errorMessage(error); message.classList.add('error'); }
    }
    query('#reaction-role-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = query('#reaction-role-save');
      const message = query('#reaction-role-form-message');
      button.disabled = true;
      message.textContent = 'Publicando mensaje y añadiendo reacciones…';
      message.className = 'message';
      try {
        const options = [...reactionRoleOptions.querySelectorAll('.reaction-option')].map((row) => ({
          roleId: row.querySelector<HTMLSelectElement>('select')?.value ?? '',
          emoji: row.querySelector<HTMLInputElement>('input[type="hidden"]')?.value ?? '',
        }));
        if (!options.length || options.some((option) => !option.roleId || !option.emoji)) throw new Error('Completa el rol y el emoji de cada opción.');
        await api('/api/bot/reaction-roles', {
          method: 'POST',
          body: JSON.stringify({
            guildId: reactionRoleGuild.value,
            channelId: reactionRoleChannel.value,
            title: query('#reaction-role-title-input').value,
            description: editor.value,
            color: query('#reaction-role-color').value,
            options,
          }),
        });
        message.textContent = 'Mensaje publicado con sus roles y reacciones.';
        message.classList.add('success');
        query('#reaction-role-title-input').value = '';
        editor.value = '';
        query('#reaction-role-color').value = '#5865F2';
        reactionRoleOptions.replaceChildren();
        addReactionRoleOption();
        refreshEmbedPreview();
        reactionRoleChannel.value = '';
        await loadReactionRoles();
      } catch (error: unknown) { message.textContent = errorMessage(error); message.classList.add('error'); }
      finally { button.disabled = false; }
    });
    query('#refresh-reaction-roles').addEventListener('click', loadReactionRoles);
    loadReactionRoleGuilds();
    loadReactionRoles();
    const gameRoleGuild = query('#game-role-guild');
    const gameRoleChannel = query('#game-role-channel');
    const gameRoleGames = query('#game-role-games');
    const gameRoleCategory = query('#game-role-category');
    let selectedGameRoleCategory = '';
    let loadedGameRoleGuild = '';
    let gameRoleChannelOptions: { text: Array<{ id: string; name: string; type: 'text' }>; voice: Array<{ id: string; name: string; type: 'voice' }> } = { text: [], voice: [] };
    type GameRoleDraft = { id?: string; name: string; description: string; emoji: string; channel_id?: string | null; createChannel?: boolean };
    let gameRoleDrafts: GameRoleDraft[] = [];
    function renderGameRoleDrafts(): void {
      gameRoleGames.replaceChildren();
      gameRoleDrafts.forEach((game, index) => {
        const row = document.createElement('div'); row.className = 'game-role-option';
        const name = document.createElement('input'); name.required = true; name.maxLength = 80; name.placeholder = 'Nombre del juego'; name.value = game.name; name.setAttribute('aria-label', 'Nombre del juego');
        const emoji = document.createElement('input'); emoji.required = true; emoji.maxLength = 64; emoji.placeholder = '🎮 o <:nombre:id>'; emoji.value = game.emoji; emoji.setAttribute('aria-label', 'Emoji del juego');
        const description = document.createElement('input'); description.maxLength = 250; description.placeholder = 'Descripción breve'; description.value = game.description; description.setAttribute('aria-label', 'Descripción del juego');
        const channel = createSelect('game-channel-select'); channel.required = true; channel.setAttribute('aria-label', 'Canal vinculado al juego');
        channel.add(new Option('Selecciona un canal', ''));
        const textGroup = document.createElement('optgroup'); textGroup.label = 'Canales de texto';
        for (const option of gameRoleChannelOptions.text) textGroup.append(new Option(`# ${option.name}`, option.id));
        channel.append(textGroup);
        const voiceGroup = document.createElement('optgroup'); voiceGroup.label = 'Canales de voz (no disponibles)';
        for (const option of gameRoleChannelOptions.voice) {
          const voice = new Option(`🔊 ${option.name}`, option.id); voice.disabled = true; voiceGroup.append(voice);
        }
        channel.append(voiceGroup);
        channel.value = game.channel_id ?? '';
        const createLabel = document.createElement('label'); createLabel.className = 'game-role-create-toggle';
        const create = document.createElement('input'); create.type = 'checkbox'; create.checked = game.createChannel ?? false;
        const createText = document.createElement('span'); createText.textContent = 'Crear canal'; createLabel.append(create, createText);
        channel.disabled = create.checked; channel.required = !create.checked;
        create.addEventListener('change', () => { channel.disabled = create.checked; channel.required = !create.checked; });
        const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'button danger'; remove.textContent = 'Quitar';
        remove.addEventListener('click', () => { gameRoleDrafts.splice(index, 1); renderGameRoleDrafts(); });
        row.append(name, emoji, description, channel, createLabel, remove); gameRoleGames.append(row);
      });
      query('#game-role-add').disabled = gameRoleDrafts.length >= 20;
    }
    query('#game-role-add').addEventListener('click', () => {
      if (gameRoleDrafts.length < 20) {
        const selectedCategory = gameRoleCategory.value;
        gameRoleDrafts.push({ name: '', description: '', emoji: '' });
        renderGameRoleDrafts();
        gameRoleCategory.value = selectedCategory;
      }
    });
    gameRoleCategory.addEventListener('change', () => { selectedGameRoleCategory = gameRoleCategory.value; });
    async function loadGameRoleGuilds(): Promise<void> {
      try {
        const guilds = await api('/api/bot/guilds');
        gameRoleGuild.replaceChildren(new Option('Selecciona un servidor', ''));
        for (const guild of guilds) gameRoleGuild.add(new Option(guild.name, guild.id));
      } catch (error: unknown) { gameRoleGuild.replaceChildren(new Option(errorMessage(error), '')); }
    }
    gameRoleGuild.addEventListener('change', async () => {
      if (gameRoleGuild.value !== loadedGameRoleGuild) selectedGameRoleCategory = '';
      loadedGameRoleGuild = gameRoleGuild.value;
      gameRoleChannel.disabled = true;
      gameRoleChannel.replaceChildren(new Option('Cargando configuración…', ''));
      const categorySelect = gameRoleCategory;
      categorySelect.disabled = true;
      categorySelect.replaceChildren(new Option('Cargando categorías…', ''));
      gameRoleDrafts = []; renderGameRoleDrafts();
      query('#game-role-intro').value = ''; query('#game-role-outro').value = '';
      query('#game-role-persistent').textContent = 'El mensaje se crea al guardar por primera vez y conserva su ID al actualizar juegos y textos.';
      if (!gameRoleGuild.value) { gameRoleChannel.replaceChildren(new Option('Selecciona un servidor', '')); return; }
      try {
        const [channels, categories, saved] = await Promise.all([
          api(`/api/bot/guilds/${gameRoleGuild.value}/channels`),
          api(`/api/bot/guilds/${gameRoleGuild.value}/categories`),
          api(`/api/bot/game-roles/${gameRoleGuild.value}`),
        ]);
        gameRoleChannelOptions = await api(`/api/bot/game-roles/${gameRoleGuild.value}/channels`);
        categorySelect.replaceChildren(new Option('Sin categoría', ''));
        for (const category of categories) categorySelect.add(new Option(category.name, category.id));
        if (categories.some((category: { id: string }) => category.id === selectedGameRoleCategory)) categorySelect.value = selectedGameRoleCategory;
        selectedGameRoleCategory = categorySelect.value;
        categorySelect.disabled = false;
        gameRoleChannel.replaceChildren(new Option('Selecciona un canal', ''));
        for (const channel of channels) gameRoleChannel.add(new Option(`# ${channel.name}`, channel.id));
        const config = saved.config;
        if (config) {
          gameRoleChannel.value = config.channel_id;
          gameRoleChannel.disabled = true;
          query('#game-role-intro').value = config.intro;
          query('#game-role-outro').value = config.outro;
          gameRoleDrafts = saved.games;
          query('#game-role-persistent').textContent = `Mensaje persistente: ${config.message_id}. El canal queda fijado para conservar el mismo mensaje.`;
        } else gameRoleChannel.disabled = false;
        renderGameRoleDrafts();
        if (!channels.length) { gameRoleChannel.replaceChildren(new Option('No hay canales de texto disponibles', '')); gameRoleChannel.disabled = true; }
      } catch (error: unknown) {
        gameRoleChannel.replaceChildren(new Option(errorMessage(error), ''));
        query('#game-role-message').textContent = errorMessage(error);
        query('#game-role-message').className = 'message error';
      }
    });
    query('#game-role-save').addEventListener('click', async () => {
      const button = query('#game-role-save'); const message = query('#game-role-message');
      const savedGames = [...gameRoleGames.querySelectorAll<HTMLElement>('.game-role-option')].map((row, index) => {
        const fields = row.querySelectorAll<HTMLInputElement>('input');
        const channel = row.querySelector<HTMLSelectElement>('select');
        return { ...(gameRoleDrafts[index]?.id ? { id: gameRoleDrafts[index]!.id } : {}), name: fields[0]?.value ?? '', emoji: fields[1]?.value ?? '', description: fields[2]?.value ?? '', channelId: channel?.value ?? '', createChannel: fields[3]?.checked ?? false };
      });
      if (!gameRoleGuild.value || !gameRoleChannel.value) { message.textContent = 'Selecciona un servidor y un canal.'; message.className = 'message error'; return; }
      button.disabled = true; message.textContent = 'Actualizando mensaje y roles…'; message.className = 'message';
      try {
        const result = await api(`/api/bot/game-roles/${gameRoleGuild.value}`, { method: 'PUT', body: JSON.stringify({
          channelId: gameRoleChannel.value, categoryId: query('#game-role-category').value, intro: query('#game-role-intro').value, outro: query('#game-role-outro').value, games: savedGames,
        }) });
        message.textContent = result.warnings?.length
          ? `Guardado con avisos: ${result.warnings.join(' · ')}`
          : `Configuración guardada: ${result.games} juego(s). El mensaje ${result.messageId} conserva su ID.`;
        message.className = 'message success';
        gameRoleGuild.dispatchEvent(new Event('change'));
      } catch (error: unknown) { message.textContent = errorMessage(error); message.className = 'message error'; }
      finally { button.disabled = false; }
    });
    void loadGameRoleGuilds();
    query('#settings-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = query('#save-button'); const message = query('#save-message');
      button.disabled = true; message.textContent = 'Guardando…'; message.className = 'message';
      try {
        await api('/api/settings', { method: 'PUT', body: JSON.stringify({
          activityText: query('#activity-text').value,
          activityType: query('#activity-type').value,
          presenceStatus: query('#presence-status').value,
        }) });
        message.textContent = 'Cambios guardados. Se aplicarán en unos segundos.'; message.classList.add('success');
      } catch (error: unknown) { message.textContent = errorMessage(error); message.classList.add('error'); }
      finally { button.disabled = false; }
    });
    query('#logout').addEventListener('click', async () => { await fetch('/api/logout', { method: 'POST' }); location.href = '/login'; });
    loadSession(); loadSettings().catch((error: unknown) => { query('#save-message').textContent = errorMessage(error); });
    loadBirthdays();
