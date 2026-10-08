// Gameboy Zone — wraps EmulatorJS cores:
//   .gb / .gbc -> Gambatte (Game Boy + Game Boy Color)
//   .gba       -> mGBA (Game Boy Advance, built-in BIOS substitute)

// Pinned engine version. To upgrade, change this and APP_VERSION in sw.js.
const EJS_VERSION = "4.2.3";
// Inside the iPhone app the engine ships with the app (in /emulatorjs/), so
// games play with no internet. On the website it comes from the EmulatorJS CDN.
const IS_APP =
  location.protocol === "capacitor:" ||
  !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === "function" &&
     window.Capacitor.isNativePlatform());
const EJS_DATA = IS_APP ? "/emulatorjs/" : `https://cdn.emulatorjs.org/${EJS_VERSION}/data/`;

// File type -> EmulatorJS core and size limit.
// GB/GBC carts top out at 8 MB and GBA carts at 32 MB; limits leave headroom
// for GB/GBC hacks while still catching files that can't be games.
const SYSTEMS = {
  gb:  { core: "gb",  maxBytes: 16 * 1024 * 1024 },
  gbc: { core: "gb",  maxBytes: 16 * 1024 * 1024 },
  gba: { core: "gba", maxBytes: 32 * 1024 * 1024 },
};
const MIN_ROM_BYTES = 0x150; // smaller than a ROM header = not a game

const $ = (id) => document.getElementById(id);
const home = $("home");
const stage = $("stage");
const romInput = $("rom-input");
const errorBox = $("error");

let playing = false;

// iPhone, iPod, and iPad (iPadOS reports itself as a Mac with touch).
const isIOS =
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
// iPhone Safari can't make page elements fullscreen (iPad can).
const isIPhone = /iPhone|iPod/.test(navigator.userAgent);

// ---------- Errors ----------

function showError(message) {
  errorBox.textContent = message || "";
  errorBox.hidden = !message;
}

function showStageError(message) {
  $("stage-error-text").textContent = message;
  $("stage-error").hidden = false;
}

function goHome() {
  // The engine can only start once per page, so returning home reloads.
  location.replace(location.pathname);
}

// ---------- ROM checks ----------

function splitName(fileName) {
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0) return { stem: fileName, ext: "" };
  return { stem: fileName.slice(0, dot), ext: fileName.slice(dot + 1).toLowerCase() };
}

function systemFor(fileName) {
  return SYSTEMS[splitName(fileName).ext] || null;
}

function validate(file) {
  const system = systemFor(file.name);
  if (!system) {
    return `"${file.name}" isn't a Game Boy game. Choose a file ending in .gb, .gbc, or .gba.`;
  }
  if (file.size < MIN_ROM_BYTES) {
    return `"${file.name}" is too small to be a game. The file may be damaged.`;
  }
  if (file.size > system.maxBytes) {
    const mb = system.maxBytes / (1024 * 1024);
    return `"${file.name}" is larger than any game of this type. Choose a file under ${mb} MB.`;
  }
  return null;
}

