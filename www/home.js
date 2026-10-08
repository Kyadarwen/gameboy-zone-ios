// ---------------------------------------------------------------------------
// Gameboy Zone home screen (shared by Lite and the hosted app):
// library of played games, cartridge-label tiles, tabs, animated background.
// The library keeps a copy of each game file on this device (IndexedDB), so
// tapping a tile starts the game right away. Games can also come from a
// linked folder (Chrome/Edge on a computer) or be imported in bulk.
// ---------------------------------------------------------------------------

const GBZHome = (() => {
  const RECENT_MAX = 12;
  const LABEL_COLORS = ["#F4C430", "#FF8A65", "#4FB8CC", "#9CCC65", "#F48FB1", "#9FA8FF", "#FFB74D", "#80CBC4"];
  const SHAPES = {
    dpad: '<path d="M18 6h12v12h12v12H30v12H18V30H6V18h12z"/>',
    button: '<circle cx="24" cy="24" r="16"/><circle cx="24" cy="24" r="9"/>',
    cart: '<path d="M10 5h22l6 6v32H10z"/><path d="M15 11h14M15 15h14"/><path d="M15 21h18v15H15z"/>',
    heart: '<path d="M6 14v8h4v4h4v4h4v4h4v4h4v-4h4v-4h4v-4h4v-4h4v-8h-4v-4h-8v4h-4v4h-4v-4h-4v-4h-8v4z"/>',
    pill: '<rect x="7" y="19" width="34" height="10" rx="5"/>',
  };

  let opts = null;
  let library = [];
  let tab = "recent";
  let pending = null;       // tile the person is re-picking a file for
  let confirmId = null;     // tile showing "Remove?" confirmation
  let toastTimer = 0;
  let busy = false;         // a tile is loading its stored file
  const $h = (sel) => document.querySelector(sel);

  // ----- Game file copies (IndexedDB: survives reloads, stays on this device) -----

  let dbPromise = null;
  function romDb() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        if (!window.indexedDB) { reject(new Error("NO_IDB")); return; }
        const req = indexedDB.open(opts.romDbName, 2);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("roms")) db.createObjectStore("roms");
          if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      dbPromise.catch(() => { dbPromise = null; });
    }
    return dbPromise;
  }

  async function romTx(mode, fn, store = "roms") {
    const db = await romDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const req = fn(tx.objectStore(store));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  // Stored as plain bytes, the most reliable format across browsers (iOS included).
  async function storeFile(id, file) {
    const buf = await file.arrayBuffer();
    await romTx("readwrite", (st) => st.put({ buf, name: file.name }, id));
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  }

  async function loadFile(id) {
    const rec = await romTx("readonly", (st) => st.get(id));
    return rec && rec.buf ? new File([rec.buf], rec.name) : null;
  }

  function deleteFile(id) {
    return romTx("readwrite", (st) => st.delete(id)).catch(() => {});
  }

  // ----- Game folder (linked folder or bulk import) -----

  let folder = null;        // { handle, name } when a folder is linked
  let folderNeedsAccess = false;
  let scanning = false;
  let sourcesEl = null;     // Settings panel showing where games come from
  let unlinkConfirm = false;

  // Linking a folder needs the File System Access API, which works in
  // Chrome/Edge on a computer and not inside embedded pages (like Claude artifacts).
  const inFrame = (() => { try { return window.self !== window.top; } catch { return true; } })();
  const canLink = "showDirectoryPicker" in window && !inFrame && window.isSecureContext;

  function extOf(name) {
    const dot = name.lastIndexOf(".");
    return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
  }

  async function saveFolderHandle(handle) {
    await romTx("readwrite", (st) => (handle ? st.put(handle, "folder") : st.delete("folder")), "meta");
  }

  async function loadFolderHandle() {
    try { return (await romTx("readonly", (st) => st.get("folder"), "meta")) || null; } catch { return null; }
  }

  async function hasAccess(handle, ask) {
    if (!handle.queryPermission) return true;
    if ((await handle.queryPermission({ mode: "read" })) === "granted") return true;
    if (!ask) return false;
    try { return (await handle.requestPermission({ mode: "read" })) === "granted"; } catch { return false; }
  }

  // Collect game files up to 3 folders deep, skipping hidden ones.
  async function collect(dir, prefix, depth, out) {
    for await (const [name, h] of dir.entries()) {
      if (name.startsWith(".")) continue;
      if (h.kind === "directory") { if (depth < 3) await collect(h, prefix + name + "/", depth + 1, out); }
      else if (opts.folderExtensions.includes(extOf(name))) out.push({ path: prefix + name, handle: h });
    }
    return out;
  }

  async function scanFolder({ quiet = false } = {}) {
    if (!folder || scanning) return;
    scanning = true;
    renderSources();
    let found = [];
    try {
      found = await collect(folder.handle, "", 0, []);
    } catch {
      scanning = false;
      folderNeedsAccess = true;
      render();
      return;
    }
    const seen = new Set();
    let added = 0;
    for (const { path, handle } of found) {
      try {
        const info = await identify(await handle.getFile());
        if (seen.has(info.id)) continue;
        seen.add(info.id);
        const i = library.findIndex((g) => g.id === info.id);
        if (i >= 0) library[i] = { ...library[i], ...info, folder: true, path };
        else { library.push({ ...info, folder: true, path, added: Date.now(), played: 0 }); added++; }
      } catch { /* unreadable file: skip */ }
    }
    // Games that left the folder go too, unless they also have their own copy.
    const before = library.length;
    library = library.filter((g) => !g.folder || seen.has(g.id) || g.stored);
    library.forEach((g) => { if (g.folder && !seen.has(g.id)) { delete g.folder; delete g.path; } });
    const gone = before - library.length;
    scanning = false;
    folderNeedsAccess = false;
    save();
    if (added && tab === "recent" && !library.some((g) => g.played)) tab = "games";
    render();
    if (!quiet || added || gone) {
      const n = seen.size;
      let msg = `${n} game${n === 1 ? "" : "s"} in “${folder.name}”`;
      if (added) msg += `, ${added} new`;
      if (gone) msg += `, ${gone} removed`;
      toast(msg);
    }
  }

  async function linkFolder() {
    let handle;
    try {
      handle = await window.showDirectoryPicker({ id: "gbz-games", mode: "read" });
    } catch (err) {
      if (err && err.name === "AbortError") return; // closed the picker
      toast("This browser blocked folder access. Use Import games instead.");
      return;
    }
    folder = { handle, name: handle.name };
    unlinkConfirm = false;
    try { await saveFolderHandle(handle); } catch { /* still works this session */ }
    tab = "games";
    await scanFolder();
  }

  async function reconnectFolder() {
    if (!folder) return;
    if (await hasAccess(folder.handle, true)) await scanFolder();
    else toast("Folder access wasn't allowed.");
  }

  async function unlinkFolder() {
    folder = null;
    folderNeedsAccess = false;
    unlinkConfirm = false;
    try { await saveFolderHandle(null); } catch { /* ignore */ }
    library = library.filter((g) => !g.folder || g.stored);
    library.forEach((g) => { delete g.folder; delete g.path; });
    save();
    render();
    toast("Folder unlinked");
  }

  async function fileFromFolder(entry) {
    if (!folder || !entry.path) return null;
    if (!(await hasAccess(folder.handle, true))) return null;
    try {
      const parts = entry.path.split("/");
      let dir = folder.handle;
      for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
      return await (await dir.getFileHandle(parts[parts.length - 1])).getFile();
    } catch { return null; }
  }

  // Bulk import: multi-select in the Files app (works on iPhone/iPad too).
  let importInput = null;
  function pickImport() {
    if (!importInput) {
      importInput = document.createElement("input");
      importInput.type = "file";
      importInput.multiple = true;
      importInput.className = "visually-hidden";
      importInput.tabIndex = -1;
      importInput.setAttribute("aria-hidden", "true");
      importInput.addEventListener("change", () => {
        const files = Array.from(importInput.files || []);
        importInput.value = "";
        if (files.length) importFiles(files);
      });
      document.body.appendChild(importInput);
    }
    importInput.click();
  }

  async function importFiles(files) {
    const playable = files.filter((f) => opts.folderExtensions.includes(extOf(f.name)));
    const gba = files.filter((f) => extOf(f.name) === "gba" && !opts.folderExtensions.includes("gba")).length;
    const other = files.length - playable.length - gba;
    if (!playable.length) {
      toast(gba ? "Game Boy Advance games play in the full Gameboy Zone app." : `No ${opts.extensions} files in what you picked.`);
      return;
    }
    toast(`Adding ${playable.length} game${playable.length === 1 ? "" : "s"}…`);
    let added = 0, already = 0, failed = 0;
    for (const file of playable) {
      try {
        const info = await identify(file);
        const i = library.findIndex((g) => g.id === info.id);
        if (i >= 0 && (library[i].stored || library[i].folder)) { already++; continue; }
        await storeFile(info.id, file);
        if (i >= 0) library[i] = { ...library[i], ...info, stored: true };
        else library.push({ ...info, stored: true, added: Date.now(), played: 0 });
        added++;
        save();
      } catch { failed++; }
    }
    if (added && !library.some((g) => g.played)) tab = "games";
    render();
    const parts = [`Added ${added} game${added === 1 ? "" : "s"}`];
    if (already) parts.push(`${already} already in your library`);
    if (gba) parts.push(`${gba} GBA skipped (full app only)`);
    if (other) parts.push(`${other} other file${other === 1 ? "" : "s"} skipped`);
    if (failed) parts.push(`${failed} couldn't be saved (storage full?)`);
    toast(parts.join(" · "));
  }

  // ----- Library storage -----

  function load() {
    try { library = JSON.parse(localStorage.getItem(opts.storageKey) || "[]") || []; } catch { library = []; }
    if (!Array.isArray(library)) library = [];
  }
  function save() {
    try { localStorage.setItem(opts.storageKey, JSON.stringify(library)); } catch { /* storage blocked */ }
  }

  // "Pokemon - Red Version (USA, Europe) (SGB Enhanced).gb" -> "Pokemon - Red Version"
  function cleanTitle(fileName) {
    return fileName
      .replace(/\.[^.]+$/, "")
      .replace(/[\(\[][^\)\]]*[\)\]]/g, " ")
      .replace(/[_]+/g, " ")
      .replace(/\s+/g, " ")
      .replace(/[\s\-–,]+$/, "")
      .trim();
  }

  function ascii(bytes, from, to) {
    let s = "";
    for (let i = from; i < to; i++) {
      const c = bytes[i];
      if (c === 0) break;
      if (c >= 0x20 && c < 0x7f) s += String.fromCharCode(c);
    }
    return s.trim();
  }

  // Reads just the cartridge header to tell games apart and pick the system.
  async function identify(file) {
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    const head = new Uint8Array(await file.slice(0, 0x150).arrayBuffer());
    let id, system, headerTitle;
    if (ext === "gba") {
      headerTitle = ascii(head, 0xa0, 0xac);
      system = "gba";
      id = "gba:" + ascii(head, 0xac, 0xb0) + ":" + headerTitle + ":" + file.size;
    } else {
      const cgb = head[0x143];
      system = cgb & 0x80 ? "gbc" : "gb";
      headerTitle = ascii(head, 0x134, cgb & 0x80 ? 0x13f : 0x144);
      id = "gb:" + headerTitle + ":" + (((head[0x14e] << 8) | head[0x14f]) >>> 0).toString(16);
    }
    return { id, system, name: cleanTitle(file.name) || headerTitle || "Game", fileName: file.name, size: file.size };
  }

  // Call after a game actually starts. Pass the file to keep a copy for one-tap play.
  async function record(info, file) {
    const now = Date.now();
    const i = library.findIndex((g) => g.id === info.id);
    const prev = i >= 0 ? library[i] : null;
    const entry = { ...(prev || { added: now }), ...info, played: now };
    if (i >= 0) library[i] = entry; else library.push(entry);
    if (pending && pending.id !== info.id && !info.builtIn) {
      toast(`Opened ${info.name} instead of ${pending.name}`);
    }
    pending = null;
    save();
    render();

    // Keep a copy unless an identical one is already stored.
    if (file && !(prev && (prev.folder || (prev.stored && prev.size === file.size)))) {
      try {
        await storeFile(info.id, file);
        entry.stored = true;
      } catch {
        entry.stored = false;
        toast(`Couldn't keep a copy of ${info.name} (storage full or blocked). You'll pick the file next time.`);
      }
      save();
      render();
    }
  }

  function remove(id) {
    library = library.filter((g) => g.id !== id);
    confirmId = null;
    deleteFile(id);
    save();
    render();
  }

  function clearRecent() {
    library = library.map((g) => ({ ...g, played: 0 }));
    save(); render();
  }
  function clearAll() {
    library = [];
    romTx("readwrite", (st) => st.clear()).catch(() => {});
    save(); render();
  }

  // ----- Rendering -----

  function hash(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
  }

  function relTime(ms) {
    if (!ms) return "";
    const days = Math.floor((Date.now() - ms) / 86400000);
    if (days <= 0) return "Played today";
    if (days === 1) return "Played yesterday";
    if (days < 30) return `Played ${days} days ago`;
    return "Played " + new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function demoEntry() {
    return { id: "demo", name: "Demo cartridge", system: "gbc", builtIn: true };
  }

  function entriesFor(t) {
    if (t === "demos") return opts.hasDemo ? [demoEntry()] : [];
    if (t === "recent") {
      return library.filter((g) => g.played).sort((a, b) => b.played - a.played).slice(0, RECENT_MAX);
    }
    return library.filter((g) => !g.builtIn).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function cartridge(entry) {
    const art = el("div", "tile-art");
    const cart = el("div", `cart ${entry.system === "gba" ? "wide" : "tall"} sys-${entry.system}`);
    cart.style.setProperty("--label", LABEL_COLORS[hash(entry.id) % LABEL_COLORS.length]);
    if (entry.system !== "gba") cart.appendChild(el("span", "cart-ridges"));
    const label = el("span", "cart-label-art");
    label.append(el("span", "cart-name", entry.name), el("span", "cart-badge", entry.system.toUpperCase()));
    cart.appendChild(label);
    art.appendChild(cart);
    return art;
  }

  function tile(entry) {
    const wrap = el("div", "tile");
    const btn = el("button", "tile-btn");
    btn.type = "button";
    btn.setAttribute("aria-label", entry.builtIn ? `Play ${entry.name}` : `Play ${entry.name} (${entry.fileName})`);
    btn.appendChild(cartridge(entry));
    const caption = el("span", "tile-caption",
      entry.builtIn ? "Built in" :
      entry.folder ? relTime(entry.played) || "New in folder" :
      !entry.stored ? "Tap to add its file" : relTime(entry.played) || "Not played yet");
    btn.appendChild(caption);

    let longPress = 0, longPressed = false;
    btn.addEventListener("pointerdown", () => {
      longPressed = false;
      if (entry.builtIn) return;
      longPress = setTimeout(() => { longPressed = true; confirmId = entry.id; render(); }, 550);
    });
    const cancel = () => clearTimeout(longPress);
    btn.addEventListener("pointerup", cancel);
    btn.addEventListener("pointerleave", cancel);
    btn.addEventListener("pointercancel", cancel);
    btn.addEventListener("contextmenu", (e) => { if (!entry.builtIn) e.preventDefault(); });
    btn.addEventListener("click", async () => {
      if (longPressed || busy) return;
      if (entry.builtIn) { opts.onDemo(); return; }
      if (entry.folder) {
        busy = true;
        btn.classList.add("loading");
        let file = await fileFromFolder(entry);
        if (!file && entry.stored) { try { file = await loadFile(entry.id); } catch { file = null; } }
        busy = false;
        btn.classList.remove("loading");
        if (file) { pending = entry; opts.openFile(file); return; }
        toast(folderNeedsAccess || !folder ? "Allow folder access first (button above the games)." :
          `Couldn't open ${entry.name} from “${folder.name}”. Tap Refresh folder.`);
        return;
      }
      if (!entry.stored) {
        // No copy yet (added before one-tap play, or storage was cleared): pick it once.
        pending = entry;
        toast(`Pick “${entry.fileName}” once; after that it starts in one tap`);
        opts.openPicker();
        return;
      }
      busy = true;
      btn.classList.add("loading");
      let file = null;
      try { file = await loadFile(entry.id); } catch { file = null; }
      busy = false;
      btn.classList.remove("loading");
      if (file) { pending = entry; opts.openFile(file); return; }
      // The copy is gone (e.g. site data cleared). iPhone needs a fresh tap to open the picker.
      entry.stored = false;
      save();
      render();
      toast(`${entry.name}'s file is no longer on this device. Tap it again to pick the file.`);
    });
    wrap.appendChild(btn);

    if (!entry.builtIn) {
      const more = el("button", "tile-more", "⋯");
      more.type = "button";
      more.setAttribute("aria-label", `Options for ${entry.name}`);
      more.addEventListener("click", () => { confirmId = entry.id; render(); });
      wrap.appendChild(more);
    }

    if (confirmId === entry.id) {
      const box = el("div", "tile-confirm");
      box.appendChild(el("p", "", `Remove ${entry.name} and its saved copy from this device?`));
      const yes = el("button", "tile-confirm-yes", "Remove");
      yes.type = "button";
      yes.addEventListener("click", () => remove(entry.id));
      const no = el("button", "tile-confirm-no", "Cancel");
      no.type = "button";
      no.addEventListener("click", () => { confirmId = null; render(); });
      box.append(yes, no);
      wrap.appendChild(box);
      setTimeout(() => no.focus(), 0);
    }
    return wrap;
  }

  function emptyState() {
    const box = el("div", "lib-empty");
    box.appendChild(el("p", "lib-empty-title", tab === "recent" ? "No games played yet" : "Your library is empty"));
    box.appendChild(el("p", "lib-empty-text", `Load a ${opts.extensions} file and it shows up here. Next time, tap its cartridge to play it right away.`));
    const row = el("div", "lib-empty-actions");
    const loadBtn = el("button", "pill-btn primary", "Load game…");
    loadBtn.type = "button";
    loadBtn.addEventListener("click", () => opts.openPicker());
    row.appendChild(loadBtn);
    const bulk = el("button", "pill-btn", canLink ? "Link game folder" : "Import games…");
    bulk.type = "button";
    bulk.addEventListener("click", () => (canLink ? linkFolder() : pickImport()));
    row.appendChild(bulk);
    if (opts.hasDemo) {
      const demo = el("button", "pill-btn", "Try the demo");
      demo.type = "button";
      demo.addEventListener("click", () => opts.onDemo());
      row.appendChild(demo);
    }
    box.appendChild(row);
    return box;
  }

  // Note above the tiles when a linked folder needs permission again.
  function renderFolderNote() {
    let note = $h("#folder-note");
    const show = folder && folderNeedsAccess;
    if (!show) { if (note) note.hidden = true; return; }
    if (!note) {
      note = el("div", "folder-note");
      note.id = "folder-note";
      note.setAttribute("role", "status");
      const p = el("p");
      const b = el("button", "pill-btn primary", "Allow access");
      b.type = "button";
      b.addEventListener("click", reconnectFolder);
      note.append(p, b);
      $h(".lib-notes").appendChild(note);
    }
    note.querySelector("p").textContent = `Your game folder “${folder.name}” needs permission again to show its games.`;
    note.hidden = false;
  }

  function renderMenuItem() {
    const btn = $h("#menu-folder");
    if (!btn) return;
    const label = !canLink ? "Import games…" : folder ? (scanning ? "Scanning…" : "Refresh folder") : "Link game folder";
    btn.textContent = label + " ";
    const icon = el("span", "menu-icon", "📁");
    icon.setAttribute("aria-hidden", "true");
    btn.appendChild(icon);
  }

  function folderMenuAction() {
    if (!canLink) { pickImport(); return; }
    if (!folder) { linkFolder(); return; }
    if (folderNeedsAccess) { reconnectFolder(); return; }
    scanFolder();
  }

  // Settings: where the library's games come from.
  function renderSources() {
    renderMenuItem();
    if (!sourcesEl) return;
    sourcesEl.textContent = "";
    sourcesEl.appendChild(el("span", "field-label", "Game folder"));
    const folderCount = library.filter((g) => g.folder).length;
    const hint = el("p", "field-hint");
    if (canLink) {
      hint.textContent = folder
        ? `Linked to “${folder.name}”${scanning ? " · scanning…" : ` · ${folderCount} game${folderCount === 1 ? "" : "s"}`}. New games in it appear each time you open the app.`
        : "Link a folder of game files. Its games show up in the library and play straight from the folder.";
    } else {
      hint.textContent = inFrame
        ? "Folder linking isn't available inside Claude. Import games copies them in for one-tap play; run it again to add new ones. (The full Gameboy Zone app can link a folder in Chrome or Edge on a computer.)"
        : "This browser can't link a folder. Import games: open your games folder, tap Select, and choose the games. Run it again to add new ones.";
    }
    sourcesEl.appendChild(hint);

    const row = el("div", "source-actions");
    const add = (label, fn, cls = "") => {
      const b = el("button", "source-btn " + cls, label);
      b.type = "button";
      b.addEventListener("click", fn);
      row.appendChild(b);
    };
    if (unlinkConfirm) {
      row.appendChild(el("p", "source-question", `Unlink “${folder.name}”? Its games leave the library; the files stay where they are.`));
      add("Unlink", unlinkFolder, "primary");
      add("Cancel", () => { unlinkConfirm = false; renderSources(); });
    } else {
      if (canLink && !folder) add("Link folder", linkFolder, "primary");
      if (canLink && folder) {
        add(folderNeedsAccess ? "Allow access" : "Refresh", folderNeedsAccess ? reconnectFolder : () => scanFolder(), "primary");
        add("Change folder", linkFolder);
        add("Unlink", () => { unlinkConfirm = true; renderSources(); });
      }
      add("Import games…", pickImport, canLink ? "" : "primary");
    }
    sourcesEl.appendChild(row);
  }

  function mountSources(container) {
    sourcesEl = container;
    renderSources();
  }

  function render() {
    if (!opts) return;
    renderFolderNote();
    renderSources();
    document.querySelectorAll(".lib-tab").forEach((b) => {
      const on = b.dataset.libtab === tab;
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
    });
    const grid = $h("#tiles");
    grid.textContent = "";
    const items = entriesFor(tab);
    if (!items.length) { grid.appendChild(emptyState()); return; }
    for (const entry of items) grid.appendChild(tile(entry));
  }

  function setTab(t) {
    tab = t;
    confirmId = null;
    render();
  }

  // ----- Toast -----

  function toast(text) {
    let t = $h(".home-toast");
    if (!t) {
      t = el("div", "home-toast");
      t.setAttribute("role", "status");
      document.body.appendChild(t);
    }
    t.textContent = text;
    t.classList.toggle("long", text.length > 40);
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, Math.min(7000, 2200 + text.length * 45));
  }

  // ----- Animated background: outlined Game Boy shapes drifting slowly -----

  function buildBackground() {
    const bg = $h(".home-bg");
    if (!bg || bg.childElementCount) return;
    let seed = 7;
    const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const kinds = Object.keys(SHAPES);
    for (let i = 0; i < 26; i++) {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 48 48");
      svg.setAttribute("class", "bg-shape");
      svg.innerHTML = SHAPES[kinds[i % kinds.length]];
      const size = 26 + rand() * 62;
      svg.style.cssText =
        `left:${(rand() * 100).toFixed(1)}%;top:${(rand() * 100).toFixed(1)}%;width:${size.toFixed(0)}px;height:${size.toFixed(0)}px;` +
        `--dx:${(rand() * 90 - 45).toFixed(0)}px;--dy:${(rand() * 90 - 45).toFixed(0)}px;` +
        `--r0:${(rand() * 60 - 30).toFixed(0)}deg;--r1:${(rand() * 80 - 40).toFixed(0)}deg;` +
        `animation-duration:${(16 + rand() * 22).toFixed(1)}s;animation-delay:-${(rand() * 20).toFixed(1)}s;`;
      bg.appendChild(svg);
    }
  }

  // ----- Setup -----

  function init(options) {
    opts = { hasDemo: true, extensions: ".gb or .gbc", romDbName: "gbz-roms", folderExtensions: ["gb", "gbc"], ...options };
    load();
    buildBackground();
    document.querySelectorAll(".lib-tab").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.libtab)));
    // Arrow keys move between tabs (standard tab-list behavior)
    $h(".lib-tabs").addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      const order = ["recent", "games", "demos"].filter((t) => document.querySelector(`[data-libtab="${t}"]`));
      const next = order[(order.indexOf(tab) + (e.key === "ArrowRight" ? 1 : order.length - 1)) % order.length];
      setTab(next);
      document.querySelector(`[data-libtab="${next}"]`).focus();
    });
    if (!library.some((g) => g.played)) tab = "games";
    if (!library.length) tab = opts.hasDemo ? "recent" : "games";
    const menuBtn = $h("#menu-folder");
    if (menuBtn) menuBtn.addEventListener("click", folderMenuAction);
    render();
    restoreFolder();
  }

  // Reconnect a previously linked folder; scan it if access is still allowed.
  async function restoreFolder() {
    if (!canLink) return;
    const handle = await loadFolderHandle();
    if (!handle) return;
    folder = { handle, name: handle.name };
    if (await hasAccess(handle, false)) await scanFolder({ quiet: true });
    else { folderNeedsAccess = true; render(); }
  }

  return {
    init, identify, record, render, setTab, clearRecent, clearAll, toast, cleanTitle, mountSources, importFiles,
    get canLink() { return canLink; }, get count() { return library.length; },
  };
})();
