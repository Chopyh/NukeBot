import { useEffect, useMemo, useState } from 'react';
import { MorphIcon } from 'morphicons/react';
import {
  Cake, Check, ChevronDown, Clock3, LoaderCircle, RotateCcw, Search,
  ShieldCheck, Sparkles, UserRoundSearch, UsersRound,
} from '../lib/icons.js';
import { Badge } from './ui/badge.jsx';
import { Button } from './ui/button.jsx';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card.jsx';
import { Input } from './ui/input.jsx';
import { Label } from './ui/label.jsx';
import { cn } from '../lib/utils.js';

async function api(path, options = {}) {
  const response = await fetch(path, {
    cache: 'no-store',
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers ?? {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) {
    window.location.href = '/login';
    throw new Error('La sesión expiró.');
  }
  if (!response.ok) {
    const error = new Error(data.error ?? 'No se pudo completar la solicitud.');
    error.requestId = data.requestId ?? response.headers.get('x-request-id');
    throw error;
  }
  return data;
}

function describeError(error) {
  return error.requestId ? `${error.message} (referencia: ${error.requestId})` : error.message;
}

function Avatar({ member, large = false }) {
  const sizeClass = large ? 'size-14 text-lg' : 'size-10 text-sm';
  const className = cn('shrink-0 rounded-full border border-border bg-muted object-cover', sizeClass);
  if (member?.avatar) return <img className={className} src={member.avatar} alt="" />;
  return <span className={cn('grid place-items-center font-semibold text-muted-foreground', className)}>{member?.displayName?.slice(0, 1)?.toUpperCase() ?? '?'}</span>;
}

function EmptyResults({ icon: Icon, title, detail }) {
  return (
    <div className="grid min-h-40 place-items-center rounded-xl border border-dashed border-border bg-background/60 px-5 py-8 text-center">
      <div>
        <span className="mx-auto mb-3 grid size-10 place-items-center rounded-full bg-secondary text-muted-foreground"><MorphIcon icon={Icon} size={18} /></span>
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}

export default function BirthdayTestPanel() {
  const [guilds, setGuilds] = useState([]);
  const [guildId, setGuildId] = useState('');
  const [birthdays, setBirthdays] = useState([]);
  const [query, setQuery] = useState('');
  const [members, setMembers] = useState([]);
  const [member, setMember] = useState(null);
  const [emoji, setEmoji] = useState('🎂');
  const [roleName, setRoleName] = useState('');
  const [color, setColor] = useState('#D3FF75');
  const [tests, setTests] = useState([]);
  const [loadingGuilds, setLoadingGuilds] = useState(true);
  const [searching, setSearching] = useState(false);
  const [starting, setStarting] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busyTestId, setBusyTestId] = useState('');

  const selectedBirthday = useMemo(
    () => birthdays.find((birthday) => birthday.guild_id === guildId && birthday.user_id === member?.id),
    [birthdays, guildId, member?.id],
  );

  useEffect(() => {
    let active = true;
    Promise.all([api('/api/bot/guilds'), api('/api/bot/birthdays')])
      .then(([serverList, birthdayResult]) => {
        if (!active) return;
        setGuilds(serverList);
        setBirthdays(birthdayResult.birthdays);
        if (serverList.length === 1) setGuildId(serverList[0].id);
      })
      .catch((fetchError) => active && setError(describeError(fetchError)))
      .finally(() => active && setLoadingGuilds(false));
    return () => { active = false; };
  }, []);

  async function loadTests() {
    try {
      const result = await api('/api/bot/birthday-tests');
      setTests(result.filter((test) => !guildId || test.guild_id === guildId));
    } catch (fetchError) {
      setError(describeError(fetchError));
    }
  }

  useEffect(() => { loadTests(); }, [guildId]);

  useEffect(() => {
    const refresh = () => loadTests();
    window.addEventListener('birthday-tests-refresh', refresh);
    return () => window.removeEventListener('birthday-tests-refresh', refresh);
  }, [guildId]);

  useEffect(() => {
    setMembers([]);
    setMember(null);
    setRoleName('');
    setColor('#D3FF75');
    if (!guildId || query.trim().length < 2) {
      setSearching(false);
      return undefined;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const path = '/api/bot/guilds/' + guildId + '/members?q=' + encodeURIComponent(query.trim());
        const result = await api(path, { signal: controller.signal });
        setMembers(result);
      } catch (fetchError) {
        if (fetchError.name !== 'AbortError') setError(describeError(fetchError));
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 300);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [guildId, query]);

  useEffect(() => {
    if (!member) return;
    const birthday = birthdays.find((item) => item.guild_id === guildId && item.user_id === member.id);
    setEmoji(birthday?.emoji ?? '🎂');
    setRoleName(birthday?.role_name ?? 'Cumpleañero ' + member.displayName);
    setColor(birthday?.color ?? '#D3FF75');
  }, [member, birthdays, guildId]);

  async function startTest() {
    if (!member || !guildId) return;
    setStarting(true);
    setError('');
    setNotice('');
    try {
      await api('/api/bot/birthday-tests', {
        method: 'POST',
        body: JSON.stringify({ guildId, userId: member.id, emoji, roleName, color }),
      });
      setNotice('Prueba iniciada. Puedes restaurar los cambios desde la lista de pruebas activas.');
      await loadTests();
    } catch (fetchError) {
      setError(describeError(fetchError));
    } finally {
      setStarting(false);
    }
  }

  async function cancelTest(test) {
    setBusyTestId(test.test_id);
    setError('');
    try {
      await api('/api/bot/guilds/' + test.guild_id + '/birthday-tests/' + test.test_id, { method: 'DELETE' });
      setNotice('Prueba cancelada y cambios restaurados.');
      await loadTests();
      const result = await api('/api/bot/birthdays');
      setBirthdays(result.birthdays);
    } catch (fetchError) {
      setError(describeError(fetchError));
    } finally {
      setBusyTestId('');
    }
  }

  return (
    <div className="space-y-8">
      <Card className="overflow-hidden">
        <CardHeader className="border-b border-border bg-gradient-to-r from-card to-[#1c2017] p-6 sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="grid size-11 shrink-0 place-items-center rounded-xl border border-primary/15 bg-primary/10 text-primary">
                <MorphIcon icon={Cake} size={20} />
              </div>
              <div>
                <CardTitle className="text-lg">Prueba de cumpleaños</CardTitle>
                <CardDescription className="mt-2 max-w-2xl">
                  Comprueba la decoración de canales y el rol temporal antes del día real.
                </CardDescription>
              </div>
            </div>
            <Badge variant="outline" className="gap-1.5 border-border bg-background/50 px-3 py-1.5 text-muted-foreground">
              <MorphIcon icon={Clock3} size={13} /> Hasta 10 minutos
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="grid gap-7 p-6 sm:p-7 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,.85fr)]">
          <div className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="test-guild">Servidor de Discord</Label>
              <div className="relative">
                <select
                  id="test-guild"
                  className="flex h-10 w-full appearance-none rounded-lg border border-input bg-background px-3 pr-10 text-sm text-foreground shadow-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-50"
                  value={guildId}
                  onChange={(event) => { setGuildId(event.target.value); setQuery(''); setError(''); }}
                  disabled={loadingGuilds}
                >
                  <option value="">{loadingGuilds ? 'Cargando servidores…' : 'Selecciona un servidor'}</option>
                  {guilds.map((guild) => <option key={guild.id} value={guild.id}>{guild.name} · {guild.memberCount} miembros</option>)}
                </select>
                <MorphIcon icon={ChevronDown} size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="member-query">Buscar usuario</Label>
              <div className="relative">
                <MorphIcon icon={Search} size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="member-query"
                  className="pl-9 pr-10"
                  type="search"
                  placeholder="Nombre, apodo o usuario de Discord"
                  value={query}
                  onChange={(event) => { setQuery(event.target.value); setError(''); }}
                  disabled={!guildId}
                  autoComplete="off"
                />
                {searching && <MorphIcon icon={LoaderCircle} size={16} className="absolute right-3 top-1/2 animate-spin text-muted-foreground" />}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Resultados</Label>
                {members.length > 0 && <span className="text-xs text-muted-foreground">{members.length} encontrados</span>}
              </div>
              {!guildId ? (
                <EmptyResults icon={UsersRound} title="Elige un servidor" detail="Después podrás buscar a uno de sus miembros." />
              ) : query.trim().length < 2 ? (
                <EmptyResults icon={UserRoundSearch} title="Busca un miembro" detail="Escribe al menos dos caracteres para ver resultados." />
              ) : searching ? (
                <div className="grid min-h-40 place-items-center rounded-xl border border-border bg-background/60 text-sm text-muted-foreground">
                  <span className="flex items-center gap-2"><MorphIcon icon={LoaderCircle} size={16} className="animate-spin" /> Buscando miembros…</span>
                </div>
              ) : members.length === 0 ? (
                <EmptyResults icon={Search} title="No hay coincidencias" detail="Prueba con otro nombre o apodo." />
              ) : (
                <div className="max-h-72 space-y-1 overflow-y-auto rounded-xl border border-border bg-background/60 p-1.5" role="listbox" aria-label="Resultados de miembros">
                  {members.map((result) => (
                    <button
                      className={cn(
                        'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                        member?.id === result.id && 'bg-accent',
                      )}
                      type="button"
                      role="option"
                      aria-selected={member?.id === result.id}
                      key={result.id}
                      onClick={() => { setMember(result); setNotice(''); }}
                    >
                      <Avatar member={result} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-foreground">{result.displayName}</span>
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">@{result.username} · {result.id}</span>
                      </span>
                      {member?.id === result.id && <MorphIcon icon={Check} size={16} className="shrink-0 text-primary" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-5 lg:border-l lg:border-border lg:pl-7">
            <div>
              <Label>Usuario seleccionado</Label>
              <div className={cn(
                'mt-2 flex min-h-[76px] items-center gap-3 rounded-xl border p-3.5 transition-colors',
                member ? 'border-primary/20 bg-primary/[0.045]' : 'border-dashed border-border bg-background/50',
              )}>
                {member ? (
                  <>
                    <Avatar member={member} large />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-foreground">{member.displayName}</p>
                      <p className="mt-1 truncate text-xs text-muted-foreground">@{member.username}</p>
                    </div>
                    <Badge variant="success" className="gap-1"><MorphIcon icon={Check} size={12} /> Listo</Badge>
                  </>
                ) : (
                  <>
                    <div className="grid size-11 shrink-0 place-items-center rounded-full bg-secondary text-muted-foreground"><MorphIcon icon={UserRoundSearch} size={18} /></div>
                    <p className="text-sm text-muted-foreground">Selecciona un miembro de los resultados.</p>
                  </>
                )}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-[.65fr_1.35fr] lg:grid-cols-1 xl:grid-cols-[.65fr_1.35fr]">
              <div className="space-y-2">
                <Label htmlFor="test-emoji">Emoji de prueba</Label>
                <Input id="test-emoji" value={emoji} maxLength={64} onChange={(event) => setEmoji(event.target.value)} placeholder="🎂" />
                <p className="text-xs text-muted-foreground">Se aplicará al nombre de cada canal.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="test-role">Nombre del rol</Label>
                <Input id="test-role" value={roleName} maxLength={100} onChange={(event) => setRoleName(event.target.value)} placeholder="Nombre temporal" />
                <p className="text-xs text-muted-foreground">El rol se elimina al restaurar la prueba.</p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="test-color">Color del rol</Label>
              <div className="flex items-center gap-3">
                <Input id="test-color" type="color" className="h-10 w-16 cursor-pointer p-1" value={color} onChange={(event) => setColor(event.target.value)} />
                <span className="text-xs text-muted-foreground">{color.toUpperCase()}</span>
              </div>
              <p className="text-xs text-muted-foreground">Se carga automáticamente al elegir un usuario registrado.</p>
            </div>

            {selectedBirthday && (
              <div className="flex items-center gap-2 rounded-lg bg-secondary/70 px-3 py-2.5 text-xs text-secondary-foreground">
                <MorphIcon icon={Sparkles} size={14} className="shrink-0 text-primary" />
                <span>Se han cargado los datos del cumpleaños guardado.</span>
              </div>
            )}

            <div className="mt-auto space-y-3 border-t border-border pt-5">
              <Button className="w-full sm:w-auto" onClick={startTest} disabled={!member || !guildId || starting || !emoji.trim() || !roleName.trim()}>
                <MorphIcon icon={starting ? LoaderCircle : Sparkles} size={16} className={starting ? 'animate-spin' : ''} />
                {starting ? 'Iniciando prueba…' : 'Iniciar prueba'}
              </Button>
              {error && <p className="text-sm text-red-300" role="alert">{error}</p>}
              {notice && <p className="flex items-start gap-2 text-sm text-emerald-300" role="status"><MorphIcon icon={ShieldCheck} size={16} className="mt-0.5 shrink-0" />{notice}</p>}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-4 border-b border-border p-5 sm:p-6">
          <div>
            <CardTitle>Pruebas activas</CardTitle>
            <CardDescription className="mt-2">Cancela una prueba para eliminar el rol y restaurar los canales al instante.</CardDescription>
          </div>
          <Badge variant="outline" className="shrink-0">{tests.length} activas</Badge>
        </CardHeader>
        <CardContent className="p-0">
          {tests.length === 0 ? (
            <div className="grid min-h-28 place-items-center px-6 py-8 text-center">
              <div>
                <div className="mx-auto mb-2 grid size-9 place-items-center rounded-full bg-secondary text-muted-foreground"><MorphIcon icon={Clock3} size={16} /></div>
                <p className="text-sm font-medium text-foreground">No hay pruebas activas</p>
                <p className="mt-1 text-xs text-muted-foreground">Cuando inicies una, aparecerá aquí.</p>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {tests.map((test) => (
                <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4 sm:px-6" key={test.test_id}>
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/10 text-lg">{test.emoji}</span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">{test.emoji} - {test.role_name}</p>
                      <p className="mt-1 truncate text-xs text-muted-foreground">Usuario {test.user_id} · termina {new Date(test.ends_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</p>
                    </div>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => cancelTest(test)} disabled={busyTestId === test.test_id}>
                    <MorphIcon icon={busyTestId === test.test_id ? LoaderCircle : RotateCcw} size={14} className={busyTestId === test.test_id ? 'animate-spin' : ''} />
                    Restaurar
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
