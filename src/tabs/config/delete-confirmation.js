const $ = id => document.getElementById(id);

const confirmationModal = $('confirmation-modal');
const confirmButton = $('confirmation-confirm-button');
const cancelButton = $('confirmation-cancel-button');

let initialized = false;
let profileToDelete = null;
let onDeleteHandler = null;

function closeModal() {
    if (confirmationModal) confirmationModal.style.display = 'none';
    profileToDelete = null;
}

function doDeleteCurrentProfile() {
    if (profileToDelete === null) return;
    onDeleteHandler?.(profileToDelete);
    profileToDelete = null;
    closeModal();
}

export function initDeleteConfirmation(onDelete) {
    onDeleteHandler = onDelete;

    if (initialized) {
        return {
            confirmDelete,
            closeDeleteModal: closeModal,
        };
    }

    initialized = true;

    confirmButton?.addEventListener('click', doDeleteCurrentProfile);
    cancelButton?.addEventListener('click', closeModal);
    confirmationModal?.addEventListener('click', e => {
        if (e.target === confirmationModal) closeModal();
    });

    return {
        confirmDelete,
        closeDeleteModal: closeModal,
    };
}

export function confirmDelete(id) {
    profileToDelete = id;
    if (confirmationModal) confirmationModal.style.display = 'flex';
}
