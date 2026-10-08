# Gameboy Zone for iPhone

This repo turns [Gameboy Zone](https://gameboy-zone.vercel.app) into an iPhone app (`.ipa`). The app plays Game Boy, Game Boy Color and Game Boy Advance games with **no internet**, because the game engine is built into the app.

You don't need a Mac. GitHub's free cloud Mac builds the app every time this repo changes.

## Get the app

1. Open the **Releases** page of this repo (right-hand side on GitHub).
2. Download `GameboyZone.ipa` from the newest build.
3. Install it with SideStore (see below).

To make a new build by hand, go to **Actions**, open **Build iPhone app**, then tap **Run workflow**.

## One-time setup: SideStore (refreshes from your phone)

SideStore installs apps with your free Apple ID, and it can refresh them from the phone itself.

**You need:** your Windows PC, a USB cable, your Apple ID, and a passcode set on your iPhone.

1. **On the PC:** install **iTunes** (from Apple or the Microsoft Store), then install **iloader**. Only download it from [iloader.app](https://iloader.app) or its [GitHub page](https://github.com/nab138/iloader).
2. **On the iPhone:** install **LocalDevVPN** from the App Store.
3. Plug the iPhone into the PC and tap **Trust** on the phone.
4. Open iloader, sign in with your Apple ID, select your iPhone, and install **SideStore**.
5. **On the iPhone:**
   - Go to **Settings → General → VPN & Device Management** and trust your Apple ID.
   - Go to **Settings → Privacy & Security → Developer Mode**, turn it on, and restart the phone.
6. Open **LocalDevVPN** and tap **Connect**. Then open **SideStore** and sign in with the same Apple ID.

## Install Gameboy Zone

1. Download `GameboyZone.ipa` on your iPhone. In Safari, save it to **Files**.
2. With LocalDevVPN connected, open **SideStore → My Apps**, tap **+**, and pick `GameboyZone.ipa`.
3. Gameboy Zone appears on your Home Screen.

## Every week (about 10 seconds)

Free Apple IDs make sideloaded apps stop opening after **7 days**. Before that happens:

- Connect **LocalDevVPN**, open **SideStore**, and tap **Refresh All**.

Your games and saves stay safe when you refresh. Only deleting the app removes them.

**Good to know**

- A free Apple ID allows **3** sideloaded apps at once. SideStore and Gameboy Zone use 2.
- An iOS update or phone reset may break SideStore's pairing. If that happens, plug into the PC and run iloader again.

## Updating the app

Change the files in `www/` (it's the same code as the website), then push. The cloud build makes a new release. Install the new `.ipa` over the old one in SideStore, and your saves are kept.

## What's inside

| Path | What it is |
| --- | --- |
| `www/` | The Gameboy Zone web app |
| `capacitor.config.json` | App name, ID and colors for the iPhone wrapper ([Capacitor](https://capacitorjs.com)) |
| `scripts/fetch-engine.sh` | Downloads EmulatorJS 4.2.3 (Gambatte + mGBA cores) and the font into the app at build time |
| `scripts/ios-setup.sh` | Sets the icon, launch screen and iPhone settings |
| `scripts/build-ipa.sh` | Builds the unsigned `.ipa` |
| `resources/` | App icon (1024 px) and launch screen image |
| `.github/workflows/build-ios.yml` | The cloud build |

Emulation is by [EmulatorJS](https://emulatorjs.org) (GPL-3.0). This project is not affiliated with Nintendo, and it ships no games except a small homemade demo.
