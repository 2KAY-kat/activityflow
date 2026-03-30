import { Toast } from './toast.js';

let tickets = [];
let editingTicketId = null;
let ticketToDelete = null;
let teamToDelete = null;
let draggedTicketId = null;
const toast = new Toast();
let authToken = localStorage.getItem('authToken');
let isLoginMode = true;
let currentTeamId = localStorage.getItem('currentTeamId');
let currentUser = null;
let myTeams = [];
let teamMembers = [];
let githubRepositories = [];
let githubInstallations = [];
let pendingGitHubInstall = null;
let selectedTeamGitHubStatus = null;
let pendingInviteContext = null;
let pendingInvitePromptShown = false;
let pendingTicketFocusId = null;
let presenceHeartbeatId = null;

// Expose functions to window
window.openTeamsModal = openTeamsModal;
window.closeModal = closeModal;
window.switchTeamTab = switchTeamTab;
window.createTeam = createTeam;
window.joinTeam = joinTeam;
window.selectTeam = selectTeam;
window.toggleTeamSourceFields = toggleTeamSourceFields;
window.startGitHubLogin = startGitHubLogin;
window.syncGitHubRepositories = syncGitHubRepositories;
window.installGitHubApp = installGitHubApp;
window.syncTeamGitHubCollaborators = syncTeamGitHubCollaborators;
window.sendManualTeamInvite = sendManualTeamInvite;

// Expose functions to window for inline HTML onclick/ondrop handlers
window.toggleTheme = toggleTheme;
window.syncData = syncData;
window.logout = logout;
window.openTicketModal = openTicketModal;
window.closeTicketModal = closeTicketModal;
window.editTicket = editTicket;
window.promptDeleteTicket = promptDeleteTicket;
window.closeDeleteModal = closeDeleteModal;
window.confirmDelete = confirmDelete;
window.promptDeleteTeam = promptDeleteTeam;
window.closeDeleteTeamModal = closeDeleteTeamModal;
window.confirmDeleteTeam = confirmDeleteTeam;
window.toggleAuthMode = toggleAuthMode;
window.openAccountSwitcher = openAccountSwitcher;
window.addAnotherAccount = addAnotherAccount;
window.switchToAccount = switchToAccount;
window.forgetAccount = forgetAccount;

// Drag and drop handlers
window.dragStart = dragStart;
window.allowDrop = dragOver;
window.drop = drop;

document.addEventListener('DOMContentLoaded', () => {
    hydrateAuthFromHash();
    hydrateInviteContextFromUrl();
    initializeTheme();
    checkAuth();
    checkSystemHealth();
    
    // Auto-select team from storage if possible
    if (authToken && currentTeamId) {
        selectTeam(currentTeamId);
    }
    
    // Poll system health every 30 seconds
    setInterval(checkSystemHealth, 30000);

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            sendPresenceHeartbeat();
        }
    });

    document.getElementById('authForm').addEventListener('submit', handleAuth);
    document.getElementById('ticketForm').addEventListener('submit', saveTicket);
    toggleTeamSourceFields();

    // loadTickets is now called within checkAuth
});

async function checkSystemHealth() {
    const headerStatus = document.getElementById('systemStatus');
    const footerStatus = document.getElementById('footerHealth');
    
    const updateUI = (health) => {
        if (!footerStatus) return;
        const text = footerStatus.querySelector('.status-text');
        const legacyDatabaseStatus = typeof health?.database === 'string' ? health.database : null;
        const databaseStatus = health?.database?.status || legacyDatabaseStatus || 'disconnected';
        const hasGitHubPayload = Boolean(health && typeof health.github === 'object');
        const githubEnabled = hasGitHubPayload ? Boolean(health?.github?.enabled) : false;
        const githubStatus = hasGitHubPayload ? (health?.github?.status || 'error') : 'not_configured';
        const computedStatus = databaseStatus !== 'connected'
            ? 'error'
            : (!githubEnabled || githubStatus !== 'connected')
                ? 'degraded'
                : 'ok';
        const status = health?.status === 'error' ? 'error' : computedStatus;
        const githubLabel = !hasGitHubPayload
            ? 'GitHub health check unavailable on the current server build'
            : !githubEnabled
                ? 'GitHub not configured'
            : githubStatus === 'connected'
                ? 'GitHub connected'
                : health?.github?.message || 'GitHub connection issue';

        if (status === 'ok') {
            footerStatus.className = 'status-indicator online';
            if (text) text.textContent = 'System OK';
            footerStatus.title = `System Status: Database connected | ${githubLabel}`;
        } else if (status === 'degraded') {
            footerStatus.className = 'status-indicator degraded';
            if (text) text.textContent = 'System Degraded';
            footerStatus.title = `System Status: Database ${databaseStatus} | ${githubLabel}`;
        } else {
            footerStatus.className = 'status-indicator offline';
            if (text) text.textContent = 'System Offline';
            footerStatus.title = `System Status: ${health?.database?.message || 'Database connection error'}`;
        }
    };

    try {
        const res = await fetch('/api/health');
        const data = await res.json().catch(() => null);
        updateUI(data);
    } catch (error) {
        updateUI(null);
    }
}

function initializeTheme() {
    const savedTheme = localStorage.getItem('theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeIcon(savedTheme);
}

function hydrateAuthFromHash() {
    const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '';
    if (!hash) return;

    const params = new URLSearchParams(hash);
    const token = params.get('authToken');
    const githubInstallationId = params.get('githubInstallationId');
    const setupAction = params.get('setupAction');

    if (!token && !githubInstallationId) return;

    if (token) {
        authToken = token;
        localStorage.setItem('authToken', token);
        currentTeamId = null;
        localStorage.removeItem('currentTeamId');
    }

    if (githubInstallationId) {
        pendingGitHubInstall = {
            installationId: githubInstallationId,
            setupAction: setupAction || 'install'
        };
    }

    window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
}

function setPendingInviteContext(context) {
    pendingInviteContext = context;

    if (context) {
        sessionStorage.setItem('pendingInviteContext', JSON.stringify(context));
    } else {
        sessionStorage.removeItem('pendingInviteContext');
    }
}

function clearPendingInviteContext() {
    setPendingInviteContext(null);
    pendingInvitePromptShown = false;
}

function hydrateInviteContextFromUrl() {
    const storedContext = sessionStorage.getItem('pendingInviteContext');
    if (storedContext) {
        try {
            pendingInviteContext = JSON.parse(storedContext);
        } catch (error) {
            sessionStorage.removeItem('pendingInviteContext');
        }
    }

    const params = new URLSearchParams(window.location.search);
    const inviteCode = params.get('inviteCode');
    const teamId = params.get('teamId');
    const ticketId = params.get('ticketId');

    if (!inviteCode && !teamId && !ticketId) return;

    setPendingInviteContext({
        inviteCode: inviteCode ? inviteCode.toUpperCase() : null,
        teamId: teamId ? parseInt(teamId, 10) : null,
        ticketId: ticketId ? parseInt(ticketId, 10) : null
    });

    const nextUrl = `${window.location.pathname}${window.location.hash || ''}`;
    window.history.replaceState({}, document.title, nextUrl);
}

function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    updateThemeIcon(newTheme);
}

