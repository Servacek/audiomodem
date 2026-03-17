/**
 * Utility pre sledovanie verzii WASM kniznice
 */

const STORAGE_KEY = 'wasm-library-version';
const VERSION_HISTORY_KEY = 'wasm-library-version-history';
const LAST_UPDATED_KEY = 'wasm-library-last-updated';

export function getLastSavedVersion() {
    try {
        return localStorage.getItem(STORAGE_KEY);
    } catch {
        return null;
    }
}

export function saveCurrentVersion(version) {
    try {
        localStorage.setItem(STORAGE_KEY, version || '');
    } catch (e) {
        console.error('Failed to save WASM version:', e);
    }
}

export function getLastUpdatedDate() {
    try {
        const timestamp = localStorage.getItem(LAST_UPDATED_KEY);
        return timestamp ? new Date(timestamp) : null;
    } catch {
        return null;
    }
}

export function saveLastUpdatedDate(date = null) {
    try {
        const timestamp = (date || new Date()).toISOString();
        localStorage.setItem(LAST_UPDATED_KEY, timestamp);
    } catch (e) {
        console.error('Failed to save last updated date:', e);
    }
}

export function formatLastUpdatedDate(date) {
    if (!date) return '-';

    try {
        return date.toLocaleDateString('sk-SK', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch {
        return '-';
    }
}

export function checkVersionChanged(currentVersion) {
    const lastVersion = getLastSavedVersion();
    const changed = lastVersion !== null && lastVersion !== currentVersion;
    return {
        changed,
        lastVersion,
        currentVersion
    };
}

export function recordVersionChange(versionChangeInfo) {
    try {
        const timestamp = new Date().toISOString();
        let history = [];
        const historyStr = localStorage.getItem(VERSION_HISTORY_KEY);
        if (historyStr) {
            history = JSON.parse(historyStr);
        }

        history.push({
            timestamp,
            oldVersion: versionChangeInfo.lastVersion,
            newVersion: versionChangeInfo.currentVersion
        });

        const maxHistory = 10;
        if (history.length > maxHistory) {
            history = history.slice(-maxHistory);
        }

        localStorage.setItem(VERSION_HISTORY_KEY, JSON.stringify(history));
    } catch (e) {
        console.error('Failed to record version change:', e);
    }
}

export function getVersionChangeMessage(versionChangeInfo) {
    const { lastVersion, currentVersion } = versionChangeInfo;
    let message = 'Knižnica WASM bola aktualizovaná';

    if (lastVersion && lastVersion !== '-' && currentVersion && currentVersion !== '-') {
        message = `Knižnica WASM bola aktualizovaná: ${lastVersion} -> ${currentVersion}`;
    }

    return message;
}
