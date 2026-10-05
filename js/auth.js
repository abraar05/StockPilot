/**
 * auth.js — users, roles, sessions, lockout and the sign-in gate.
 *
 * Security model
 *  - Passwords are stored only as PBKDF2-SHA256 verifiers (120k iterations)
 *    in localStorage; plaintext is never persisted.
 *  - Sessions carry an expiry, a device label and a revocable token.
 *  - Repeated failures lock an account for a cooling-off period.
 *  - When an Apps Script bridge is configured, `verifyRemote` is consulted so
 *    credentials are checked server-side instead.
 *
 * IMPORTANT: a browser-only deployment cannot be a true security boundary.
 * Deploy the Apps Script bridge (README → "Harden for production") and run the
 * app behind your IdP for real protection.
 */
window.SP = window.SP || {};

SP.auth = (() => {
  const SESSION_KEY = SP.SESSION_KEY;
  const MAX_ATTEMPTS = 5;
  const LOCK_MS = 60 * 1000;
  const SESSION_MS = 12 * 60 * 60 * 1000;      // 12 hours
  const REMEMBER_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

  let current = null;
  let session = null;
  const failures = new Map();   // email → { count, until }

  /* ─────────────────────────────────────────────────────── bootstrap */

  /** Seed the first admin so the app is reachable on first run. */
  async function ensureSeedUsers() {
    const s = SP.store.state;
    if (s.users.length) return;

    const mk = async (name, email, role, password, pin, wh) => {
      const rec = await SP.crypto.hashPassword(password);
      const pinRec = pin ? await SP.crypto.hashPin(pin) : null;
      return {
        id: SP.uid('usr'),
        name,
        email: email.toLowerCase(),
        role,
        warehouse: wh,
        password: rec,
        pin: pinRec,
        active: true,
        mustChangePassword: role === 'admin' && email.includes('admin@'),
        createdAt: Date.now(),
        lastLoginAt: null,
        failedCount: 0,
        lockedUntil: 0,
        sessions: [],
        colour: '#5b8cff',
      };
    };

    s.users.push(
      await mk('Abraar Ahmed', 'admin@stockpilot.app', 'admin', 'Admin@1234', null, 'MAIN'),
      await mk('Ahad Shad', 'manager@stockpilot.app', 'manager', 'Manager@123', '2468', 'MAIN'),
      await mk('Alpana Store', 'alpana@stockpilot.app', 'storekeeper', 'Store@1234', '1357', 'ALPANA'),
      await mk('Nazrul Store', 'nazrul@stockpilot.app', 'storekeeper', 'Store@1234', '9753', 'NAZRUL'),
      await mk('Read-only Guest', 'viewer@stockpilot.app', 'viewer', 'Viewer@123', '0000', 'ADMIN'),
    );
    SP.store.saveNow();
    console.info('[auth] seeded demo accounts — change them before production use.');
  }

  /* ─────────────────────────────────────────────────────── lookup */

  const byEmail = (email) => SP.store.state.users
    .find((u) => u.email === String(email || '').trim().toLowerCase());

  const byId = (id) => SP.store.state.users.find((u) => u.id === id);

  const current_ = () => current;
  const isSignedIn = () => !!current;

  const roleOf = (user) => SP.store.state.users.find((u) => u.id === user.id)?.role
    || user?.role || 'viewer';

  const roleDef = (roleId) => SP.ROLES.find((r) => r.id === roleId) || SP.ROLES[0];

  /** Effective permission list for a role. */
  const permsOf = (roleId) => roleDef(roleId).perms;

  const can = (perm, user = current) => {
    if (!user) return false;
    const perms = permsOf(roleOf(user));
    return perms.includes('*') || perms.includes(perm);
  };

  /** Warehouses the user may write to. */
  const scopeOf = (user = current) => {
    if (!user) return [];
    if (can('edit:anywhere', user) || can('manage:users', user)) {
      return SP.store.state.warehouses.map((w) => w.id);
    }
    const u = byId(user.id);
    return u?.warehouse ? [u.warehouse] : [];
  };

  /* ────────────────────────────────────────────────────── sessions */

  function persistSession() {
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch { /* noop */ }
    try { localStorage.setItem(`${SESSION_KEY}.remember`, JSON.stringify(session)); } catch { /* noop */ }
  }

  function readSession(remember) {
    const raw = (remember ? localStorage : sessionStorage).getItem(`${SESSION_KEY}${remember ? '.remember' : ''}`);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }

  function clearStoredSession() {
    sessionStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(`${SESSION_KEY}.remember`);
  }

  function deviceLabel() {
    const ua = navigator.userAgent;
    const os = /Android/i.test(ua) ? 'Android'
      : /iPhone|iPad|iPod/i.test(ua) ? 'iOS'
        : /Windows/i.test(ua) ? 'Windows'
          : /Mac/i.test(ua) ? 'macOS' : /Linux/i.test(ua) ? 'Linux' : 'Unknown OS';
    const br = /Edg\//.test(ua) ? 'Edge'
      : /OPR\//.test(ua) ? 'Opera'
        : /Chrome\//.test(ua) ? 'Chrome'
          : /Safari\//.test(ua) ? 'Safari' : 'Firefox';
    return `${os} · ${br}`;
  }

  /** Restore an unexpired session, verifying the user is still active. */
  async function restore() {
    let s = readSession(false) || readSession(true);
    if (!s || !s.expiresAt) return null;
    if (s.expiresAt < Date.now()) { clearStoredSession(); return null; }

    const user = byId(s.userId);
    if (!user || !user.active) { clearStoredSession(); return null; }
    if (user.lockedUntil && user.lockedUntil > Date.now()) { clearStoredSession(); return null; }

    // token must still be present on the user record (allows remote revocation)
    if (Array.isArray(user.sessions) && user.sessions.length
      && !user.sessions.some((x) => x.token === s.token)) {
      clearStoredSession();
      return null;
    }

    current = user;
    session = s;
    applyPrefs(user);
    return user;
  }

  function rememberMeWanted() {
    try { return !!localStorage.getItem(`${SESSION_KEY}.remember`); } catch { return false; }
  }

  /* ─────────────────────────────────────────────────────── sign in */

  /**
   * @returns {Promise<{ok:boolean, user?:object, error?:string}>}
   */
  async function signIn(email, password, opts = {}) {
    const mail = String(email || '').trim().toLowerCase();
    const fail = failures.get(mail) || { count: 0, until: 0 };

    if (fail.until > Date.now()) {
      const secs = Math.ceil((fail.until - Date.now()) / 1000);
      return { ok: false, error: `Too many attempts. Try again in ${secs}s.` };
    }

    const user = byEmail(mail);
    const generic = 'Email or password is incorrect.';

    if (!user) {
      // Spend comparable time so timing does not reveal account existence.
      await SP.crypto.hashPassword(password || '', 'AAAAAAAAAAAAAAAAAAAAAA==');
      bumpFailure(mail);
      return { ok: false, error: generic };
    }
    if (!user.active) return { ok: false, error: 'This account has been deactivated.' };
    if (user.lockedUntil && user.lockedUntil > Date.now()) {
      const secs = Math.ceil((user.lockedUntil - Date.now()) / 1000);
      return { ok: false, error: `Account locked. Try again in ${secs}s.` };
    }

    // Optional server-side verification when the bridge is configured.
    let verified = false;
    if (SP.sheets?.bridgeReady() && opts.allowRemote !== false) {
      try {
        const res = await SP.sheets.verifyCredentials(mail, password);
        if (res && res.ok) verified = true;
        else if (res && res.error) return { ok: false, error: res.error };
      } catch { /* fall through to local check */ }
    }

    if (!verified) {
      const ok = await SP.crypto.verifyRecord(user.password, password);
      if (!ok) {
        bumpFailure(mail);
        const n = (failures.get(mail)?.count || 0);
        return {
          ok: false,
          error: n >= MAX_ATTEMPTS - 1
            ? 'Too many failed attempts. Account locked for 60s.'
            : generic,
        };
      }
    }

    failures.delete(mail);
    return { ok: true, user: await completeSignIn(user, { remember: opts.remember }) };
  }

  function bumpFailure(mail) {
    const rec = failures.get(mail) || { count: 0, until: 0 };
    rec.count += 1;
    if (rec.count >= MAX_ATTEMPTS) {
      rec.until = Date.now() + LOCK_MS;
      rec.count = 0;
      const u = byEmail(mail);
      if (u) {
        SP.store.update(['users'], (st) => {
          const t = st.users.find((x) => x.id === u.id);
          if (t) { t.failedCount = (t.failedCount || 0) + MAX_ATTEMPTS; t.lockedUntil = Date.now() + LOCK_MS; }
        });
      }
      SP.store.audit('auth.lockout', mail, `Locked after ${MAX_ATTEMPTS} failed attempts`);
      SP.store.notify({
        tone: 'danger', title: 'Repeated sign-in failures',
        body: `${mail} was locked after ${MAX_ATTEMPTS} unsuccessful attempts.`,
      });
    }
    failures.set(mail, rec);
  }

  async function completeSignIn(user, { remember, viaPin = false } = {}) {
    const token = SP.crypto.randomToken();
    const now = Date.now();
    const lifetime = remember ? REMEMBER_MS : SESSION_MS;

    session = {
      token,
      userId: user.id,
      startedAt: now,
      expiresAt: now + lifetime,
      device: deviceLabel(),
      viaPin,
      remember: !!remember,
    };
    current = user;
    persistSession();

    SP.store.update(['users'], (st) => {
      const t = st.users.find((x) => x.id === user.id);
      if (!t) return;
      t.lastLoginAt = now;
      t.failedCount = 0;
      t.lockedUntil = 0;
      t.sessions = (t.sessions || []).filter((x) => x.expiresAt > now);
      t.sessions.push({ token, startedAt: now, expiresAt: now + lifetime, device: session.device });
      if (t.sessions.length > 8) t.sessions = t.sessions.slice(-8);
    });

    SP.store.audit('auth.signin', user.email, `${session.device}${viaPin ? ' · PIN' : ''}`);
    applyPrefs(user);
    return current;
  }

  /** Sign in with a stored PIN after the user picks a profile. */
  async function signInWithPin(userId, pin) {
    const user = byId(userId);
    if (!user) return { ok: false, error: 'Profile not found.' };
    if (!user.pin) return { ok: false, error: 'No PIN is set for this profile. Use your password.' };
    if (!user.active) return { ok: false, error: 'This account has been deactivated.' };
    if (user.lockedUntil && user.lockedUntil > Date.now()) {
      return { ok: false, error: 'Account locked. Use your password instead.' };
    }
    const ok = await SP.crypto.verifyRecord(user.pin, pin);
    if (!ok) {
      bumpFailure(user.email);
      return { ok: false, error: 'Incorrect PIN.' };
    }
    failures.delete(user.email);
    return { ok: true, user: await completeSignIn(user, { remember: rememberMeWanted(), viaPin: true }) };
  }

  /** Apply the signed-in user's preferences to the document. */
  function applyPrefs(user) {
    const u = byId(user.id);
    const prefs = u?.prefs;
    SP.store.update(['prefs'], (st) => {
      if (prefs) {
        st.prefs = { ...st.prefs, ...prefs };
        return;
      }
      // No saved preferences: inherit the account's default site so each
      // person opens on the warehouse they actually look after.
      if (u?.warehouse && st.warehouses.some((w) => w.id === u.warehouse)) {
        st.prefs.warehouse = u.warehouse;
      }
      if (u?.role && u.role !== 'admin') st.prefs.role = u.role;
    }, { silent: true });
    SP.app?.applyTheme?.();
  }

  /* ────────────────────────────────────────────────────────── out */

  function signOut({ all = false } = {}) {
    const user = current;
    if (user) {
      SP.store.update(['users'], (st) => {
        const t = st.users.find((x) => x.id === user.id);
        if (!t) return;
        if (all) t.sessions = [];
        else t.sessions = (t.sessions || []).filter((x) => x.token !== session?.token);
      });
      SP.store.audit('auth.signout', user.email, all ? 'All devices' : session?.device || '');
    }
    clearStoredSession();
    current = null;
    session = null;
  }

  /* ──────────────────────────────────────────────── user management */

  async function createUser(data) {
    const email = String(data.email || '').trim().toLowerCase();
    if (byEmail(email)) throw new Error('A user with that email already exists.');
    if (!data.name || !String(data.name).trim()) throw new Error('Name is required.');
    const strength = SP.crypto.strength(data.password);
    if (strength.score < 2) throw new Error('Choose a stronger password (at least 8 characters).');

    const rec = await SP.crypto.hashPassword(data.password);
    const pinRec = /^\d{4}$/.test(String(data.pin || ''))
      ? await SP.crypto.hashPin(String(data.pin)) : null;

    const user = {
      id: SP.uid('usr'),
      name: String(data.name).trim(),
      email,
      role: data.role || 'viewer',
      warehouse: data.warehouse || 'MAIN',
      password: rec,
      pin: pinRec,
      active: true,
      mustChangePassword: !!data.mustChangePassword,
      createdAt: Date.now(),
      lastLoginAt: null,
      failedCount: 0,
      lockedUntil: 0,
      sessions: [],
      colour: data.colour || randomColour(),
      prefs: data.prefs || null,
    };

    SP.store.update(['users'], (st) => { st.users.push(user); });
    SP.store.audit('user.create', email, `role=${user.role} · wh=${user.warehouse}`);
    SP.store.notify({
      tone: 'ok', title: 'Account created',
      body: `${user.name} can now sign in as ${roleDef(user.role).label}.`,
    });
    return user;
  }

  async function updateUser(id, patch) {
    const u = byId(id);
    if (!u) throw new Error('User not found.');

    if (patch.email && patch.email !== u.email) {
      if (byEmail(patch.email)) throw new Error('That email is already in use.');
    }
    if (patch.password) {
      const s = SP.crypto.strength(patch.password);
      if (s.score < 2) throw new Error('Choose a stronger password.');
      patch.password = await SP.crypto.hashPassword(patch.password);
      patch.mustChangePassword = false;
    }
    if (patch.pin !== undefined) {
      patch.pin = patch.pin === '' || patch.pin === null
        ? null
        : await SP.crypto.hashPin(String(patch.pin));
    }
    if (patch.role && u.id === current?.id && patch.role !== 'admin') {
      const admins = SP.store.state.users.filter((x) => x.role === 'admin' && x.active);
      if (admins.length <= 1) throw new Error('You cannot remove the last active admin.');
    }

    SP.store.update(['users'], (st) => {
      const t = st.users.find((x) => x.id === id);
      if (t) Object.assign(t, patch);
    });
    if (patch.role || patch.active === false) {
      const u2 = byId(id);
      if (u2 && patch.active === false) {
        SP.store.update(['users'], (st) => {
          const t = st.users.find((x) => x.id === id);
          if (t) t.sessions = [];
        });
      }
    }
    SP.store.audit('user.update', u.email, Object.keys(patch).filter((k) => k !== 'password' && k !== 'pin').join(', '));
    return byId(id);
  }

  async function resetPassword(id, newPassword) {
    return updateUser(id, { password: newPassword });
  }

  function revokeSessions(id) {
    SP.store.update(['users'], (st) => {
      const t = st.users.find((x) => x.id === id);
      if (t) t.sessions = [];
    });
    SP.store.audit('user.revoke', (byId(id) || {}).email, 'All sessions revoked');
    if (id === current?.id) { clearStoredSession(); current = null; session = null; }
  }

  async function deleteUser(id) {
    const u = byId(id);
    if (!u) return;
    if (u.id === current?.id) throw new Error('You cannot delete your own account.');
    const admins = SP.store.state.users.filter((x) => x.role === 'admin' && x.active);
    if (u.role === 'admin' && admins.length <= 1) {
      throw new Error('You cannot delete the last active admin.');
    }
    SP.store.update(['users'], (st) => { st.users = st.users.filter((x) => x.id !== id); });
    SP.store.audit('user.delete', u.email, 'Account removed');
  }

  function toggleActive(id) {
    const u = byId(id);
    if (!u) return;
    if (u.id === current?.id) throw new Error('You cannot deactivate your own account.');
    const next = !u.active;
    updateUser(id, { active: next });
    if (!next) revokeSessions(id);
  }

  async function setPin(id, pin) {
    const clean = String(pin || '').replace(/\D/g, '');
    if (clean.length !== 4) throw new Error('PIN must be exactly 4 digits.');
    return updateUser(id, { pin: clean });
  }

  /** In-place password change for the signed-in user. */
  async function changeOwnPassword(oldPassword, newPassword) {
    if (!current) throw new Error('Not signed in.');
    const ok = await SP.crypto.verifyRecord(current.password, oldPassword);
    if (!ok) throw new Error('Your current password is incorrect.');
    const s = SP.crypto.strength(newPassword);
    if (s.score < 2) throw new Error('Choose a stronger password.');
    await updateUser(current.id, { password: newPassword });
    SP.store.audit('user.password', current.email, 'Password changed');
    return true;
  }

  /* ─────────────────────────────────────────────── password recovery */

  /**
   * Offline recovery: recovery questions were captured at onboarding and the
   * answer hash is stored locally. With the bridge configured this delegates to
   * the server-side reset flow instead.
   */
  async function recoverAccess(email, answer) {
    const user = byEmail(email);
    if (!user) return { ok: false, error: 'No account matches that email.' };
    if (!user.recovery) {
      return {
        ok: false,
        error: 'This device has no recovery record for that account. Ask an administrator to reset it.',
      };
    }
    const ok = await SP.crypto.verifyRecord(user.recovery, String(answer || '').trim().toLowerCase());
    if (!ok) return { ok: false, error: 'That answer does not match our records.' };

    const temp = `Reset-${SP.crypto.randomToken(6)}`;
    await updateUser(user.id, { password: temp, mustChangePassword: true, sessions: [] });
    SP.store.audit('user.recover', user.email, 'Password reset via recovery answer');
    return { ok: true, tempPassword: temp };
  }

  function setRecovery(question, answer) {
    if (!current) return;
    SP.crypto.hashPassword(String(answer || '').trim().toLowerCase()).then((rec) => {
      SP.store.update(['users'], (st) => {
        const t = st.users.find((x) => x.id === current.id);
        if (t) t.recovery = { question, ...rec };
      });
    });
  }

  /* ──────────────────────────────────────────────────── misc helpers */

  const PALETTE = ['#5b8cff', '#a78bfa', '#34d399', '#fbbf24', '#f87171', '#38bdf8', '#fb7185', '#4ade80'];
  const randomColour = () => PALETTE[Math.floor(Math.random() * PALETTE.length)];

  /** Session age / expiry for display. */
  const sessionInfo = () => (session ? {
    ...session,
    ageMs: Date.now() - session.startedAt,
    remainingMs: session.expiresAt - Date.now(),
  } : null);

  return {
    ensureSeedUsers, restore, signIn, signInWithPin, signOut,
    current: current_, isSignedIn, can, scopeOf, roleOf, roleDef, permsOf,
    byEmail, byId, createUser, updateUser, deleteUser, toggleActive,
    resetPassword, changeOwnPassword, setPin, setRecovery, recoverAccess,
    revokeSessions, sessionInfo, deviceLabel, randomColour,
    get session() { return session; },
    get currentUser() { return current; },
  };
})();