function startGitHubLogin() {
    const returnTo = `${window.location.pathname}${window.location.search}`;
    window.location.href = `/api/auth/github/start?returnTo=${encodeURIComponent(returnTo)}`;
}

function getCurrentUserLabel() {
    if (!currentUser) return 'Unknown User';
    return currentUser.githubLogin || currentUser.email || 'Unknown User';
}

function getCurrentUserAvatarMarkup() {
    if (currentUser?.githubAvatarUrl) {
        return `<img src="${currentUser.githubAvatarUrl}" alt="${getCurrentUserLabel()}">`;
    }

    return getCurrentUserLabel().substring(0, 2).toUpperCase();
}

function renderCurrentUserBadge() {
    const badge = document.getElementById('currentUserBadge');
    if (!badge) return;

    if (!authToken || !currentUser) {
        badge.style.display = 'none';
        badge.innerHTML = '';
        return;
    }

    const secondary = currentUser.githubLogin && currentUser.email && currentUser.githubLogin !== currentUser.email
        ? currentUser.email
        : currentUser.authSource === 'GITHUB'
            ? 'GitHub account'
            : 'Email account';

    badge.style.display = 'inline-flex';
    badge.innerHTML = `
        <div class="user-badge-avatar">${getCurrentUserAvatarMarkup()}</div>
        <div class="user-badge-text">
            <span class="user-badge-label">Signed In</span>
            <span class="user-badge-value" title="${getCurrentUserLabel()}">${getCurrentUserLabel()}</span>
        </div>
    `;
    badge.title = secondary;
}

async function loadCurrentUser() {
    if (!authToken) {
        currentUser = null;
        renderCurrentUserBadge();
        return;
    }

    try {
        const res = await fetch('/api/auth/me', {
            headers: { Authorization: `Bearer ${authToken}` }
        });

        if (res.ok) {
            currentUser = await res.json();
            renderCurrentUserBadge();
            // Save account to storage for switching
            if (currentUser && authToken) {
                saveAccountToStorage(authToken, currentUser);
            }
        } else if (res.status === 401) {
            logout();
        }
    } catch (error) {
        console.error('Failed to load current user:', error);
    }
}

function updateThemeIcon(theme) {
    const themeIcon = document.getElementById('themeIcon');
    if (themeIcon) {
        themeIcon.className = theme === 'light' ? 'fa-solid fa-moon' : 'fa-solid fa-sun';
    }
}

function checkAuth() {
    const authModal = document.getElementById('authModal');
    const landingPage = document.getElementById('landingPage');
    const dashboard = document.getElementById('dashboard');
    const logoutBtn = document.getElementById('logoutBtn');
    const headerNewTicket = document.getElementById('headerNewTicket');
    const headerLogin = document.getElementById('headerLogin');
    const teamsBtn = document.getElementById('headerTeamsBtn');
    const syncBtn = document.getElementById('headerSyncBtn');
    
    if (authToken) {
        if (!currentUser) {
            loadCurrentUser();
        } else {
            renderCurrentUserBadge();
        }
        authModal.classList.remove('active');
        if (landingPage) landingPage.style.display = 'none';
        if (dashboard) dashboard.style.display = 'flex';
        if (logoutBtn) logoutBtn.style.display = 'flex';
        if (headerNewTicket) headerNewTicket.style.display = 'flex';
        if (headerLogin) headerLogin.style.display = 'none';
        if (teamsBtn) teamsBtn.style.display = 'flex';
        if (syncBtn) syncBtn.style.display = 'flex';
        if (currentTeamId) {
            loadTickets();
            startPresenceHeartbeat();
        } else {
            stopPresenceHeartbeat();
            loadTeams();
        }

        if (pendingGitHubInstall) {
            handlePendingGitHubInstall();
        }
    } else {
        stopPresenceHeartbeat();
        if (landingPage) landingPage.style.display = 'flex';
        if (dashboard) dashboard.style.display = 'none';
        if (logoutBtn) logoutBtn.style.display = 'none';
        if (headerNewTicket) headerNewTicket.style.display = 'none';
        if (headerLogin) headerLogin.style.display = 'flex';
        if (teamsBtn) teamsBtn.style.display = 'none';
        if (syncBtn) syncBtn.style.display = 'none';
        tickets = [];
        teamMembers = [];
        renderBoard();
        renderCurrentUserBadge();
        renderTeamInvitePanel();

        if (pendingInviteContext) {
            authModal.classList.add('active');
        }
    }
}

async function handlePendingGitHubInstall() {
    if (!pendingGitHubInstall) return;

    const installState = pendingGitHubInstall;
    pendingGitHubInstall = null;

    if (!authToken) {
        toast.show('GitHub App installed. Log in to sync repositories.', 'error');
        return;
    }

    toast.show(`GitHub App ${installState.setupAction === 'update' ? 'updated' : 'installed'}. Syncing repositories...`, 'success');
    await syncGitHubRepositories(installState.installationId);
}

async function handlePendingInviteContext() {
    if (!authToken || !pendingInviteContext) return;

    const targetTeam = pendingInviteContext.teamId
        ? myTeams.find(team => team.id == pendingInviteContext.teamId)
        : null;

    if (targetTeam) {
        pendingTicketFocusId = pendingInviteContext.ticketId || null;
        const targetTeamId = targetTeam.id;
        clearPendingInviteContext();

        if (currentTeamId != targetTeamId) {
            await selectTeam(targetTeamId);
        } else {
            await loadTickets();
        }

        toast.show('Assignment ready on your board.', 'success');
        return;
    }

    const inviteCodeInput = document.getElementById('inviteCodeInput');
    if (inviteCodeInput && pendingInviteContext.inviteCode) {
        inviteCodeInput.value = pendingInviteContext.inviteCode;
    }

    if (!pendingInvitePromptShown) {
        document.getElementById('teamsModal').classList.add('active');
        switchTeamTab('joinCreate');
        toast.show('Confirm team contribution to unlock your assignment.', 'success');
        pendingInvitePromptShown = true;
    }
}

function stopPresenceHeartbeat() {
    if (presenceHeartbeatId) {
        clearInterval(presenceHeartbeatId);
        presenceHeartbeatId = null;
    }
}