// FNV-1a hash of the first 256 KB of the ROM plus its size. Gives every
// game its own save slot, even when two files share a name, and stays fast
// on phones (hashing a full 8 MB game takes about a second).
function hashBytes(bytes, size = bytes.length) {
  let h = 0x811c9dc5 ^ size;
  const end = Math.min(bytes.length, 256 * 1024);
  for (let i = 0; i < end; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % 2147483647 || 1;
}

// ---------- Start a game ----------

async function start(file) {
  if (playing) return;
  showError(null);

  const problem = validate(file);
  if (problem) {
    showError(problem);
    return;
  }

  let gameId, info;
  try {
    const head = await file.slice(0, 256 * 1024).arrayBuffer();
    gameId = hashBytes(new Uint8Array(head), file.size);
    info = await GBZHome.identify(file);
  } catch {
    showError(`Couldn't read "${file.name}". Try choosing it again.`);
    return;
  }

  showStage(info.name);
  GBZHome.record(info, file);
  bootEmulator({
    source: file,
    core: systemFor(file.name).core, // "gb" = Gambatte, "gba" = mGBA
    name: splitName(file.name).stem,
    gameId,
  });
}

// The built-in demo cartridge, shipped with the app (also in Gameboy Zone Lite).
function playDemo() {
  if (playing) return;
  showError(null);
  showStage("Demo cartridge");
  GBZHome.record({ id: "demo", name: "Demo cartridge", system: "gbc", builtIn: true });
  bootEmulator({ source: demoFile(), core: "gb", name: "GBZ Demo", gameId: 7041 });
}

// The demo is stored trimmed; real cartridges are 32 KB padded with $FF.
const DEMO_ROM_B64 = "/////////////////////////////////////////////////////////////////////////////////////9n/////////2f/////////Z/////////9n/////////2f///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////wDDUAH///////////////////////////////////////////////////////////////9HQlogREVNTwAAAAAAAACA////AAAAATMADqcj/hEgGz6A4GghSgIGCCrgaQUg+j6A4GoGCCrgawUg+vMx/v/wRP6QOPqv4EAhAIARWgIGMBoiEwUg+iEAmA4ABgB4qeYBIgR4/iAg9Qx5/iAg7SEA/gagryIFIPwhAP4+UCI+VCI+AiKvdz7k4EfgSD4B4P+v4A8+gOAmPnfgJD7/4CU+k+BA+3YAPiDgAPAA8AAv5g9HPhDgAPAA8AAv5g9PPjDgACEB/stAKAE0y0goATUry1AoATXLWCgBNMtBKAXwQzzgQ8tJKAXwQjzgQstZKCHwgLcgHz4B4IDwR+7/4Ec+gOAWPvPgFz4G4Bg+h+AZGAOv4IAYjr17GXNkIGQgvXsZcx4bZCAAAAAAAAAAAAAAAAAAAAAA/wD/AP8A/wD/AP8A/wD/ADw8Qn6l/4H/pf+Z/0J+PDw=";
function demoFile() {
  const rom = new Uint8Array(0x8000).fill(0xff);
  const raw = atob(DEMO_ROM_B64);
  for (let i = 0; i < raw.length; i++) rom[i] = raw.charCodeAt(i);
  return new File([rom], "GBZ Demo.gb");
}

function showStage(title) {
  playing = true;
  closeSheets();
  // Ask the browser not to evict saves when storage runs low.
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(() => {});
  }
  home.hidden = true;
  stage.hidden = false;
  document.title = `${title} · Gameboy Zone`;
  history.pushState({ playing: true }, "", "#play");
}

function bootEmulator({ source, core, name, gameId }) {
  window.EJS_player = "#game";
  window.EJS_core = core;
  window.EJS_gameUrl = source;
  window.EJS_gameName = name;
  window.EJS_gameID = gameId;
  window.EJS_volume = settings.volume;
  window.EJS_pathtodata = EJS_DATA;
  // iOS only allows sound to start from a tap. The file picker's tap has
  // expired by the time the engine finishes loading, so on iOS we show a
  // "Tap to play" button instead of auto-starting (otherwise games run silent).
  window.EJS_startOnLoaded = !isIOS;
  window.EJS_startButtonName = "Tap to play";
  window.EJS_alignStartButton = "center";

  window.EJS_color = "#F4C430";
  window.EJS_backgroundColor = "#211938";

  // Write in-game saves to browser storage every 5 seconds.
  window.EJS_fixedSaveInterval = 5000;
  // Keep save states in the browser instead of downloading them.
  window.EJS_defaultOptions = { "save-state-location": "browser" };

  window.EJS_Buttons = {
    screenRecord: false,
    cacheManager: false,
    fullscreen: !isIPhone,
    exitEmulation: { visible: true, displayName: "Back to games" },
  };
  window.EJS_onExit = goHome;

  const script = document.createElement("script");
  script.src = `${EJS_DATA}loader.js`;
  script.onerror = () => {
    showStageError(
      IS_APP
        ? "The emulator engine didn't load. Close Gameboy Zone and open it again."
        : navigator.onLine
        ? "The emulator engine didn't load. Reload the page to try again."
        : "You're offline. Connect once so the emulator engine can download, then it works offline."
    );
  };
  document.body.appendChild(script);
}

// ---------- Inputs ----------

romInput.addEventListener("change", () => {
  const file = romInput.files && romInput.files[0];
  romInput.value = ""; // allow choosing the same file again after an error
  if (file) start(file);
});

let dragDepth = 0;
const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files");

