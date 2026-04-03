import { TinyTUS } from '../../../libs/tinytus/tinytus.js';
import * as VersionTracker from '../../wasmVersionTracker.js';

const $ = id => document.getElementById(id);

export function updateLibraryVersionInfo() {
    const versionEl = $('lib-version-display');
    if (!versionEl || !TinyTUS.EXPORTS.get_lib_version) return;

    const ptr = TinyTUS.EXPORTS.get_lib_version();
    const currentVersion = TinyTUS.getStringFromPointer(ptr) || '-';

    const versionChangeInfo = VersionTracker.checkVersionChanged(currentVersion);
    if (versionChangeInfo.changed) {
        VersionTracker.recordVersionChange(versionChangeInfo);
        VersionTracker.saveLastUpdatedDate();
        const message = VersionTracker.getVersionChangeMessage(versionChangeInfo);
        (async () => {
            const { displaySystemMessage } = await import('../chat.js');
            displaySystemMessage(message, 'info');
        })();
    } else if (!VersionTracker.getLastSavedVersion()) {
        VersionTracker.saveLastUpdatedDate();
    }

    VersionTracker.saveCurrentVersion(currentVersion);
    versionEl.textContent = `v${currentVersion}`;

    const lastUpdated = VersionTracker.getLastUpdatedDate();
    if (lastUpdated) versionEl.textContent += ` (${VersionTracker.formatLastUpdatedDate(lastUpdated)})`;
}
