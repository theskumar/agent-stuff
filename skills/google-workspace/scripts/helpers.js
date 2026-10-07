// Task helpers exposed inside `exec` as workspace.gmail and workspace.calendar.
// Each returns small, flat JSON so scripts stay short and output stays cheap.

function decode(data) {
  return Buffer.from(String(data).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function stripHtml(html) {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#39;|&rsquo;/g, "'").replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// Plain-text body of a message payload; falls back to stripped HTML.
function bodyText(payload) {
  const found = {};
  (function walk(p) {
    if (!p) return;
    if (p.body && p.body.data && !found[p.mimeType]) found[p.mimeType] = decode(p.body.data);
    (p.parts || []).forEach(walk);
  })(payload);
  if (found['text/plain']) return found['text/plain'].trim();
  if (found['text/html']) return stripHtml(found['text/html']);
  return '';
}

// "+05:30" for a time zone at a given date.
function tzOffset(tz, date = new Date()) {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })
    .formatToParts(date).find((x) => x.type === 'timeZoneName').value;
  const m = name.match(/GMT([+-]\d{2}):?(\d{2})?/);
  return m ? `${m[1]}:${m[2] || '00'}` : '+00:00';
}

function createHelpers(ws) {
  let tzCache;
  async function tz(opt) {
    if (opt) return opt;
    if (!tzCache) tzCache = (await ws.call('calendar', 'settings.get', { setting: 'timezone' })).value;
    return tzCache;
  }
  // 'YYYY-MM-DD' -> day start/end in tz; full ISO strings pass through.
  async function range(from, to, zone) {
    const z = await tz(zone);
    const iso = (d, end) => (/^\d{4}-\d{2}-\d{2}$/.test(d)
      ? `${d}T${end ? '23:59:59' : '00:00:00'}${tzOffset(z, new Date(`${d}T12:00:00Z`))}` : d);
    return { timeMin: iso(from), timeMax: iso(to || from, true), timeZone: z };
  }

  const gmail = {
    // search('from:x newer_than:2d', { max: 20, body: false, maxChars: 4000 })
    async search(q, { max = 20, body = false, maxChars = 4000 } = {}) {
      const list = await ws.call('gmail', 'users.messages.list', { userId: 'me', q, maxResults: max });
      return Promise.all((list.messages || []).map((m) => gmail.read(m.id, { body, maxChars })));
    },
    async read(id, { body = true, maxChars = 20000 } = {}) {
      const g = await ws.call('gmail', 'users.messages.get', body
        ? { userId: 'me', id, format: 'full' }
        : { userId: 'me', id, format: 'metadata', metadataHeaders: ['From', 'To', 'Subject', 'Date'] });
      const h = {};
      (g.payload.headers || []).forEach((x) => { h[x.name] = x.value; });
      const out = { id, threadId: g.threadId, from: h.From, subject: h.Subject, date: h.Date, snippet: g.snippet };
      if (body) out.text = bodyText(g.payload).slice(0, maxChars);
      return out;
    },
  };

  const calendar = {
    // events('2026-10-07') or events(fromISO, toISO)
    async events(from, to, { calendarId = 'primary', timeZone } = {}) {
      const r = await ws.call('calendar', 'events.list', {
        calendarId, singleEvents: true, orderBy: 'startTime', maxResults: 250, ...(await range(from, to, timeZone)),
      });
      return (r.items || []).map((e) => ({
        id: e.id,
        start: e.start.dateTime || e.start.date,
        end: e.end && (e.end.dateTime || e.end.date),
        title: e.summary,
        organizer: e.organizer && e.organizer.email,
        myResponse: ((e.attendees || []).find((a) => a.self) || {}).responseStatus,
        attendees: (e.attendees || []).map((a) => `${a.email}:${a.responseStatus}`),
        meet: e.hangoutLink,
        colorId: e.colorId,
      }));
    },

    // free({ emails: ['a@x.com'], from: '2026-10-07T14:00:00+05:30', to: '...', minMins: 30 })
    // Common free windows for you plus `emails`.
    async free({ emails = [], from, to, minMins = 30, timeZone } = {}) {
      const r = await range(from, to, timeZone);
      const ids = [...new Set([ws.accountEmail, ...emails])];
      const fb = await ws.call('calendar', 'freebusy.query', {
        requestBody: { ...r, items: ids.map((id) => ({ id })) },
      });
      const busy = Object.values(fb.calendars).flatMap((c) => c.busy || [])
        .map((b) => [Date.parse(b.start), Date.parse(b.end)]).sort((a, b) => a[0] - b[0]);
      const off = tzOffset(r.timeZone, new Date(r.timeMin));
      const offMs = (off[0] === '-' ? -1 : 1) * (Number(off.slice(1, 3)) * 60 + Number(off.slice(4, 6))) * 60000;
      const fmt = (t) => new Date(t + offMs).toISOString().slice(0, 16) + off;
      const slots = [];
      let cur = Date.parse(r.timeMin);
      for (const [s, e] of [...busy, [Date.parse(r.timeMax), Date.parse(r.timeMax)]]) {
        if (s - cur >= minMins * 60000) slots.push({ start: fmt(cur), end: fmt(s), mins: Math.round((s - cur) / 60000) });
        cur = Math.max(cur, e);
      }
      const errors = Object.entries(fb.calendars).filter(([, c]) => c.errors).map(([id]) => id);
      return { slots, ...(errors.length ? { unknownCalendars: errors } : {}) };
    },

    // create({ title, start: ISO, mins: 30, attendees: ['a@x.com'], meet: true, description, colorId, notify: true })
    async create({ title, start, mins = 30, end, attendees = [], meet = true, description, colorId, notify = true, calendarId = 'primary' }) {
      const endIso = end || new Date(Date.parse(start) + mins * 60000).toISOString();
      const ev = await ws.call('calendar', 'events.insert', {
        calendarId,
        sendUpdates: notify ? 'all' : 'none',
        conferenceDataVersion: meet ? 1 : 0,
        requestBody: {
          summary: title,
          description,
          colorId,
          start: { dateTime: start },
          end: { dateTime: endIso },
          attendees: attendees.map((email) => ({ email })),
          ...(meet ? { conferenceData: { createRequest: { requestId: `gw-${Date.now()}`, conferenceSolutionKey: { type: 'hangoutsMeet' } } } } : {}),
        },
      });
      return { id: ev.id, link: ev.htmlLink, meet: ev.hangoutLink, start: ev.start, end: ev.end };
    },
  };

  return { gmail, calendar };
}

module.exports = { createHelpers, bodyText, stripHtml, tzOffset };
