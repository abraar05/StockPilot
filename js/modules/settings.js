/**
 * modules/settings.js — personal settings and the sheet connection.
 */
window.SP = window.SP || {};
SP.modules = SP.modules || {};

SP.modules.settings = (() => {
  const MOD = {
    title: 'Settings',
    subtitle: () => `StockPilot v${SP.VERSION}`,
    mount,
  };

  async function mount(params) {
    if (params?.tab) setTimeout(() => scrollTo(params.tab), 200);
    const root = SP.el('div.stack.gap-5');
    const s = SP.store.state;
    const me = SP.auth.currentUser;

    /* ── Profile ──────────────────────────────────────────────────── */
    root.appendChild(SP.section('Your account', null,
      SP.el('div.card',
        SP.el('div.setting-row',
          SP.avatar(me, 'lg'),
          SP.el('div.setting-row__text',
            SP.el('strong', me?.name),
            SP.el('small', `${me?.email} · ${SP.auth.roleDef(me?.role).label}`),
          ),
        ),
        SP.el('div.setting-row',
          SP.el('div.setting-row__text',
            SP.el('strong', 'Default warehouse'),
            SP.el('small', 'Dashboards open on this site'),
          ),
          SP.el('div.setting-row__ctl',
            SP.el('select.select', {
              onchange: (e) => {
                SP.store.update(['prefs'], (st) => { st.prefs.warehouse = e.target.value; });
                SP.router.refresh();
              },
            },
              ...SP.store.state.warehouses.map((w) => SP.el('option', {
                value: w.id, selected: s.prefs.warehouse === w.id,
              }, w.label)),
            ),
          ),
        ),
        SP.el('div.setting-row',
          SP.el('div.setting-row__text',
            SP.el('strong', 'Change password'),
            SP.el('small', `Stored only on this device${SP.crypto.isPBKDF2() ? ' (PBKDF2-SHA256)' : ' (weak fallback — run on https)'}`),
          ),
          SP.el('div.setting-row__ctl',
            SP.el('button.btn.btn--sm.btn--ghost', { type: 'button', onclick: changePassword }, 'Change'),
          ),
        ),
        SP.el('div.setting-row',
          SP.el('div.setting-row__text',
            SP.el('strong', 'Recovery answer'),
            SP.el('small', me?.recovery ? 'Set — you can reset your password offline' : 'Not set — set one so you are never locked out'),
          ),
          SP.el('div.setting-row__ctl',
            SP.el('button.btn.btn--sm.btn--ghost', { type: 'button', onclick: setRecovery }, me?.recovery ? 'Change' : 'Set'),
          ),
        ),
        SP.el('div.setting-row',
          SP.el('div.setting-row__text',
            SP.el('strong', 'Sign out'),
            SP.el('small', SP.auth.sessionInfo() ? `Session from ${SP.auth.sessionInfo().device}` : ''),
          ),
          SP.el('div.setting-row__ctl',
            SP.el('button.btn.btn--sm.btn--ghost', {
              type: 'button',
              onclick: () => SP.app.signOut(),
            }, SP.icon('logout'), 'Sign out'),
          ),
        ),
      ),
    ));

    /* ── Appearance ───────────────────────────────────────────────── */
    root.appendChild(SP.section('Appearance', null,
      SP.el('div.card',
        SP.el('div.setting-row',
          SP.el('div.setting-row__text',
            SP.el('strong', 'Theme'),
            SP.el('small', 'Dark is easier on the eyes in a warehouse'),
          ),
          SP.el('div.setting-row__ctl',
            SP.el('div.seg.seg--sm', { style: { minWidth: '160px' } },
              ...[['dark', 'Dark', 'moon'], ['light', 'Light', 'sun'], ['auto', 'Auto', 'sparkles']].map(([v, l, ic]) =>
                SP.el('button.seg__btn', {
                  type: 'button',
                  class: (localStorage.getItem('stockpilot.themeMode') || s.prefs.theme) === v ? 'is-active' : '',
                  onclick: () => { SP.app.setThemeMode(v); SP.router.refresh(); },
                }, l)),
            ),
          ),
        ),
        SP.el('div.setting-row',
          SP.el('div.setting-row__text',
            SP.el('strong', 'Layout density'),
            SP.el('small', 'Compact shows more rows on a phone'),
          ),
          SP.el('div.setting-row__ctl',
            SP.el('select.select', {
              onchange: (e) => {
                SP.store.update(['prefs'], (st) => { st.prefs.density = e.target.value; });
                SP.app.applyTheme();
              },
            },
              ...['comfortable', 'compact'].map((d) => SP.el('option', {
                value: d, selected: s.prefs.density === d,
              }, d === 'comfortable' ? 'Comfortable' : 'Compact')),
            ),
          ),
        ),
      ),
    ));

    /* ── Notifications ────────────────────────────────────────────── */
    root.appendChild(SP.section('Alerts', 'How loudly StockPilot should interrupt you',
      SP.el('div.card',
        toggleRow('Enable alerts', 'Show badges and the notification centre',
          s.prefs.alerts.enabled, (v) => { SP.store.update(['prefs'], (st) => { st.prefs.alerts.enabled = v; }); }),
        toggleRow('Only critical alerts', 'Ignore “needs refill”, show only out-of-stock lines',
          s.prefs.alerts.onlyCritical, (v) => { SP.store.update(['prefs'], (st) => { st.prefs.alerts.onlyCritical = v; }); }),
        toggleRow('Browser notifications', 'Ask permission to show a system notification',
          s.prefs.alerts.desktop, async (v) => {
            if (v && 'Notification' in window) {
              const perm = await Notification.requestPermission();
              if (perm !== 'granted') {
                SP.ui.toast({ tone: 'warn', title: 'Permission denied', body: 'Your browser blocked notifications.' });
                return;
              }
            }
            SP.store.update(['prefs'], (st) => { st.prefs.alerts.desktop = v; });
          }),
      ),
    ));

    /* ── Google Sheet ─────────────────────────────────────────────── */
    root.appendChild(SP.section('Google Sheet', 'Read and write the source of truth', sheetCard()));

    /* ── Data ─────────────────────────────────────────────────────── */
    root.appendChild(SP.section('Data', null,
      SP.el('div.card',
        SP.el('div.setting-row',
          SP.el('div.setting-row__text',
            SP.el('strong', 'Export everything'),
            SP.el('small', 'Stock, ledger, orders and settings as JSON'),
          ),
          SP.el('div.setting-row__ctl',
            SP.el('button.btn.btn--sm.btn--ghost', {
              type: 'button',
              onclick: () => {
                SP.download(JSON.stringify(SP.store.exportBackup(), null, 2), `stockpilot-backup-${SP.fmt.date(Date.now())}.json`);
                SP.ui.toast({ tone: 'ok', title: 'Backup downloaded' });
              },
            }, SP.icon('download'), 'Backup'),
          ),
        ),
        SP.el('div.setting-row',
          SP.el('div.setting-row__text',
            SP.el('strong', 'Export stock as CSV'),
            SP.el('small', 'Same shape as the Google Sheet'),
          ),
          SP.el('div.setting-row__ctl',
            SP.el('button.btn.btn--sm.btn--ghost', {
              type: 'button', onclick: () => SP.modules.inventory.exportCsv(),
            }, SP.icon('download'), 'CSV'),
          ),
        ),
        SP.el('div.setting-row',
          SP.el('div.setting-row__text',
            SP.el('strong', 'Import a backup'),
            SP.el('small', 'Merge another device’s data into this one'),
          ),
          SP.el('div.setting-row__ctl',
            SP.el('button.btn.btn--sm.btn--ghost', {
              type: 'button',
              onclick: () => SP.router.go('admin', { tab: 'data' }),
            }, 'Open Admin'),
          ),
        ),
      ),
    ));

    /* ── About ────────────────────────────────────────────────────── */
    root.appendChild(SP.section('About', null,
      SP.el('div.card',
        SP.el('div.card__body.stack.gap-3',
          SP.el('div.row.gap-3',
            SP.el('span', { style: { color: 'var(--brand)' } },
              SP.el('svg', { viewBox: '0 0 48 48', width: 34, height: 34, html: '<use href="#glyph" />' })),
            SP.el('div.grow',
              SP.el('strong', 'StockPilot'),
              SP.el('p.tiny.mute', `Version ${SP.VERSION} · build ${SP.BUILD}`),
            ),
          ),
          SP.el('dl.kv',
            SP.el('dt', 'SKUs tracked'), SP.el('dd', SP.fmt.n(s.skus.length)),
            SP.el('dt', 'Sheet document'), SP.el('dd', SP.el('code', { style: { fontSize: '0.72rem' } }, SP.sheet.docId)),
            SP.el('dt', 'Crypto support'), SP.el('dd', SP.crypto.isPBKDF2() ? 'PBKDF2-SHA256' : 'Fallback (insecure context)'),
            SP.el('dt', 'Offline ready'), SP.el('dd', 'Yes'),
          ),
          SP.el('a.btn.btn--ghost.btn--sm', {
            href: SP.sheet.url, target: '_blank', rel: 'noopener',
          }, SP.icon('external'), 'Open the Google Sheet'),
          SP.el('button.btn.btn--ghost.btn--sm', {
            type: 'button', onclick: () => SP.router.go('help'),
          }, SP.icon('help'), 'Read the guide'),
        ),
      ),
    ));

    return root;

    function toggleRow(title, sub, value, onChange) {
      const input = SP.el('input', { type: 'checkbox', checked: value, onchange: (e) => onChange(e.target.checked) });
      return SP.el('label.switch', input,
        SP.el('span.switch__track'),
        SP.el('span.switch__text', SP.el('strong', title), SP.el('small', sub)),
      );
    }
  }

  /* ────────────────────────────────────────────────── sheet card */

  function sheetCard() {
    const s = SP.store.state;
    const status = SP.sheets.status();

    const urlInput = SP.el('input.input', {
      type: 'url', value: s.sheet.bridgeUrl || '', placeholder: 'https://script.google.com/macros/s/…/exec',
      spellcheck: 'false',
    });

    const stateNode = SP.el('span.tag', {
      class: status.mode === 'live' ? 'tag--u-green' : status.mode === 'error' ? 'tag--danger' : status.tag || 'tag--mute',
    }, status.mode);

    return SP.el('div.card',
      SP.el('div.card__body.stack.gap-3',
        SP.el('div.row.gap-2',
          SP.el('div.grow',
            SP.el('strong', { style: { fontSize: 'var(--fs-md)' } }, 'Connection status'),
            SP.el('p.tiny.mute',
              status.lastSync ? `Last synced ${SP.fmt.ago(status.lastSync)}` : 'Using the bundled snapshot'),
          ),
          stateNode,
        ),

        status.pending ? SP.el('div.callout', { dataset: { tone: 'warn' } },
          SP.el('span.callout__ico', SP.icon('upload')),
          SP.el('div.callout__body',
            SP.el('strong', `${SP.fmt.pluralise(status.pending, 'change')} waiting to sync`),
            SP.el('p', 'Connect the Apps Script bridge to push these to the sheet.'),
          ),
        ) : null,

        s.sheet.error ? SP.el('div.callout', { dataset: { tone: 'danger' } },
          SP.el('span.callout__ico', SP.icon('alert')),
          SP.el('div.callout__body', SP.el('strong', 'Last error'), SP.el('p', s.sheet.error)),
        ) : null,

        SP.el('div.field',
          SP.el('label.field__label', 'Apps Script bridge URL'),
          urlInput,
          SP.el('p.field__hint', 'Deploy gas/Code.gs as a web app, then paste the /exec URL here. Setup guide in README.md.'),
        ),

        SP.el('div.row.gap-2.row--wrap',
          SP.el('button.btn.btn--primary.btn--sm', {
            type: 'button',
            onclick: async (e) => {
              const b = e.currentTarget;
              SP.sheets.setBridge(urlInput.value);
              localStorage.setItem('stockpilot.bridge', urlInput.value);
              b.setAttribute('aria-busy', 'true');
              const res = await SP.sheets.testBridge();
              b.removeAttribute('aria-busy');
              SP.ui.toast(res.ok
                ? { tone: 'ok', title: 'Bridge connected', body: 'Live read and write are now enabled.' }
                : { tone: 'danger', title: 'Could not connect', body: res.error });
              SP.router.refresh();
            },
          }, SP.icon('link'), 'Save & test'),
          SP.el('button.btn.btn--ghost.btn--sm', {
            type: 'button',
            onclick: async (e) => {
              const b = e.currentTarget;
              b.setAttribute('aria-busy', 'true');
              const res = await SP.sheets.refresh();
              b.removeAttribute('aria-busy');
              SP.ui.toast(res.ok
                ? { tone: 'ok', title: 'Synced', body: `${res.count} SKUs read.` }
                : { tone: 'warn', title: 'Sync failed', body: res.error });
            },
          }, SP.icon('refresh'), 'Sync now'),
          SP.el('button.btn.btn--ghost.btn--sm', {
            type: 'button',
            onclick: () => {
              SP.sheets.setBridge('');
              localStorage.removeItem('stockpilot.bridge');
              SP.ui.toast({ tone: 'info', title: 'Disconnected', body: 'Back to snapshot mode.' });
              SP.router.refresh();
            },
          }, 'Disconnect'),
        ),

        SP.el('div.field',
          SP.el('label.field__label', 'Automatic sync interval'),
          SP.el('select.select', {
            onchange: (e) => {
              const v = Number(e.target.value);
              SP.store.update(['sheet'], (st) => { st.sheet.autoSyncMinutes = v; });
              SP.sheets.startAutoSync();
            },
          },
            ...[[5, 'Every 5 minutes'], [15, 'Every 15 minutes'], [30, 'Every 30 minutes'], [60, 'Every hour'], [0, 'Manual only']]
              .map(([v, l]) => SP.el('option', {
                value: v, selected: (SP.sheet.autoSyncMinutes) === v,
              }, l)),
          ),
        ),
      ),
    );
  }

  /* ─────────────────────────────────────────────────── password */

  async function changePassword() {
    await SP.modal({
      title: 'Change your password',
      subtitle: 'You stay signed in on this device.',
      icon: 'key',
      fields: [
        { key: 'old', label: 'Current password', type: 'password', required: true },
        { key: 'next', label: 'New password', type: 'password', required: true, hint: 'At least 8 characters with a mix of types.' },
        { key: 'confirm', label: 'Confirm new password', type: 'password', required: true },
      ],
      okLabel: 'Update password',
      onOk: async (v) => {
        if (v.next !== v.confirm) throw new Error('The new passwords do not match.');
        await SP.auth.changeOwnPassword(v.old, v.next);
        SP.ui.toast({ tone: 'ok', title: 'Password updated' });
      },
    });
  }

  async function setRecovery() {
    const res = await SP.modal({
      title: 'Set a recovery answer',
      subtitle: 'Used to reset your password if you forget it on this device.',
      icon: 'help',
      fields: [
        { key: 'question', label: 'Question', type: 'select', value: 'First street you lived on', options: [
          'First street you lived on', 'Your first pet’s name', 'Your favourite teacher', 'The city you were born in',
        ].map((q) => ({ value: q, label: q })) },
        { key: 'answer', label: 'Answer', required: true, hint: 'Answers are matched case-insensitively.' },
      ],
      okLabel: 'Save answer',
      onOk: (v) => {
        SP.auth.setRecovery(v.question, v.answer);
        SP.ui.toast({ tone: 'ok', title: 'Recovery answer saved' });
      },
    });
    void res;
  }

  return { ...MOD };
})();