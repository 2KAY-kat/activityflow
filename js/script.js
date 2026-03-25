import { Toast } from './toast.js';

let tickets = [];
let editingTicketId = null;
let ticketToDelete = null;
let draggedTicketId = null;
const toast = new Toast();
let authToken = localStorage.getItem('authToken');
let isLoginMode = true;
let currentTeamId = localStorage.getItem('currentTeamId');
let myTeams = [];
let teamMembers = [];

// Expose functions to window
window.openTeamsModal = openTeamsModal;
window.closeModal = closeModal;
window.switchTeamTab = switchTeamTab;
window.createTeam = createTeam;
window.joinTeam = joinTeam;
window.selectTeam = selectTeam;

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
window.toggleAuthMode = toggleAuthMode;

// Drag and drop handlers
window.dragStart = dragStart;
window.allowDrop = dragOver;
window.drop = drop;

document.addEventListener('DOMContentLoaded', () => {
    initializeTheme();
    checkAuth();
    checkSystemHealth();
    
    // Auto-select team from storage if possible
    if (authToken && currentTeamId) {
        selectTeam(currentTeamId);
    }
    
    // Poll system health every 30 seconds
    setInterval(checkSystemHealth, 30000);

    document.getElementById('authForm').addEventListener('submit', handleAuth);
    document.getElementById('ticketForm').addEventListener('submit', saveTicket);

    // loadTickets is now called within checkAuth
});

async function checkSystemHealth() {
    const headerStatus = document.getElementById('systemStatus');
    const footerStatus = document.getElementById('footerHealth');
    
    const updateUI = (isOnline) => {
        if (!footerStatus) return;
        const text = footerStatus.querySelector('.status-text');
        if (isOnline) {
            footerStatus.className = 'status-indicator online';
            if (text) text.textContent = 'System OK';
            footerStatus.title = 'System Status: Connected to Database';
        } else {
            footerStatus.className = 'status-indicator offline';
            if (text) text.textContent = 'System Offline';
            footerStatus.title = 'System Status: Database Connection Error';
        }
    };

    try {
        const res = await fetch('/api/health');
        updateUI(res.ok);
    } catch (error) {
        updateUI(false);
    }
}

