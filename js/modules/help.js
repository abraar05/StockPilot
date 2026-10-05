/**
 * modules/help.js — in-app guidance, keyboard shortcuts and first-run tour.
 */
window.SP = window.SP || {};
SP.modules = SP.modules || {};

SP.modules.help = (() => {
  const MOD = {
    title: 'Help & Tips',
    subtitle: 'Get more out of StockPilot',
    mount,
  };

  async function mount() {
    const root = SP.el('div.stack.gap-5');
    const s = SP.store.state;

    /* ── Intro ────────────────────────────────────────────────────── */
    root.appendChild(SP.el('div.hero',
      SP.el('div.hero__eyebrow', SP.icon('help'), 'Guide'),
      SP.el('div',
        SP.el('div', { style: { fontSize: 'var(--fs-2xl)', fontWeight: '750', letterSpacing: '-0.03em' } }, 'How StockPilot thinks'),
        SP.el('p.hero__sub',
          'Every number on the dashboard comes from one rule set, so what you see in the app always matches what you write to the sheet.'),
      ),
    ));

    /* ── The rule ─────────────────────────────────────────────────── */
    root.appendChild(SP.section('The refill decision rule', 'The same rule your spreadsheet uses',
      SP.el('div.card',
        SP.el('div.card__body.stack.gap-3',
          SP.el('div.bands',
            SP.el('div.band.band--red',
              SP.el('span.band__n', '0'),
              SP.el('span.band__t', 'Restock'),
              SP.el('span.band__d', 'Buy now — every sale is lost until stock arrives'),
            ),
            SP.el('div.band.band--amber',
              SP.el('span.band__n', `1–${s.rules.refillMax}`),
              SP.el('span.band__t', 'Refill'),
              SP.el('span.band__d', 'Plan a top-up to hold roughly four weeks of cover'),
            ),
            SP.el('div.band.band--green',
              SP.el('span.band__n', `>${s.rules.refillMax}`),
              SP.el('span.band__t', 'Adequate'),
              SP.el('span.band__d', 'Do not spend — capital is better used elsewhere'),
            ),
          ),
          SP.el('p.tiny.mute',
            `The reorder line is configurable. Admins can change it in Admin Console → Rules, which re-scores every line instantly.`),
        ),
      ),
    ));

    /* ── A day in the life ────────────────────────────────────────── */
    root.appendChild(SP.section('A typical day', 'Suggested workflow',
      SP.el('div.card',
        SP.el('div.card__body.guide',
          step(1, 'Start on the ', SP.el('strong', 'Dashboard'), '. The hero number is units on hand; the three bands below it split the catalogue by urgency.'),
          step(2, 'Check ', SP.el('strong', 'Smart recommendations'), '. If stock sits at another site, transfer it — that is almost always cheaper than buying.'),
          step(3, 'Open ', SP.el('strong', 'Refill Radar'), '. Set a budget ceiling and the list re-ranks to show what that budget can actually fund.'),
          step(4, 'Turn the queue into a ', SP.el('strong', 'purchase order'), '. Quantities are pre-sized; uncheck anything you are not buying yet.'),
          step(5, 'Record dispatches in the ', SP.el('strong', 'Dispatch Log'), '. This is what unlocks velocity, cover forecasts and dead-stock detection.'),
          step(6, 'Review ', SP.el('strong', 'Insights'), ' once a week for capital tied up in slow movers and any data-quality drift.'),
        ),
      ),
    ));

    /* ── Shortcuts ────────────────────────────────────────────────── */
    root.appendChild(SP.section('Shortcuts', 'Faster on a laptop, harmless on a phone',
      SP.el('div.card',
        SP.el('div.card__body',
          SP.el('dl.kv.kv--stack',
            ...[
              ['Search everything', ['Ctrl', 'K']],
              ['Close any dialog', ['Esc']],
              ['Move through the command palette', ['↑', '↓']],
              ['Open the highlighted result', ['Enter']],
            ].map(([label, keys]) => SP.el('div.row', { style: { alignItems: 'center' } },
              SP.el('dt.grow', { style: { marginTop: 0 } }, label),
              SP.el('dd.right', SP.el('span.row.gap-1', { style: { justifyContent: 'flex-end' } },
                ...keys.map((k) => SP.el('kbd', k)))),
            )),
          ),
        ),
      ),
    ));

    /* ── Tips ─────────────────────────────────────────────────────── */
    root.appendChild(SP.section('Tips', 'Reset any tip you have dismissed',
      SP.el('div.card',
        SP.el('div.card__body.stack.gap-3',
          ...SP.TIPS.map((t) => SP.el('div.tipcard',
            SP.el('span.tipcard__ico', '💡'),
            SP.el('div.tipcard__body',
              SP.el('strong', t.text),
              SP.el('p.tiny.mute', `Appears in ${t.where}`),
            ),
            SP.el('button.btn.btn--icon.btn--sm.btn--quiet', {
              type: 'button', 'aria-label': 'Show this tip again',
              onclick: (e) => {
                SP.store.update(['prefs'], (st) => {
                  st.prefs.seenTips = st.prefs.seenTips.filter((x) => x !== t.id);
                });
                e.currentTarget.closest('.tipcard').remove();
                SP.ui.toast({ tone: 'ok', title: 'Tip restored', body: `It will show again in ${t.where}.` });
              },
            }, SP.icon('refresh')),
          )),
          SP.el('button.btn.btn--ghost.btn--block', {
            type: 'button',
            onclick: () => {
              SP.store.update(['prefs'], (st) => { st.prefs.seenTips = []; });
              SP.ui.toast({ tone: 'ok', title: 'All tips restored' });
              SP.router.refresh();
            },
          }, SP.icon('refresh'), 'Restore every tip'),
        ),
      ),
    ));

    /* ── FAQ ──────────────────────────────────────────────────────── */
    root.appendChild(SP.section('Questions', null,
      SP.el('div.card',
        SP.el('div.card__body.stack.gap-2',
          faq('Why can’t I write to the Google Sheet from the browser?',
            'A web page cannot authenticate to Google Sheets. Writing needs a small server-side helper — that is what gas/Code.gs is. Deploy it as an Apps Script web app and paste the URL into Settings → Google Sheet. Until then StockPilot runs on the bundled snapshot and queues your changes.'),
          faq('Where is my data stored?',
            'In this browser’s localStorage. Nothing is sent anywhere unless you connect the bridge. That means data is per-device — use Admin → Data → Full export before switching phones or clearing your browser.'),
          faq('Someone forgot their password.',
            'Admins can reset it from Admin Console → Users. If the person is locked out entirely, an admin can reset from another account and revoke their sessions.'),
          faq('The app shows stale numbers.',
            'Hit Sync now in Settings, or check the connection pill at the bottom of the sidebar. If the bridge is down the app keeps showing the last good read rather than blanking out.'),
          faq('Can two people edit at once?',
            'Yes within one browser profile, but each device keeps its own copy. For multi-device editing, connect the bridge and sync — or use Apps Script as the host so everyone loads the same build.'),
          faq('How are order quantities chosen?',
            `StockPilot targets ${s.rules.targetCoverWeeks} weeks of cover, subtracts anything already on order or in transit, rounds up to a practical pack multiple, and pulls in transferable stock before proposing a purchase.`),
        ),
      ),
    ));

    /* ── Setup ────────────────────────────────────────────────────── */
    root.appendChild(SP.section('Connect the Google Sheet', 'Optional, but needed for live write-back',
      SP.el('div.card',
        SP.el('div.card__body.guide',
          step(1, 'Open the source sheet and choose ', SP.el('strong', 'Extensions → Apps Script'), '.'),
          step(2, 'Replace the contents with the code from ', SP.el('code', 'gas/Code.gs'), ' and save.'),
          step(3, 'Deploy → ', SP.el('strong', 'New deployment'), ' → type ', SP.el('strong', 'Web app'), '. Execute as yourself; grant access to anyone with the link.'),
          step(4, 'Copy the ', SP.el('code', '/exec'), ' URL and paste it into Settings → Google Sheet.'),
          step(5, 'Press ', SP.el('strong', 'Save & test'), '. The status pill turns green once connected.'),
        ),
      ),
    ));

    /* ── Support ──────────────────────────────────────────────────── */
    root.appendChild(SP.section('Diagnostics', 'Helpful when something looks wrong',
      SP.el('div.grid.grid--2',
        SP.el('button.btn.btn--ghost', {
          type: 'button',
          onclick: () => {
            const info = {
              version: SP.VERSION,
              build: SP.BUILD,
              userAgent: navigator.userAgent,
              secureContext: window.isSecureContext,
              crypto: SP.crypto.isPBKDF2() ? 'PBKDF2-SHA256' : 'fallback',
              online: navigator.onLine,
              bridge: SP.sheets.bridgeReady(),
              bridgeOk: SP.sheets.bridgeHealthy(),
              sheetMode: SP.store.state.sheet.mode,
              pendingOps: SP.store.state.pendingOps.length,
              skus: SP.store.state.skus.length,
              hash: location.hash,
            };
            SP.copy(JSON.stringify(info, null, 2), 'Diagnostics copied');
          },
        }, SP.icon('copy'), 'Copy diagnostics'),
        SP.el('button.btn.btn--ghost', {
          type: 'button', onclick: () => SP.router.go('insights', { tab: 'quality' }),
        }, SP.icon('checkCircle'), 'Run data health check'),
      ),
    ));

    return root;

    function step(n, ...parts) {
      return SP.el('div.guide__step',
        SP.el('span.guide__n', String(n)),
        SP.el('p', ...parts),
      );
    }

    function faq(q, a) {
      const answer = SP.el('p.tiny.mute', { style: { marginTop: '4px', display: 'none' } }, a);
      return SP.el('div', {
        style: { padding: 'var(--sp-3) 0', borderBottom: '1px solid var(--line-soft)' },
      },
        SP.el('button', {
          type: 'button',
          style: { display: 'flex', gap: '8px', width: '100%', textAlign: 'left', alignItems: 'center' },
          onclick: (e) => {
            const open = answer.style.display !== 'none';
            answer.style.display = open ? 'none' : 'block';
            e.currentTarget.querySelector('svg').style.transform = open ? '' : 'rotate(180deg)';
          },
        },
          SP.el('strong', { style: { flex: 1, fontSize: 'var(--fs-md)' } }, q),
          SP.el('span', { style: { color: 'var(--text-mute)', transition: 'transform .2s' } }, SP.icon('chevronDown')),
        ),
        answer,
      );
    }
  }

  return { ...MOD };
})();