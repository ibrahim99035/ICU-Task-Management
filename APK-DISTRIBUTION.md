# TaskLog — APK distribution and installation

This guide explains how to get the latest debug APK, share it with the group, install it on Android, and create accounts.

## 1. Get the APK file

The latest APK was downloaded to:

```text
/tmp/icu-apk-final/app-debug.apk
```

Copy it somewhere easier to share:

```bash
cp /tmp/icu-apk-final/app-debug.apk ~/Desktop/icu-tasklog.apk
```

Or download it again from GitHub Actions:

<https://github.com/ibrahim99035/ICU-Task-Management/actions/runs/44917777448>

At the bottom of that run page, under **Artifacts**, download:

```text
icu-tasklog-debug-apk
```

That downloads a ZIP. Unzip it to get:

```text
app-debug.apk
```

### Artifact details

- Size: 5,616,993 bytes (5.4 MiB)
- SHA-256: `55dc67f52cb15c405538dbe342714932b9b48b874fa3c2a04e5a0a6bdf51c2eb`

## 2. Share it

The file is only about **5.4 MB**, so any of these work:

- WhatsApp / Telegram / Signal
- Google Drive or OneDrive link
- Email attachment
- USB cable

For a group, Google Drive is usually easiest: upload once, share the link, and tell everyone to download it on their Android phone.

Always share the APK from the run linked above. Do not share stale copies from earlier runs.

## 3. Install on Android

Each person should:

1. Download `app-debug.apk`.
2. Tap the file in Downloads/Files.
3. If Android blocks it, tap **Settings** and allow **Install unknown apps** for the app doing the install — usually **Chrome** or **Files**.
4. Tap **Install**.
5. If Play Protect warns about an unknown developer, choose **More details → Install anyway**.
6. Open **TaskLog**.

This is a debug-signed thesis demo, not a Play Store app.

## 4. Give the group accounts

Each person can open the login screen and tap **Create account**, then create their own nurse account.

For the head-nurse demo, use:

```text
username: head
PIN: 9999
```

Account creation needs internet. After the first sign-in, the nurse flow can continue offline.

## Important installation note

Because this is a debug build, if someone already installed an older debug APK built by a different workflow run, Android may refuse to update it. Uninstall the old app first, then install this one.

If you want a permanent public download link, the cleanest option is to attach this APK to a **GitHub Release**.