function initializeTheme() {
    const savedTheme = localStorage.getItem('theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeIcon(savedTheme);
}

function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    updateThemeIcon(newTheme);
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
    
    if (authToken) {
        authModal.classList.remove('active');
        if (landingPage) landingPage.style.display = 'none';
        if (dashboard) dashboard.style.display = 'flex';
        if (logoutBtn) logoutBtn.style.display = 'flex';
        if (headerNewTicket) headerNewTicket.style.display = 'flex';
        if (headerLogin) headerLogin.style.display = 'none';
        if (currentTeamId) {
            loadTickets();
        } else {
            loadTeams();
        }
    } else {
        if (landingPage) landingPage.style.display = 'flex';
        if (dashboard) dashboard.style.display = 'none';
        if (logoutBtn) logoutBtn.style.display = 'none';
        if (headerNewTicket) headerNewTicket.style.display = 'none';
        if (headerLogin) headerLogin.style.display = 'flex';
        tickets = [];
        renderBoard();
    }
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
                localStorage.setItem('authToken', authToken);
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
    authToken = null;
    localStorage.removeItem('authToken');
    toast.show('Logged out', 'success');
    checkAuth();
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
        card.draggable = true;
        card.ondragstart = (e) => dragStart(e, ticket.id);
        
        const priorityLower = ticket.priority.toLowerCase();
        const assigneeInfo = ticket.assignee ? ticket.assignee.email : 'Unassigned';
        const initials = ticket.assignee ? ticket.assignee.email.substring(0,2).toUpperCase() : '??';

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
                <div class="assignee-avatar" title="${assigneeInfo}">${initials}</div>
            </div>
        `;
        col.appendChild(card);
    });

    document.getElementById('count-todo').textContent = counts['To Do'];
    document.getElementById('count-inprogress').textContent = counts['In Progress'];
    document.getElementById('count-done').textContent = counts['Done'];
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
    const ticketData = {
        title: document.getElementById('ticketTitle').value,
        description: document.getElementById('ticketDescription').value,
        priority: document.getElementById('ticketPriority').value,
        assigneeId: document.getElementById('ticketAssignee').value ? parseInt(document.getElementById('ticketAssignee').value) : null,
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
            toast.show('Failed to save ticket', 'error');
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
    document.getElementById('ticketAssignee').value = ticket.assigneeId || '';
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
            await fetch(`/api/tickets/${id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${authToken}`
                },
                body: JSON.stringify({ status: newStatus })
            });
        } catch (error) {
            toast.show('Failed to update status', 'error');
            loadTickets(); // Revert on failure
        }
    }
    draggedTicketId = null;
}

// Team Management Functions
async function openTeamsModal() {
    document.getElementById('teamsModal').classList.add('active');
    await loadTeams();
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
}

function switchTeamTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    
    if (tab === 'myTeams') {
        document.querySelector('.tab-btn:nth-child(1)').classList.add('active');
        document.getElementById('myTeamsTab').classList.add('active');
    } else {
        document.querySelector('.tab-btn:nth-child(2)').classList.add('active');
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
            renderTeamsList();
            
            // If no team selected but teams exist, select the first one
            if (!currentTeamId && myTeams.length > 0) {
                selectTeam(myTeams[0].id);
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

    list.innerHTML = myTeams.map(team => `
        <div class="team-item ${currentTeamId == team.id ? 'active' : ''}" onclick="selectTeam(${team.id})">
            <div>
                <strong>${team.name}</strong>
                <div style="font-size: 0.8em; color: var(--text-secondary)">
                    ${team._count.members} members • ${team._count.tickets} tickets
                </div>
            </div>
            <span class="invite-code-pill">${team.inviteCode}</span>
        </div>
    `).join('');
}

async function createTeam() {
    const nameInput = document.getElementById('newTeamName');
    const name = nameInput.value.trim();
    if (!name) return toast.show('Team name is required', 'error');

    try {
        const res = await fetch('/api/teams', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${authToken}`
            },
            body: JSON.stringify({ name })
        });
        
        if (res.ok) {
            toast.show('Team created!', 'success');
            nameInput.value = '';
            await loadTeams();
            switchTeamTab('myTeams');
        } else {
            const data = await res.json();
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
        
        if (res.ok) {
            toast.show('Joined team!', 'success');
            codeInput.value = '';
            await loadTeams();
            switchTeamTab('myTeams');
        } else {
            const data = await res.json();
            toast.show(data.error || 'Invalid invite code', 'error');
        }
    } catch (error) {
        toast.show('Network error', 'error');
    }
}

async function selectTeam(teamId) {
    currentTeamId = teamId;
    localStorage.setItem('currentTeamId', teamId);
    
    // Update Active Team Info UI
    const team = myTeams.find(t => t.id == teamId);
    if (team) {
        const info = document.getElementById('activeTeamInfo');
        if (info) {
            info.innerHTML = `
                <strong>${team.name}</strong>
                <div style="font-size: 0.8em; margin-top: 5px;">Invite Code: <span class="invite-code-pill">${team.inviteCode}</span></div>
            `;
        }
        const display = document.getElementById('currentTeamDisplay');
        if (display) {
            display.textContent = team.name;
        }
    }

    renderTeamsList();
    loadTeamMembers(teamId);
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
    list.innerHTML = teamMembers.map(m => `
        <li class="member-item">
            <div class="assignee-avatar">${m.email.substring(0,2).toUpperCase()}</div>
            <div style="flex-grow: 1;">
                <div>${m.email}</div>
                <span class="member-role">${m.role}</span>
            </div>
        </li>
    `).join('');
}

function updateAssigneeDropdown() {
    const select = document.getElementById('ticketAssignee');
    if (!select) return;
    
    const currentValue = select.value;
    select.innerHTML = '<option value="">Unassigned</option>' + 
        teamMembers.map(m => `<option value="${m.id}">${m.email}</option>`).join('');
    
    select.value = currentValue;
}