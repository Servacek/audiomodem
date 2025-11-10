
import * as CONSTS from "./constants.js"

const usernameConfigInput = document.getElementById("username-config-input");
const usernameModalInput = document.getElementById('username-input');
const loginModal = document.getElementById('login-modal');
const loginButton = document.getElementById('login-button');
const loginRememberMe = document.getElementById('remember-me');
const loginRememberMeConfig = document.getElementById('remember-me-config');

// TABS


const TAB_NAME_PREFIX = "tab-";


const TABS = []
const TAB_BUTTONS = document.getElementsByClassName("tab-button")


function closeTab(tab) {
    tab.classList.remove("opened");
    tab.button.classList.remove("selected"); // Unselect the tab button
}

function closeAllTabs() {
    for (const tab of TABS) {
        closeTab(tab);
    }
}

let currentTab = null;
function openTab(tab) {
    closeAllTabs(); // Make sure we are the only opened tab.

    currentTab = tab;
    refreshLocalStorageData()

    tab.classList.add("opened"); // Open the tab.
    tab.button.classList.add("selected"); // Select the tab button.
}


for (const button of TAB_BUTTONS) {
    const name = button.id.split("-")[0];
    const tabName = TAB_NAME_PREFIX + name
    const tab = document.getElementById(tabName)
    tab.button = button;
    tab.file = name + ".js";

    // const tabStyle = document.createElement("link");
    // tabStyle.rel = "stylesheet";
    // tabStyle.href = "styles/tabs/" + name + ".css";
    // document.head.appendChild(tabStyle);

    const tabScript = document.createElement("script");
    tabScript.type = "module";
    tabScript.src = "src/tabs/" + name + ".js";
    document.head.appendChild(tabScript);

    button.addEventListener("click", () => {
        openTab(tab);
    })

    TABS.push(tab)

    closeTab(tab); // Make sure all other tabs are closed as well.
}

const savedTabId = localStorage.getItem("current-tab");
if (savedTabId != null) {
    const savedTab = document.getElementById(savedTabId);
    if (savedTab != null) {
        openTab(savedTab);
    } // Else the tab was either deleted or renamed, so fallback to the default tab.
}

if (currentTab == null && TABS.length > 0) {
    openTab(TABS[0]);
}

// Make sure the tabs div is visible
document.getElementById("tabs").style.display = "flex";

// LIMITS

for (const usernameInput of document.getElementsByClassName("username-input")) {
    usernameInput.maxLength = CONSTS.MAX_USERNAME_LENGTH;
}

for (const messageInput of document.getElementsByClassName("message-input")) {
    messageInput.maxLength = CONSTS.MAX_MESSAGE_LENGTH;
}


// THEME TOGGLE BUTTON

const themeToggleButton = document.getElementById("theme-toggle-button");

function onThemeChanged(darkScheme) {
    //localStorage.setItem("theme", darkMode ? "dark-scheme" : "light-scheme");
    refreshLocalStorageData();
    // themeToggleButton.innerHTML = darkScheme ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
}

// document.addEventListener('DOMContentLoaded', () => {


onThemeChanged(document.documentElement.classList.contains(CONSTS.DARK_MODE));
themeToggleButton.addEventListener("click", () => {
    document.documentElement.classList.toggle(CONSTS.DARK_MODE)
    refreshLocalStorageData();
    // onThemeChanged(document.documentElement.classList.toggle(CONSTS.DARK_MODE));
    //themeToggleButton
});

// });

// CHECKBOX LABELS

// Make clicking checkbox labels trigger the checkbox itself.
for (const label of document.getElementsByTagName("label")) {
    if (label.htmlFor != "") {
        const checkbox = document.getElementById(label.htmlFor)
        if (checkbox != null && checkbox.tagName == "INPUT" && checkbox.type == "checkbox") {
            label.classList.add("unselectable");
        }
    }
}

// LOGIN MODAL

function canUseLocalStorage() {
    return loginRememberMe.checked || loginRememberMeConfig.checked;
}

function refreshLocalStorageData() {
    if (canUseLocalStorage()) {
        if (document.themeLoaded == true) {
            localStorage.setItem("theme", document.documentElement.classList.contains(CONSTS.DARK_MODE) ? CONSTS.DARK_MODE : "light-scheme");
        }
        // localStorage.setItem("theme", document.documentElement.classList.contains(CONSTS.DARK_MODE) ? CONSTS.DARK_MODE : "light-scheme");
        localStorage.setItem("username", usernameConfigInput.value);
        if (currentTab != null) {
            localStorage.setItem("current-tab", currentTab.id);
        }

        window.dispatchEvent(new CustomEvent('refresh-local-storage'));
    }
}

loginRememberMeConfig.addEventListener("change", () => {
    if (loginRememberMeConfig.checked) {
        refreshLocalStorageData();
    } else {
        localStorage.clear()
    }
});

usernameConfigInput.addEventListener("input", () => {
    refreshLocalStorageData();
})

usernameModalInput.addEventListener("input", () => {
    loginButton.disabled = !usernameModalInput.value.trim()
})

document.addEventListener('DOMContentLoaded', () => {
    const savedUsername = localStorage.getItem('username');
    if (!savedUsername) {
        localStorage.clear(); // We do not know this user, so forget everything else.
        loginModal.style.display = 'flex'; // Show the modal
        usernameModalInput.focus(); // Focus inside
        loginButton.addEventListener('click', () => {
            const usernameInput = document.getElementById('username-input').value;
            if (usernameInput) {
                refreshLocalStorageData();

                usernameConfigInput.value = usernameInput;
                loginRememberMeConfig.checked = loginRememberMe.checked;
                loginModal.style.display = 'none'; // hide the modal
            }

            window.dispatchEvent(new CustomEvent('user-logged'));
        });
    } else {
        usernameConfigInput.value = savedUsername;
        window.dispatchEvent(new CustomEvent('user-logged'));
        loginRememberMeConfig.checked = true; // Remembered the username so this is most likely true;
    }
});

loginModal.addEventListener('show', () => {
    usernameModalInput.focus();
});

loginModal.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
        event.preventDefault();
        loginButton.click();
    }
});