async function sendPresenceHeartbeat() {
    if (!authToken || !currentTeamId || document.visibilityState === 'hidden') return;

    try {
        const res = await fetch(`/api/teams/${currentTeamId}/presence`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${authToken}` }
        });

        if (res.ok) {
            const data = await res.json().catch(() => ({}));
            if (currentUser) {
                currentUser.lastActiveAt = data.lastActiveAt || new Date().toISOString();
            }

            const teamsModal = document.getElementById('teamsModal');
            if (teamsModal?.classList.contains('active')) {
                await loadTeamMembers(currentTeamId);
            }
        } else if (res.status === 401) {
            logout();
        } else if (res.status === 403) {
            stopPresenceHeartbeat();
        }
    } catch (error) {
        console.error('Failed to update presence:', error);
    }
}

function startPresenceHeartbeat() {
    stopPresenceHeartbeat();

    if (!authToken || !currentTeamId) {
        return;
    }

    sendPresenceHeartbeat();
    presenceHeartbeatId = window.setInterval(() => {
        sendPresenceHeartbeat();
    }, 45000);
}

function toggleAuthMode() {
    isLoginMode = !isLoginMode;
    const btn = document.getElementById('authSubmitBtn');
    const toggleText = document.getElementById('authToggleText');
    const toggleBtn = document.getElementById('authToggleBtn');
    
    if (isLoginMode) {
        btn.textContent = 'Login';
        toggleText.textContent = "Don't have an account? ";
        toggleBtn.textContent = "Sign Up";
    } else {
        btn.textContent = 'Sign Up';
        toggleText.textContent = "Already have an account? ";
        toggleBtn.textContent = "Login";
    }
}

async function handleAuth(e) {
    e.preventDefault();
    const btn = document.getElementById('authSubmitBtn');
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const endpoint = isLoginMode ? '/api/auth/login' : '/api/auth/register';

    setLoading(btn, true);
    try {
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        
        if (res.ok) {
            if (isLoginMode) {
                authToken = data.token;
                currentUser = null;
                localStorage.setItem('authToken', authToken);
                currentTeamId = null;
                localStorage.removeItem('currentTeamId');
                toast.show('Logged in successfully', 'success');
                checkAuth();
                loadTeams();
            } else {
                toast.show('Account created. Please login.', 'success');
                toggleAuthMode();
            }
        } else {
            toast.show(data.error || 'Authentication failed', 'error');
        }
    } catch (error) {
        toast.show('Network error', 'error');
    } finally {
        setLoading(btn, false);
    }
}

function logout() {
    stopPresenceHeartbeat();
    authToken = null;
    currentTeamId = null;
    currentUser = null;
    githubRepositories = [];
    githubInstallations = [];
    selectedTeamGitHubStatus = null;
    localStorage.removeItem('authToken');
    localStorage.removeItem('currentTeamId');
    toast.show('Logged out', 'success');
    closeModal('accountSwitcherModal');
    checkAuth();
}

/* Account Switcher Functions */
function saveAccountToStorage(token, user) {
    const accounts = JSON.parse(localStorage.getItem('savedAccounts') || '[]');
    
    // Check if account already exists
    const existingIndex = accounts.findIndex(acc => acc.email === user.email);
    
    const accountData = {
        token,
        email: user.email,
        id: user.id,
        githubLogin: user.githubLogin || null,
        githubAvatarUrl: user.githubAvatarUrl || null,
        savedAt: new Date().toISOString()
    };
    
    if (existingIndex >= 0) {
        // Update existing account
        accounts[existingIndex] = accountData;
    } else {
        // Add new account (max 5 saved accounts)
        if (accounts.length < 5) {
            accounts.push(accountData);
        }
    }
    
    localStorage.setItem('savedAccounts', JSON.stringify(accounts));
}

function getSavedAccounts() {
    return JSON.parse(localStorage.getItem('savedAccounts') || '[]');
}

function getCurrentAccountInfo() {
    if (!currentUser) return null;
    return {
        email: currentUser.email,
        id: currentUser.id,
        githubLogin: currentUser.githubLogin || null,
        githubAvatarUrl: currentUser.githubAvatarUrl || null
    };
}

function openAccountSwitcher() {
    const modal = document.getElementById('accountSwitcherModal');
    const currentAccountDisplay = document.getElementById('currentAccountDisplay');
    const accountsList = document.getElementById('accountsList');
    
    // Render current account
    if (currentUser) {
        const accountHtml = `
            <h4 style="margin: 0 0 0.5rem 0; font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em;">Current Account</h4>
            <div class="current-account-card">
                <div class="account-avatar">
                    ${currentUser.githubAvatarUrl ? `<img src="${currentUser.githubAvatarUrl}" alt="${currentUser.email}">` : `<i class="fa-solid fa-user"></i>`}
                </div>
                <div class="account-info">
                    <div class="account-email">${currentUser.email}</div>
                    ${currentUser.githubLogin ? `<div class="account-subtext">GitHub: ${currentUser.githubLogin}</div>` : ''}
                </div>
            </div>
        `;
        currentAccountDisplay.innerHTML = accountHtml;
    }
    
    // Render saved accounts
    const savedAccounts = getSavedAccounts();
    const currentEmail = currentUser?.email;
    
    if (savedAccounts.length === 0) {
        accountsList.innerHTML = '<div class="account-item saved-empty">No saved accounts yet</div>';
    } else {
        accountsList.innerHTML = savedAccounts
            .filter(acc => acc.email !== currentEmail) // Don't show current account
            .map(acc => `
                <div class="account-item">
                    <div class="account-avatar">
                        ${acc.githubAvatarUrl ? `<img src="${acc.githubAvatarUrl}" alt="${acc.email}">` : `<i class="fa-solid fa-user"></i>`}
                    </div>
                    <div class="account-info">
                        <div class="account-email">${acc.email}</div>
                        ${acc.githubLogin ? `<div class="account-subtext">GitHub: ${acc.githubLogin}</div>` : ''}
                    </div>
                    <div class="account-item-actions">
                        <button class="account-switch-btn" onclick="switchToAccount('${acc.email}')">Switch</button>
                        <button class="account-forget-btn" onclick="forgetAccount('${acc.email}')" title="Remove account"><i class="fa-solid fa-trash-can"></i></button>
                    </div>
                </div>
            `).join('');
    }
    
    modal.classList.add('active');
}

function switchToAccount(email) {
    const savedAccounts = getSavedAccounts();
    const account = savedAccounts.find(acc => acc.email === email);
    
    if (!account) {
        toast.show('Account not found', 'error');
        return;
    }
    
    // Save the token and reload
    authToken = account.token;
    localStorage.setItem('authToken', account.token);
    localStorage.removeItem('currentTeamId');
    currentTeamId = null;
    
    toast.show(`Switched to ${email}`, 'success');
    closeModal('accountSwitcherModal');
    checkAuth(); // This will reload the user data
}

function forgetAccount(email) {
    if (!confirm(`Remove ${email} from saved accounts? You can still login manually.`)) {
        return;
    }
    
    let savedAccounts = getSavedAccounts();
    savedAccounts = savedAccounts.filter(acc => acc.email !== email);
    localStorage.setItem('savedAccounts', JSON.stringify(savedAccounts));
    
    toast.show('Account removed', 'success');
    openAccountSwitcher(); // Refresh the modal
}

function addAnotherAccount() {
    closeModal('accountSwitcherModal');
    document.getElementById('authModal').classList.add('active');
}

function getCurrentTeam() {
    return myTeams.find(team => team.id == currentTeamId) || null;
}

function isTeamOwner(team) {
    return Boolean(team && (team.isOwner || team.currentUserRole === 'OWNER'));
}

function getMemberLabel(member) {
    return member.name || member.email || member.login || 'Unknown';
}

function getMemberAvatarText(member) {
    const label = getMemberLabel(member);
    return label.substring(0, 2).toUpperCase();
}

function formatDateTime(value) {
    if (!value) return 'Not synced yet';

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Not synced yet';

    return date.toLocaleString();
}

function formatRelativeTime(value) {
    if (!value) return 'never';

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'never';

    const diffMs = Date.now() - date.getTime();
    const minutes = Math.max(1, Math.round(diffMs / 60000));

    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;

    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h ago`;

    const days = Math.round(hours / 24);
    return `${days}d ago`;
}

function getMemberPresenceText(member) {
    switch (member.status) {
        case 'ACTIVE':
            return 'Active now';
        case 'IDLE':
            return `Idle | Last active ${formatRelativeTime(member.lastActiveAt)}`;
        case 'OFFLINE':
            return `Offline | Last seen ${formatRelativeTime(member.lastActiveAt)}`;
        case 'PENDING':
            return 'Pending team access confirmation';
        case 'UNLINKED':
            return 'No ActivityFlow account linked yet';
        default:
            return 'Status unavailable';
    }
}

function renderTeamGitHubStatus() {
    const container = document.getElementById('teamGitHubStatus');
    const team = getCurrentTeam();

    if (!container) return;

    if (!team || team.sourceType !== 'GITHUB') {
        container.style.display = 'none';
        container.innerHTML = '';
        return;
    }

    const status = selectedTeamGitHubStatus;
    const repositoryFullName = status?.repositoryFullName || team.githubRepository?.fullName || 'GitHub Repository';
    const repositoryUrl = status?.repositoryUrl || team.githubRepository?.htmlUrl || '';
    const defaultBranch = status?.defaultBranch || team.defaultBranch || team.githubRepository?.defaultBranch || 'unknown';
    const collaboratorCount = typeof status?.collaboratorCount === 'number'
        ? status.collaboratorCount
        : teamMembers.filter(member => member.type === 'github').length;
    const linkedCollaboratorCount = typeof status?.linkedCollaboratorCount === 'number'
        ? status.linkedCollaboratorCount
        : teamMembers.filter(member => member.type === 'github' && member.linkedUserId).length;
    const lastSyncedAt = status?.lastSyncedAt || team.lastGithubSyncAt || team.githubRepository?.lastSyncedAt || null;
    const repoLabel = repositoryUrl
        ? `<a href="${repositoryUrl}" target="_blank" rel="noopener noreferrer">${repositoryFullName}</a>`
        : repositoryFullName;
    const emptyMessage = collaboratorCount === 0
        ? '<div style="margin-top: 10px; color: var(--text-muted);">No GitHub collaborators are synced yet. Install the app on the repo and run sync if you need to refresh access.</div>'
        : '';
    const canManageGitHub = isTeamOwner(team);
    const syncAction = canManageGitHub
        ? `<button id="teamGitHubSyncBtn" type="button" class="btn btn-ghost" onclick="syncTeamGitHubCollaborators()">Sync Collaborators</button>`
        : '';

    container.style.display = 'block';
    container.innerHTML = `
        <div style="border: 1px solid var(--border-color); border-radius: 12px; padding: 14px; background: var(--card-bg);">
            <div style="display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; flex-wrap: wrap;">
                <div>
                    <div style="font-weight: 600;">${repoLabel}</div>
                    <div style="font-size: 0.82rem; color: var(--text-muted); margin-top: 6px;">
                        Default branch: ${defaultBranch} | Last sync: ${formatDateTime(lastSyncedAt)}
                    </div>
                    <div style="font-size: 0.82rem; color: var(--text-muted); margin-top: 6px;">
                        ${collaboratorCount} collaborator${collaboratorCount === 1 ? '' : 's'} ready | ${linkedCollaboratorCount} linked to ActivityFlow users
                    </div>
                </div>
                ${syncAction}
            </div>
            ${emptyMessage}
        </div>
    `;
}

function renderTeamInvitePanel() {
    const panel = document.getElementById('teamInvitePanel');
    const team = getCurrentTeam();

    if (!panel) return;

    if (!team || team.sourceType !== 'MANUAL' || !isTeamOwner(team)) {
        panel.style.display = 'none';
        panel.innerHTML = '';
        return;
    }

    panel.style.display = 'block';
    panel.innerHTML = `
        <div class="team-invite-panel">
            <div class="team-invite-copy">
                <div class="team-invite-title">Invite Collaborator</div>
                <div class="team-invite-help">
                    Send an email invite to add someone to this manual team. After they confirm contribution, they will show up in the assignee list for existing tickets.
                </div>
            </div>
            <div class="team-invite-actions">
                <input type="email" id="teamInviteEmail" class="form-control" placeholder="collaborator@company.com" autocomplete="email">
                <button type="button" id="teamInviteSendBtn" class="btn btn-primary" onclick="sendManualTeamInvite()">Send Invite</button>
            </div>
            <div class="team-invite-meta">
                Current invite code <span class="invite-code-pill">${team.inviteCode}</span>
            </div>
        </div>
    `;
}

function renderGitHubIntegrationControls() {
    const installButton = document.getElementById('installGitHubAppBtn');
    const syncButton = document.getElementById('syncGitHubReposBtn');
    const sourceType = document.getElementById('newTeamSourceType')?.value || 'MANUAL';
    const hasInstallation = githubInstallations.length > 0;

    if (installButton) {
        installButton.style.display = sourceType === 'GITHUB' && !hasInstallation ? 'inline-flex' : 'none';
    }

    if (syncButton) {
        syncButton.style.display = sourceType === 'GITHUB' ? 'inline-flex' : 'none';
    }
}

async function sendManualTeamInvite() {
    const team = getCurrentTeam();
    const input = document.getElementById('teamInviteEmail');
    const button = document.getElementById('teamInviteSendBtn');
    const email = input?.value.trim();

    if (!authToken || !team) return;
    if (team.sourceType !== 'MANUAL') {
        toast.show('Manual email invites are only available for manual teams', 'error');
        return;
    }
    if (!isTeamOwner(team)) {
        toast.show('Only team owners can invite collaborators', 'error');
        return;
    }
    if (!email) {
        toast.show('Collaborator email is required', 'error');
        return;
    }

    setLoading(button, true);
    try {
        const res = await fetch(`/api/teams/${team.id}/invitations`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${authToken}`
            },
            body: JSON.stringify({ email })
        });
        const data = await res.json().catch(() => ({}));

        if (res.ok) {
            toast.show(`Invitation sent to ${data.email || email}`, 'success');
            if (input) {
                input.value = '';
            }
        } else {
            toast.show(data.error || 'Failed to send invite', 'error');
        }
    } catch (error) {
        toast.show('Network error while sending invite', 'error');
    } finally {
        setLoading(button, false);
    }
}

function renderGitHubRepositoryOptions() {
    const select = document.getElementById('githubRepositorySelect');
    if (!select) return;

    select.innerHTML = '<option value="">Select a synced repository</option>' +
        githubRepositories.map(repo => `<option value="${repo.id}">${repo.fullName}</option>`).join('');
}

function toggleTeamSourceFields() {
    const sourceType = document.getElementById('newTeamSourceType')?.value || 'MANUAL';
    const githubFields = document.getElementById('githubTeamFields');

    if (githubFields) {
        githubFields.style.display = sourceType === 'GITHUB' ? 'block' : 'none';
    }

    renderGitHubIntegrationControls();
}

async function loadGitHubRepositories() {
    if (!authToken) return;

    try {
        const res = await fetch('/api/github/repositories', {
            headers: { Authorization: `Bearer ${authToken}` }
        });

        if (res.ok) {
            githubRepositories = await res.json();
            renderGitHubRepositoryOptions();
        }
    } catch (error) {
        console.error('Failed to load GitHub repositories:', error);
    }
}

async function loadGitHubInstallations() {
    if (!authToken) return;

    try {
        const res = await fetch('/api/github/installations', {
            headers: { Authorization: `Bearer ${authToken}` }
        });

        if (res.ok) {
            githubInstallations = await res.json();
            renderGitHubIntegrationControls();
        }
    } catch (error) {
        console.error('Failed to load GitHub installations:', error);
    }
}

async function loadTeamGitHubStatus(teamId) {
    const team = myTeams.find(item => item.id == teamId);

    if (!authToken || !team || team.sourceType !== 'GITHUB') {
        selectedTeamGitHubStatus = null;
        renderTeamGitHubStatus();
        return;
    }

    try {
        const res = await fetch(`/api/teams/${teamId}/github/status`, {
            headers: { Authorization: `Bearer ${authToken}` }
        });

        if (res.ok) {
            selectedTeamGitHubStatus = await res.json();
        } else {
            selectedTeamGitHubStatus = null;
        }
    } catch (error) {
        console.error('Failed to load GitHub team status:', error);
        selectedTeamGitHubStatus = null;
    }

    renderTeamGitHubStatus();
}

async function syncGitHubRepositories(installationId = null) {
    if (!authToken) return;

    try {
        const res = await fetch('/api/github/installations/sync', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(installationId ? { installationId } : {})
        });

        const data = await res.json().catch(() => ({}));

        if (res.ok) {
            toast.show(`GitHub sync complete${data.repositoryCount ? ` (${data.repositoryCount} repos)` : ''}`, 'success');
            await loadGitHubInstallations();
            await loadGitHubRepositories();
        } else {
            if (res.status === 409 && data.installUrl) {
                toast.show(data.error || 'Install the GitHub App before syncing repositories', 'error');
            } else {
                toast.show(data.error || 'Failed to sync GitHub repositories', 'error');
            }
        }
    } catch (error) {
        toast.show('Network error while syncing GitHub repositories', 'error');
    }
}

async function installGitHubApp() {
    if (!authToken) return;

    try {
        const res = await fetch('/api/github/install-url', {
            headers: { Authorization: `Bearer ${authToken}` }
        });
        const data = await res.json().catch(() => ({}));

        if (res.ok && data.installUrl) {
            window.location.href = data.installUrl;
        } else {
            toast.show(data.error || 'Failed to open GitHub App installation', 'error');
        }
    } catch (error) {
        toast.show('Network error while opening GitHub install', 'error');
    }
}

async function syncTeamGitHubCollaborators() {
    if (!authToken || !currentTeamId) return;

    const button = document.getElementById('teamGitHubSyncBtn');
    if (button) {
        button.disabled = true;
        button.textContent = 'Syncing...';
    }

    try {
        const res = await fetch(`/api/teams/${currentTeamId}/github/sync`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${authToken}` }
        });
        const data = await res.json().catch(() => ({}));

        if (res.ok) {
            selectedTeamGitHubStatus = data;
            toast.show(`GitHub collaborators synced${typeof data.collaboratorCount === 'number' ? ` (${data.collaboratorCount})` : ''}`, 'success');
            await loadTeams();
            await loadTeamMembers(currentTeamId);
        } else {
            toast.show(data.error || 'Failed to sync GitHub collaborators', 'error');
        }
    } catch (error) {
        toast.show('Network error while syncing GitHub collaborators', 'error');
    } finally {
        renderTeamGitHubStatus();
    }
}

