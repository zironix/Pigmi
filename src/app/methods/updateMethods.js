const UPDATE_CHECK_PREFERENCE_KEY = 'pigmi.update-check-enabled';

function readUpdateCheckPreference() {
  try {
    return window.localStorage?.getItem(UPDATE_CHECK_PREFERENCE_KEY) === '0' ? 0 : 1;
  } catch {
    return 1;
  }
}

function saveUpdateCheckPreference(value) {
  try {
    window.localStorage?.setItem(UPDATE_CHECK_PREFERENCE_KEY, String(value));
  } catch {
    // Preference persistence is optional in restricted renderer environments.
  }
}

function clearUpdateStatus(context) {
  context.latestVersion = '';
  context.updateAvailable = false;
}

async function loadUpdateStatus(context) {
  if (context.updateCheckEnabled === 0) {
    clearUpdateStatus(context);
    return;
  }
  try {
    const status = await window.electronAPI?.checkForUpdates?.();
    if (context.updateCheckEnabled === 0) {
      clearUpdateStatus(context);
      return;
    }
    if (status?.currentVersion) context.appVersion = status.currentVersion;
    context.latestVersion = status?.latestVersion || '';
    context.updateAvailable = status?.updateAvailable === true;
  } catch {
    // Being offline must not affect the editor or display a false update alert.
    clearUpdateStatus(context);
  }
}

export const updateMethods = {
  async initializeUpdateStatus() {
    this.updateCheckEnabled = readUpdateCheckPreference();

    try {
      const appInfo = await window.electronAPI?.getAppInfo?.();
      if (appInfo?.version) this.appVersion = appInfo.version;
    } catch {
      // Version text is non-critical; leave its placeholder visible.
    }

    await loadUpdateStatus(this);
  },
  setUpdateCheckEnabled(value) {
    const enabled = Number(value) === 0 ? 0 : 1;
    this.updateCheckEnabled = enabled;
    saveUpdateCheckPreference(enabled);
    if (enabled === 0) {
      clearUpdateStatus(this);
      return;
    }
    void loadUpdateStatus(this);
  },
  async openUpdatePage() {
    if (this.updateCheckEnabled === 0 || !this.updateAvailable) return;
    try {
      await window.electronAPI?.openReleasesPage?.();
    } catch {
      // Losing connectivity after the check must not surface an unhandled UI error.
    }
  },
};
