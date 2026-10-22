import { saveGame, SAVE_KEY } from './state.js';

const DEBOUNCE_MS = 900;
const HEARTBEAT_MS = 8000;

export class Autosave {
  constructor(app) {
    this.app = app;
    this.timer = null;
    this.lastPersistedAt = 0;
    this.conflict = false;
    this.conflictNoticed = false;
  }

  seed(savedAt) {
    this.lastPersistedAt = Number(savedAt) || 0;
  }

  schedule() {
    clearTimeout(this.timer);
    this.timer = null;
    if (this.conflict) {
      this.app.ui?.setSaveState('CONFLICT');
      return;
    }
    this.app.ui?.setSaveState('UNSAVED');
    this.timer = setTimeout(() => this.saveNow(), DEBOUNCE_MS);
  }

  saveNow(force = false) {
    clearTimeout(this.timer);
    this.timer = null;
    if (force !== true && this.conflict) {
      this.app.ui?.setSaveState('CONFLICT');
      return false;
    }
    if (force !== true && this.lastPersistedAt) {
      const remote = this.storedSaveTime();
      if (remote > this.lastPersistedAt) {
        this.flagConflict();
        return false;
      }
    }
    const writtenAt = saveGame(this.app.state);
    if (!writtenAt) {
      this.app.ui?.setSaveState('SAVE FAILED', false);
      return false;
    }
    this.lastPersistedAt = writtenAt;
    this.conflict = false;
    this.conflictNoticed = false;
    this.app.ui?.setSaveState('SAVED', true);
    return true;
  }

  storedSaveTime() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return 0;
      const savedAt = JSON.parse(raw)?.savedAt;
      return Number.isFinite(savedAt) ? savedAt : 0;
    } catch {
      return 0;
    }
  }

  flagConflict() {
    this.conflict = true;
    this.app.ui?.setSaveState('CONFLICT');
    if (this.conflictNoticed) return;
    this.conflictNoticed = true;
    this.app.ui?.toast({
      text: 'Autosave paused: this instance changed in another tab.',
      sub: 'Reload to continue from the newer save.',
      tone: 'bad',
      duration: 7000,
    });
  }

  install() {
    setInterval(() => this.saveNow(), HEARTBEAT_MS);
    window.addEventListener('beforeunload', () => this.saveNow());
    window.addEventListener('pagehide', () => this.saveNow());
    window.addEventListener('storage', (event) => {
      if (event.key !== SAVE_KEY || !event.newValue) return;
      try {
        const savedAt = JSON.parse(event.newValue)?.savedAt;
        if (Number.isFinite(savedAt) && savedAt > this.lastPersistedAt) this.flagConflict();
      } catch {
        return;
      }
    });
  }
}