async function loadTickets() {
    if (!authToken) return;
    renderSkeletons();
    
    try {
        const url = currentTeamId ? `/api/tickets?teamId=${currentTeamId}` : '/api/tickets';
        const res = await fetch(url, {
            headers: { Authorization: `Bearer ${authToken}` }
        });
        if (res.ok) {
            const data = await res.json();
            tickets = data;
            renderBoard();
        } else if (res.status === 401) {
            logout();
        } else if (res.status === 403) {
            currentTeamId = null;
            localStorage.removeItem('currentTeamId');
            stopPresenceHeartbeat();
            tickets = [];
            renderBoard();
            toast.show('Your saved team is not available for this account', 'error');
            loadTeams();
        }
    } catch (error) {
        toast.show('Error loading tickets', 'error');
    }
}

function renderSkeletons() {
    const cols = ['col-todo', 'col-inprogress', 'col-done'];
    cols.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.innerHTML = Array(3).fill(0).map(() => `
            <div class="skeleton-card">
                <div class="skeleton-box skeleton-title"></div>
                <div class="skeleton-box skeleton-text"></div>
                <div class="skeleton-box skeleton-text-short"></div>
                <div class="skeleton-footer">
                    <div class="skeleton-box skeleton-badge"></div>
                    <div class="skeleton-box skeleton-avatar"></div>
                </div>
            </div>
        `).join('');
    });
}

