# Build the Android APK

StockPilot is a static web app, so the Android build simply wraps this folder in a native
WebView shell with Capacitor. There is nothing to compile — the APK ships the exact same files
you already have.

Two routes:

- **A. GitHub Actions (recommended)** — a signed APK with no local Android Studio.
- **B. Local Android Studio** — full control, installable keystore.

---

## Route A — GitHub Actions (no local setup)

### 1. Create the upload keystore (once, on your machine)

```bash
keytool -genkey -v \
  -keystore stockpilot-upload.jks \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -alias stockpilot-upload
```

> Keep this file safe. If you lose it you cannot ship updates to the same Play Store listing.

### 2. Push the repo to GitHub

```bash
git init
git add .
git commit -m "StockPilot 1.0.0"
git branch -M main
git remote add origin https://github.com/<you>/stockpilot.git
git push -u origin main
```

### 3. Add the three repository secrets

**Settings → Secrets and variables → Actions → New repository secret**

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_B64` | `base64 -w0 stockpilot-upload.jks` (macOS: `base64 -i stockpilot-upload.jks`) |
| `ANDROID_KEY_ALIAS` | `stockpilot-upload` |
| `ANDROID_KEY_PASSWORD` | the password you chose |

### 4. Run it

**Actions → Build Android APK → Run workflow.**

Download `stockpilot-apk` from the run summary. The APK is at
`android/app/build/outputs/apk/release/app-release.apk` inside it.

Pushing a tag (`git tag v1.0.0 && git push --tags`) additionally attaches the APK to the
GitHub Release.

### Install on a phone

```bash
adb install -r app-release.apk
```

Or copy the APK to the phone and open it (enable *Install unknown apps* for your file manager).
The GitHub-hosted runner output is already signed with your upload key, so it installs directly.

---

## Route B — Local Android Studio

### 1. Prerequisites

| Tool | Version |
|---|---|
| Node.js | 18+ (tested on 24) |
| JDK | 17 |
| Android Studio | Hedgehog or newer (SDK 34) |
| Android SDK | Platform 34 + Build-Tools 34 |

Set `JAVA_HOME` and add `%ANDROID_HOME%\platform-tools` to `PATH`.

### 2. Add the platform

```bash
npm install
npx cap add android
npx cap sync android
```

This creates `android/` and copies the web assets into `android/app/src/main/assets/public/`.

### 3. Configure signing

Create `android/keystore.properties`:

```properties
storeFile=../stockpilot-upload.jks
storePassword=your-store-password
keyAlias=stockpilot-upload
keyPassword=your-key-password
```

Then, in `android/app/build.gradle`, wire it into the release build type:

```gradle
def keystorePropsFile = rootProject.file("keystore.properties")
def keystoreProps = new Properties()
if (keystorePropsFile.exists()) {
    keystoreProps.load(new FileInputStream(keystorePropsFile))
}

android {
    signingConfigs {
        release {
            storeFile     file(keystoreProps['storeFile'])
            storePassword keystoreProps['storePassword']
            keyAlias      keystoreProps['keyAlias']
            keyPassword   keystoreProps['keyPassword']
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
            minifyEnabled false
        }
    }
}
```

### 4. Build

```bash
npm run android:apk
```

Output: `android/app/build/outputs/apk/release/app-release.apk`

Or open the project and use **Build → Build Bundle(s) / APK(s) → Build APK(s)**.

### 5. Play Store bundle

For Google Play you need an **AAB**, not an APK:

```bash
cd android && ./gradlew bundleRelease
# android/app/build/outputs/bundle/release/app-release.aab
```

Then Play Console → *Create app* → upload the AAB.

---

## App identity

Change these in `capacitor.config.js` before a release, then re-run `npx cap sync android`:

```js
appId: 'app.stockpilot.inventory',   // must match Play Console, never reuse an id
appName: 'StockPilot',
```

Also update in `android/app/src/main/res/values/strings.xml`:

```xml
<string name="app_name">StockPilot</string>
```

### Icons and splash

Replace:

- `android/app/src/main/res/mipmap-*/ic_launcher.png` — launcher icon
- `assets/icon.svg` — the in-app glyph and PWA icon

Adaptive icon XML lives at `android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml`.

---

## Connecting the sheet from inside the app

The APK ships with the embedded snapshot, so it works offline immediately. To enable live
read/write:

1. **Settings → Google Sheet**
2. Paste the Apps Script `/exec` URL (see the main README for deploying the bridge)
3. **Save & test**

The URL is stored per-device. Ship a default by setting it in `SP.sheet.bridgeUrl` in
`js/config.js` before packaging — handy for an internal rollout where everyone shares one
bridge.

---

## Gotchas

**White screen after install.** `npx cap sync android` was not run after copying new files.
Re-run it; Capacitor does not hot-reload into an existing native project.

**Stale assets.** The service worker caches aggressively. Bump the `?v=` query in `index.html`
and `VERSION` in `sw.js` with every release, or the app will serve the previous bundle.

**Service worker on `http://`.** In a native build the WebView origin is `https://localhost`, so
the worker registers fine. On a plain-HTTP LAN address it does not — the app still works, just
without the offline cache.

**Cleartext traffic.** `server.androidScheme` is `https` in `capacitor.config.js`. If you add a
remote origin over plain HTTP you must also allow cleartext in
`android/app/src/main/AndroidManifest.xml` (`android:usesCleartextTraffic="true"`). Prefer not to.

**Version bumps.** Update `version` in `package.json`, `SP.VERSION` in `js/config.js`, and the
`versionCode`/`versionName` in `android/app/build.gradle` before each release.