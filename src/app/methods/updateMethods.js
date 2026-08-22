export const updateMethods = {
  async initializeUpdateStatus() {
    try {
      const appInfo = await window.electronAPI?.getAppInfo?.();
      if (appInfo?.version) this.appVersion = appInfo.version;
    } catch {
      // Version text is non-critical; leave its placeholder visible.
    }

    try {
      const status = await window.electronAPI?.checkForUpdates?.();
      if (status?.currentVersion) this.appVersion = status.currentVersion;
      this.latestVersion = status?.latestVersion || '';
      this.updateAvailable = status?.updateAvailable === true;
    } catch {
      // Being offline must not affect the editor or display a false update alert.
      this.latestVersion = '';
      this.updateAvailable = false;
    }
  },
  async openUpdatePage() {
    if (!this.updateAvailable) return;
    try {
      await window.electronAPI?.openReleasesPage?.();
    } catch {
      // Losing connectivity after the check must not surface an unhandled UI error.
    }
  },
};