function syncData() {
    if (authToken) {
        loadTickets().then(() => toast.show('Board synced', 'success'));
    }
}

function renderBoard() {
    const columns = {
        'To Do': document.getElementById('col-todo'),
        'In Progress': document.getElementById('col-inprogress'),
        'Done': document.getElementById('col-done')
    };

    const counts = { 'To Do': 0, 'In Progress': 0, 'Done': 0 };

    Object.values(columns).forEach(col => col.innerHTML = '');

    tickets.forEach(ticket => {
        const col = columns[ticket.status] || columns['To Do'];
        counts[ticket.status]++;
        
        const card = document.createElement('div');
        card.className = 'ticket-card';
        if (pendingTicketFocusId && String(ticket.id) === String(pendingTicketFocusId)) {
            card.classList.add('ticket-card-focus');
        }
        card.dataset.ticketId = ticket.id;
        card.draggable = true;
        card.ondragstart = (e) => dragStart(e, ticket.id);
        
        const priorityLower = ticket.priority.toLowerCase();
        const collaborator = ticket.assigneeCollaborator;
        const assigneeLabel = collaborator
            ? (collaborator.displayName || collaborator.login || collaborator.email || 'GitHub Collaborator')
            : (ticket.assignee ? ticket.assignee.email : 'Unassigned');
        const initials = assigneeLabel.substring(0, 2).toUpperCase();

        card.innerHTML = `
            <div class="ticket-header">
                <div class="ticket-title">${ticket.title}</div>
                <div class="ticket-actions">
                    <button class="icon-btn edit" onclick="editTicket('${ticket.id}')" title="Edit"><i class="fa-solid fa-pen"></i></button>
                    <button class="icon-btn delete" onclick="promptDeleteTicket('${ticket.id}')" title="Delete"><i class="fa-solid fa-trash"></i></button>
                </div>
            </div>
            ${ticket.description ? `<div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 4px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">${ticket.description}</div>` : ''}
            <div class="ticket-footer">
                <span class="badge priority-${priorityLower}">${ticket.priority}</span>
                <div class="assignee-avatar" title="${assigneeLabel}">${initials}</div>
            </div>
        `;
        col.appendChild(card);
    });

    document.getElementById('count-todo').textContent = counts['To Do'];
    document.getElementById('count-inprogress').textContent = counts['In Progress'];
    document.getElementById('count-done').textContent = counts['Done'];

    if (pendingTicketFocusId) {
        const focusedCard = document.querySelector(`.ticket-card[data-ticket-id="${pendingTicketFocusId}"]`);
        if (focusedCard) {
            focusedCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
            setTimeout(() => focusedCard.classList.remove('ticket-card-focus'), 3500);
            pendingTicketFocusId = null;
        }
    }
}

// Modal Handlers
function openTicketModal() {
    document.getElementById('ticketForm').reset();
    editingTicketId = null;
    document.getElementById('modalTitle').textContent = 'Create Ticket';
    document.getElementById('ticketModal').classList.add('active');
}

function closeTicketModal() {
    document.getElementById('ticketModal').classList.remove('active');
}

async function saveTicket(e) {
    e.preventDefault();
    if (!authToken) return;

    const btn = document.getElementById('saveTicketBtn');
    const currentTeam = getCurrentTeam();
    const assigneeValue = document.getElementById('ticketAssignee').value
        ? parseInt(document.getElementById('ticketAssignee').value)
        : null;
    const ticketData = {
        title: document.getElementById('ticketTitle').value,
        description: document.getElementById('ticketDescription').value,
        priority: document.getElementById('ticketPriority').value,
        assigneeId: currentTeam?.sourceType === 'GITHUB' ? null : assigneeValue,
        assigneeCollaboratorId: currentTeam?.sourceType === 'GITHUB' ? assigneeValue : null,
        status: document.getElementById('ticketStatus').value,
        teamId: currentTeamId ? parseInt(currentTeamId) : null
    };

    const isUpdate = !!editingTicketId;
    const url = isUpdate ? `/api/tickets/${editingTicketId}` : '/api/tickets';
    const method = isUpdate ? 'PUT' : 'POST';

    setLoading(btn, true);
    try {
        const res = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${authToken}`
            },
            body: JSON.stringify(ticketData)
        });

        if (res.ok) {
            toast.show(isUpdate ? 'Ticket updated' : 'Ticket created', 'success');
            closeTicketModal();
            loadTickets();
        } else {
            const data = await res.json().catch(() => ({}));
            toast.show(data.error || 'Failed to save ticket', 'error');
        }
    } catch (error) {
        toast.show('Network error', 'error');
    } finally {
        setLoading(btn, false);
    }
}

