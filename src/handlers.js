
import * as CONSTS from "./constants.js"

const usernameConfigInput = document.getElementById("username-config-input");
const usernameModalInput = document.getElementById('username-input');
const loginModal = document.getElementById('login-modal');
const loginButton = document.getElementById('login-button');
const loginRememberMe = document.getElementById('remember-me');
const loginRememberMeConfig = document.getElementById('remember-me-config');

// Taby.


const TAB_NAME_PREFIX = "tab-";


const TABS = []
const TAB_BUTTONS = document.getElementsByClassName("tab-button")
const GRAPH_TAB_ID = "tab-graph";
const DESKTOP_GRAPH_MEDIA = "(min-width: 1100px)";
const GRAPH_SIDEBAR_STORAGE_KEY = "graph-sidebar-visible";

let graphSidebarVisible = localStorage.getItem(GRAPH_SIDEBAR_STORAGE_KEY) !== "0";

function isDesktopGraphPinned() {
    return window.matchMedia(DESKTOP_GRAPH_MEDIA).matches;
}

function getGraphTab() {
    return document.getElementById(GRAPH_TAB_ID);
}

function getGraphButton() {
    return document.getElementById("graph-button");
}

function setGraphSidebarVisible(visible) {
    graphSidebarVisible = visible;
    const tabsEl = document.getElementById("tabs");
    if (tabsEl) {
        tabsEl.classList.toggle("graph-sidebar-hidden", !visible);
    }

    const graphButton = getGraphButton();
    if (graphButton) {
        graphButton.classList.toggle("selected", visible && isDesktopGraphPinned());
    }

    localStorage.setItem(GRAPH_SIDEBAR_STORAGE_KEY, visible ? "1" : "0");
}

function toggleGraphSidebar() {
    setGraphSidebarVisible(!graphSidebarVisible);
}

function applyDesktopGraphPinning() {
    const graphTab = getGraphTab();
    if (!graphTab) return;

    if (isDesktopGraphPinned()) {
        graphTab.classList.add("opened");
        setGraphSidebarVisible(graphSidebarVisible);
        if (currentTab && currentTab.id === GRAPH_TAB_ID) {
            const chatTab = document.getElementById("tab-chat");
            if (chatTab) {
                openTab(chatTab);
                return;
            }
        }
    } else if (currentTab && currentTab.id !== GRAPH_TAB_ID) {
        closeTab(graphTab);
        const graphButton = getGraphButton();
        if (graphButton) {
            graphButton.classList.remove("selected");
        }
    }
}


function closeTab(tab) {
    tab.classList.remove("opened");
    tab.button.classList.remove("selected"); // Odznac tlacidlo tabu.
}

function closeAllTabs() {
    const graphTab = getGraphTab();
    for (const tab of TABS) {
        if (isDesktopGraphPinned() && graphTab && tab === graphTab) {
            continue;
        }
        closeTab(tab);
    }
}

let currentTab = null;
function openTab(tab) {
    closeAllTabs(); // Nech je otvoreny len jeden tab.

    currentTab = tab;
    refreshLocalStorageData()

    tab.classList.add("opened"); // Otvor tab.
    tab.button.classList.add("selected"); // Oznac tlacidlo tabu.

    applyDesktopGraphPinning();
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
        if (name === "graph" && isDesktopGraphPinned()) {
            toggleGraphSidebar();
            return;
        }

        openTab(tab);
    })

    TABS.push(tab)

    closeTab(tab); // Uisti sa, ze je zavrety pri starte.
}

const savedTabId = localStorage.getItem("current-tab");
if (savedTabId != null) {
    const savedTab = document.getElementById(savedTabId);
    if (savedTab != null) {
        openTab(savedTab);
    } // Inak pouzi predvoleny tab.
}

if (currentTab == null && TABS.length > 0) {
    openTab(TABS[0]);
}

applyDesktopGraphPinning();
window.addEventListener("resize", applyDesktopGraphPinning);

// Uisti sa, ze kontajner tabov je viditelny.
document.getElementById("tabs").style.display = "flex";

// Limity.

for (const usernameInput of document.getElementsByClassName("username-input")) {
    usernameInput.maxLength = CONSTS.MAX_USERNAME_LENGTH;
}

for (const messageInput of document.getElementsByClassName("message-input")) {
    messageInput.maxLength = CONSTS.MAX_MESSAGE_LENGTH;
}


// Prepinanie farbnej schemy.

const themeToggleButton = document.getElementById("theme-toggle-button");

function onThemeChanged(darkScheme) {
    // localStorage sem ukladame v refreshLocalStorageData().
    refreshLocalStorageData();
    // Ikona sa prepina cez CSS premennu --theme-button-icon.
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

// Labely checkboxov.

// Klik na label prepne aj checkbox.
for (const label of document.getElementsByTagName("label")) {
    if (label.htmlFor != "") {
        const checkbox = document.getElementById(label.htmlFor)
        if (checkbox != null && checkbox.tagName == "INPUT" && checkbox.type == "checkbox") {
            label.classList.add("unselectable");
        }
    }
}

// Prihlasovaci modal.

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

function onUserLoggedIn() {
    window.userLoggedIn = true;
    window.dispatchEvent(new CustomEvent("user-logged"));
}

document.addEventListener('DOMContentLoaded', () => {
    const savedUsername = localStorage.getItem('username');
    if (!savedUsername) {
        localStorage.clear(); // Neznamy pouzivatel, zmaz ulozene data.
        loginModal.style.display = 'flex'; // Zobraz modal.
        usernameModalInput.focus(); // Nastav focus dovnutra.
        loginButton.addEventListener('click', () => {
            const usernameInput = document.getElementById('username-input').value;
            if (usernameInput) {
                refreshLocalStorageData();

                usernameConfigInput.value = usernameInput;
                loginRememberMeConfig.checked = loginRememberMe.checked;
                loginModal.style.display = 'none'; // Skry modal.
            }

            onUserLoggedIn();
        });
    } else {
        usernameConfigInput.value = savedUsername;
        onUserLoggedIn();
        loginRememberMeConfig.checked = true; // Ak je meno ulozene, zapamatanie ma byt true.
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