document.addEventListener("dragenter", (e) => {
  if (playing || !hasFiles(e)) return;
  e.preventDefault();
  dragDepth++;
  document.body.classList.add("dragging");
});
document.addEventListener("dragover", (e) => {
  if (playing || !hasFiles(e)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "copy";
});
document.addEventListener("dragleave", () => {
  if (playing) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) document.body.classList.remove("dragging");
});
document.addEventListener("drop", (e) => {
  if (playing || !hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove("dragging");
  const file = e.dataTransfer.files[0];
  if (file) start(file);
});

$("back-btn").addEventListener("click", goHome);

// Phone back button / browser back while playing returns to the home screen.
window.addEventListener("popstate", () => {
  if (playing) goHome();
});

// A reload while on #play should land cleanly on the home screen.
if (location.hash === "#play") history.replaceState(null, "", location.pathname);

// ---------- Install (PWA) ----------

const installItem = $("menu-install");
let deferredPrompt = null;

const isStandalone =
  IS_APP || matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
// iPhone/iPad: no install prompt exists, so the menu item explains the steps.
if (!isStandalone && isIOS) {
  installItem.hidden = false;
  $("install-help").hidden = false;
}

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  installItem.hidden = false;
});

installItem.addEventListener("click", async () => {
  if (!deferredPrompt) { openSheet("about"); return; }
  deferredPrompt.prompt();
  await deferredPrompt.userChoice.catch(() => {});
  deferredPrompt = null;
  installItem.hidden = true;
});

window.addEventListener("appinstalled", () => {
  installItem.hidden = true;
});

// ---------- Settings (this device) ----------

const settings = { volume: 0.5 };
try { Object.assign(settings, JSON.parse(localStorage.getItem("gbz:settings") || "{}")); } catch { /* defaults */ }
function saveSettings() {
  try { localStorage.setItem("gbz:settings", JSON.stringify(settings)); } catch { /* storage blocked */ }
}

$("volume").value = Math.round(settings.volume * 100);
$("volume-out").textContent = Math.round(settings.volume * 100) + "%";
$("volume").addEventListener("input", (e) => {
  settings.volume = Number(e.target.value) / 100;
  $("volume-out").textContent = e.target.value + "%";
  saveSettings();
});

let libraryAction = null;
function askLibrary(action, text) {
  libraryAction = action;
  $("library-confirm-text").textContent = text;
  $("library-actions").hidden = true;
  $("library-confirm").hidden = false;
  $("library-confirm-no").focus();
}
function endLibraryConfirm() {
  libraryAction = null;
  $("library-confirm").hidden = true;
  $("library-actions").hidden = false;
}
$("clear-recent").addEventListener("click", () => askLibrary("recent", "Clear the Recent list? Your games stay in the Games tab."));
$("clear-all").addEventListener("click", () => askLibrary("all", "Remove every game and its saved copy from this device? Saves aren't affected."));
$("library-confirm-yes").addEventListener("click", () => {
  if (libraryAction === "recent") { GBZHome.clearRecent(); GBZHome.toast("Recent list cleared"); }
  if (libraryAction === "all") { GBZHome.clearAll(); GBZHome.toast("Library cleared"); }
  endLibraryConfirm();
});
$("library-confirm-no").addEventListener("click", endLibraryConfirm);

// ---------- Sheets ----------

let openSheetId = null;
function openSheet(id) {
  closeSheets();
  openSheetId = id;
  $(id).hidden = false;
  $(id).querySelector("[data-close]").focus();
}
function closeSheets() {
  if (!openSheetId) return;
  $(openSheetId).hidden = true;
  const back = openSheetId === "settings" ? "menu-settings" : "menu-about";
  openSheetId = null;
  endLibraryConfirm();
  if (!playing) $(back).focus({ preventScroll: true });
}
document.querySelectorAll(".sheet-overlay").forEach((ov) => {
  ov.addEventListener("click", (e) => { if (e.target === ov) closeSheets(); });
  ov.querySelector("[data-close]").addEventListener("click", closeSheets);
});
window.addEventListener("keydown", (e) => { if (e.key === "Escape" && openSheetId) closeSheets(); });

// ---------- Home menu + library ----------

$("menu-load").addEventListener("click", () => romInput.click());
$("menu-demo").addEventListener("click", playDemo);
$("menu-settings").addEventListener("click", () => openSheet("settings"));
$("menu-about").addEventListener("click", () => openSheet("about"));

GBZHome.init({
  storageKey: "gbz:library",
  romDbName: "gbz-roms",
  folderExtensions: ["gb", "gbc", "gba"],
  hasDemo: true,
  extensions: ".gb, .gbc, or .gba",
  openPicker: () => romInput.click(),
  openFile: (file) => start(file),
  onDemo: playDemo,
});
GBZHome.mountSources($("library-sources"));

// ---------- Offline support ----------

// The iPhone app already has every file on the device, so it skips this.
if ("serviceWorker" in navigator && !IS_APP) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