function setLoading(button, isLoading) {
    if (!button) return;
    if (isLoading) {
        button.classList.add('btn-loading');
        button.disabled = true;
    } else {
        button.classList.remove('btn-loading');
        button.disabled = false;
    }
}

function editTicket(id) {
    const ticket = tickets.find(t => t.id == id);
    if (!ticket) return;

    editingTicketId = id;
    document.getElementById('modalTitle').textContent = 'Edit Ticket';
    document.getElementById('ticketTitle').value = ticket.title;
    document.getElementById('ticketDescription').value = ticket.description || '';
    document.getElementById('ticketPriority').value = ticket.priority;
    document.getElementById('ticketAssignee').value = ticket.assigneeCollaboratorId || ticket.assigneeId || '';
    document.getElementById('ticketStatus').value = ticket.status;

    document.getElementById('ticketModal').classList.add('active');
}

function promptDeleteTicket(id) {
    ticketToDelete = id;
    document.getElementById('deleteModal').classList.add('active');
}

function closeDeleteModal() {
    ticketToDelete = null;
    document.getElementById('deleteModal').classList.remove('active');
}

async function confirmDelete() {
    if (!ticketToDelete || !authToken) return;
    
    try {
        const res = await fetch(`/api/tickets/${ticketToDelete}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${authToken}` }
        });
        if (res.ok) {
            toast.show('Ticket deleted', 'success');
            closeDeleteModal();
            loadTickets();
        } else {
            toast.show('Failed to delete ticket', 'error');
        }
    } catch (error) {
        toast.show('Network error', 'error');
    }
}

// Drag and Drop
function dragStart(e, id) {
    draggedTicketId = id;
    e.dataTransfer.effectAllowed = 'move';
    // Firefox requires setting data
    e.dataTransfer.setData('text/plain', id);
    setTimeout(() => {
        e.target.style.opacity = '0.5';
    }, 0);
}

function dragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
}

async function drop(e) {
    e.preventDefault();
    const id = draggedTicketId;
    if (!id) return;

    // reset opacity of all cards just in case
    document.querySelectorAll('.ticket-card').forEach(c => c.style.opacity = '1');

    // Determine the closest column
    const column = e.target.closest('.column');
    if (!column) return;

    const newStatus = column.getAttribute('data-status');
    const ticket = tickets.find(t => t.id == id);

    if (ticket && ticket.status !== newStatus) {
        // Optimistic UI update
        ticket.status = newStatus;
        renderBoard();

        // API Request
        try {
            const res = await fetch(`/api/tickets/${id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${authToken}`
                },
                body: JSON.stringify({ status: newStatus })
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || 'Failed to update status');
            }
        } catch (error) {
            toast.show(error.message || 'Failed to update status', 'error');
            loadTickets(); // Revert on failure
        }
    }
    draggedTicketId = null;
}

// Team Management Functions
async function openTeamsModal() {
    document.getElementById('teamsModal').classList.add('active');
    await loadTeams();
    await loadGitHubInstallations();
    await loadGitHubRepositories();

    if (currentTeamId) {
        await loadTeamGitHubStatus(currentTeamId);
    }
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
}

function switchTeamTab(tab) {
    const myTeamsButton = document.getElementById('teamsTabButtonMyTeams');
    const joinCreateButton = document.getElementById('teamsTabButtonJoinCreate');
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    
    if (tab === 'myTeams') {
        myTeamsButton?.classList.add('active');
        document.getElementById('myTeamsTab').classList.add('active');
    } else {
        joinCreateButton?.classList.add('active');
        document.getElementById('joinCreateTab').classList.add('active');
    }
}

async function loadTeams() {
    if (!authToken) return;
    try {
        const res = await fetch('/api/teams', {
            headers: { Authorization: `Bearer ${authToken}` }
        });
        if (res.ok) {
            myTeams = await res.json();
            if (currentTeamId && !myTeams.some(team => team.id == currentTeamId)) {
                currentTeamId = null;
                localStorage.removeItem('currentTeamId');
                selectedTeamGitHubStatus = null;
                stopPresenceHeartbeat();
            }
            renderTeamsList();
            renderTeamGitHubStatus();
            renderTeamInvitePanel();
            await handlePendingInviteContext();
            
            // If no team selected but teams exist, select the first one
            if (!currentTeamId && myTeams.length > 0) {
                const preferredTeam = myTeams.find(team => team.isOwner || team.currentUserRole === 'OWNER') || myTeams[0];
                await selectTeam(preferredTeam.id);
            }
        }
    } catch (error) {
        toast.show('Failed to load teams', 'error');
    }
}

function renderTeamsList() {
    const list = document.getElementById('teamsList');
    if (!list) return;
    
    if (myTeams.length === 0) {
        list.innerHTML = '<p class="text-muted">You are not in any teams yet.</p>';
        return;
    }

    const ownedTeams = myTeams.filter(team => team.isOwner || team.currentUserRole === 'OWNER');
    const joinedTeams = myTeams.filter(team => !team.isOwner && team.currentUserRole !== 'OWNER');

    const renderTeamCards = (teams, emptyLabel) => {
        if (teams.length === 0) {
            return `<p class="text-muted">${emptyLabel}</p>`;
        }

        return teams.map(team => `
            <div class="team-item ${currentTeamId == team.id ? 'active' : ''}" onclick="selectTeam(${team.id})">
                <div class="team-item-main">
                    <strong>${team.name}</strong>
                    <div style="font-size: 0.8em; color: var(--text-muted); margin-top: 4px;">
                        ${team.sourceType === 'GITHUB' && team.githubRepository
                            ? `GitHub: ${team.githubRepository.fullName} | ${team.lastGithubSyncAt ? `Synced ${formatDateTime(team.lastGithubSyncAt)}` : 'Sync pending'}`
                            : 'Manual Team'}
                    </div>
                    <div class="team-stats">
                        <span><i class="fa-solid fa-users"></i> ${team._count.members} Members</span>
                        <span><i class="fa-solid fa-ticket"></i> ${team._count.tickets} Tickets</span>
                    </div>
                </div>
                <div class="team-item-meta">
                    <span class="team-badge ${(team.isOwner || team.currentUserRole === 'OWNER') ? 'owner' : 'member'}">
                        ${(team.isOwner || team.currentUserRole === 'OWNER') ? 'Owner' : 'Member'}
                    </span>
                    <span class="invite-code-pill">${team.inviteCode}</span>
                    ${(team.isOwner || team.currentUserRole === 'OWNER')
                        ? `<button class="icon-btn team-delete-btn" title="Delete Team" onclick="promptDeleteTeam(event, ${team.id})"><i class="fa-solid fa-trash"></i></button>`
                        : ''}
                </div>
            </div>
        `).join('');
    };

    list.innerHTML = `
        <div class="teams-group">
            <div class="teams-group-title">Teams You Created</div>
            ${renderTeamCards(ownedTeams, 'You have not created any teams yet.')}
        </div>
        <div class="teams-group">
            <div class="teams-group-title">Teams You Joined</div>
            ${renderTeamCards(joinedTeams, 'You have not joined any other teams yet.')}
        </div>
    `;
}

async function createTeam() {
    const nameInput = document.getElementById('newTeamName');
    const sourceTypeInput = document.getElementById('newTeamSourceType');
    const githubRepositoryInput = document.getElementById('githubRepositorySelect');
    const name = nameInput.value.trim();
    const sourceType = sourceTypeInput?.value || 'MANUAL';
    const githubRepositoryId = githubRepositoryInput?.value ? parseInt(githubRepositoryInput.value) : null;
    if (!name) return toast.show('Team name is required', 'error');
    if (sourceType === 'GITHUB' && !githubRepositoryId) {
        return toast.show('Select a synced GitHub repository', 'error');
    }

    try {
        const res = await fetch('/api/teams', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${authToken}`
            },
            body: JSON.stringify({ name, sourceType, githubRepositoryId })
        });
        const data = await res.json().catch(() => ({}));
        
        if (res.ok) {
            const createdTeam = data.team || data;
            toast.show('Team created!', 'success');

            if (sourceType === 'GITHUB') {
                if (data.githubSync?.warning) {
                    toast.show(data.githubSync.warning, 'error');
                } else if (typeof data.githubSync?.collaboratorCount === 'number') {
                    toast.show(`GitHub collaborators synced (${data.githubSync.collaboratorCount})`, 'success');
                }
            }

            nameInput.value = '';
            if (sourceTypeInput) sourceTypeInput.value = 'MANUAL';
            if (githubRepositoryInput) githubRepositoryInput.value = '';
            toggleTeamSourceFields();
            await loadTeams();
            if (createdTeam?.id) {
                await selectTeam(createdTeam.id);
            }
            switchTeamTab('myTeams');
        } else {
            toast.show(data.error || 'Failed to create team', 'error');
        }
    } catch (error) {
        toast.show('Network error', 'error');
    }
}

async function joinTeam() {
    const codeInput = document.getElementById('inviteCodeInput');
    const inviteCode = codeInput.value.trim().toUpperCase();
    if (!inviteCode) return toast.show('Invite code is required', 'error');

    try {
        const res = await fetch('/api/teams/join', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${authToken}`
            },
            body: JSON.stringify({ inviteCode })
        });
        const data = await res.json().catch(() => ({}));
        
        if (res.ok) {
            toast.show('Joined team!', 'success');
            codeInput.value = '';
            await loadTeams();
            if (data.team?.id) {
                if (pendingInviteContext?.teamId && Number(data.team.id) === Number(pendingInviteContext.teamId)) {
                    pendingTicketFocusId = pendingInviteContext.ticketId || null;
                    clearPendingInviteContext();
                }
                await selectTeam(data.team.id);
            }
            closeModal('teamsModal');
            switchTeamTab('myTeams');
        } else {
            toast.show(data.error || 'Invalid invite code', 'error');
        }
    } catch (error) {
        toast.show('Network error', 'error');
    }
}

function promptDeleteTeam(event, teamId) {
    if (event?.stopPropagation) {
        event.stopPropagation();
    }

    const team = myTeams.find(item => item.id == teamId);
    if (!team) return;

    teamToDelete = teamId;
    const message = document.getElementById('deleteTeamMessage');
    if (message) {
        message.textContent = `Delete "${team.name}"? This will remove the team and all tickets in it for every member.`;
    }
    document.getElementById('deleteTeamModal').classList.add('active');
}

function closeDeleteTeamModal() {
    teamToDelete = null;
    document.getElementById('deleteTeamModal').classList.remove('active');
}

async function confirmDeleteTeam() {
    if (!teamToDelete || !authToken) return;

    try {
        const res = await fetch(`/api/teams/${teamToDelete}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${authToken}` }
        });
        const data = await res.json().catch(() => ({}));

        if (res.ok) {
            if (currentTeamId == teamToDelete) {
                currentTeamId = null;
                localStorage.removeItem('currentTeamId');
                selectedTeamGitHubStatus = null;
                teamMembers = [];
                stopPresenceHeartbeat();
            }

            toast.show('Team deleted', 'success');
            closeDeleteTeamModal();
            await loadTeams();

            if (currentTeamId) {
                await selectTeam(currentTeamId);
            } else {
                tickets = [];
                renderBoard();
            }
        } else {
            toast.show(data.error || 'Failed to delete team', 'error');
        }
    } catch (error) {
        toast.show('Network error while deleting team', 'error');
    }
}

async function selectTeam(teamId) {
    currentTeamId = teamId;
    localStorage.setItem('currentTeamId', teamId);
    selectedTeamGitHubStatus = null;
    teamMembers = [];
    
    // Update Active Team Info UI
    const team = myTeams.find(t => t.id == teamId);
    if (team) {
        const info = document.getElementById('activeTeamInfo');
        if (info) {
            const repoLabel = team.sourceType === 'GITHUB' && team.githubRepository
                ? team.githubRepository.fullName
                : 'Manual Team';
            const roleLabel = team.isOwner || team.currentUserRole === 'OWNER' ? 'Owner' : 'Member';
            info.innerHTML = `
                <div>
                    <strong>${team.name}</strong>
                    <div style="font-size: 0.85rem; color: var(--text-muted); margin-top: 4px;">
                        ${repoLabel}
                    </div>
                    <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 6px;">
                        Your role: ${roleLabel}
                    </div>
                </div>
                <div class="invite-code-pill" title="Team Invite Code">
                    <i class="fa-solid fa-hashtag"></i> ${team.inviteCode}
                </div>
            `;
        }
        const display = document.getElementById('currentTeamDisplay');
        if (display) {
            display.textContent = team.name;
        }
    }

    renderTeamsList();
    renderMembersList();
    updateAssigneeDropdown();
    renderTeamGitHubStatus();
    renderTeamInvitePanel();
    startPresenceHeartbeat();
    loadTeamMembers(teamId);
    if (team?.sourceType === 'GITHUB') {
        loadTeamGitHubStatus(teamId);
    }
    loadTickets();
}

async function loadTeamMembers(teamId) {
    try {
        const res = await fetch(`/api/teams/${teamId}/members`, {
            headers: { Authorization: `Bearer ${authToken}` }
        });
        if (res.ok) {
            teamMembers = await res.json();
            renderMembersList();
            updateAssigneeDropdown();
            renderTeamGitHubStatus();
            renderTeamInvitePanel();
        }
    } catch (error) {
        console.error('Failed to load members:', error);
    }
}

function renderMembersList() {
    const list = document.getElementById('teamMembersList');
    const section = document.getElementById('teamMembersSection');
    if (!list) return;
    
    section.style.display = 'block';

    if (teamMembers.length === 0) {
        const team = getCurrentTeam();
        list.innerHTML = `
            <li class="member-item" style="justify-content: center; color: var(--text-muted);">
                ${team?.sourceType === 'GITHUB'
                    ? 'No GitHub collaborators have been synced for this repository yet.'
                    : 'No team members available yet.'}
            </li>
        `;
        return;
    }

    list.innerHTML = teamMembers.map(m => `
        <li class="member-item">
            <div class="assignee-avatar">${getMemberAvatarText(m)}</div>
            <div style="flex-grow: 1;">
                <div style="font-weight: 500;">${getMemberLabel(m)}</div>
                ${m.email && m.email !== getMemberLabel(m) ? `<div style="font-size: 0.78rem; color: var(--text-muted);">${m.email}</div>` : ''}
                <div style="font-size: 0.76rem; color: var(--text-muted); margin-top: 4px;">${getMemberPresenceText(m)}</div>
            </div>
            <span class="member-role">${m.role}</span>
            <span class="member-status ${(m.status || 'OFFLINE').toLowerCase()}">${(m.status || 'OFFLINE').replace('_', ' ')}</span>
        </li>
    `).join('');
}

function updateAssigneeDropdown() {
    const select = document.getElementById('ticketAssignee');
    if (!select) return;
    
    const currentValue = select.value;
    select.innerHTML = '<option value="">Unassigned</option>' + 
        teamMembers.map(m => `<option value="${m.id}">${getMemberLabel(m)}</option>`).join('');
    
    select.value = currentValue;
}
