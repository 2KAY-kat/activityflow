import { Toast } from './toast.js';

let tickets = [];
let editingTicketId = null;
let ticketToDelete = null;
let draggedTicketId = null;
const toast = new Toast();
let authToken = localStorage.getItem('authToken');
let isLoginMode = true;

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

    document.getElementById('authForm').addEventListener('submit', handleAuth);
    document.getElementById('ticketForm').addEventListener('submit', saveTicket);

    if (authToken) {
        loadTickets();
    }
});

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
    const logoutBtn = document.getElementById('logoutBtn');
    
    if (authToken) {
        authModal.classList.remove('active');
        logoutBtn.style.display = 'flex';
    } else {
        authModal.classList.add('active');
        logoutBtn.style.display = 'none';
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
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const endpoint = isLoginMode ? '/api/auth/login' : '/api/auth/register';

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
                loadTickets();
            } else {
                toast.show('Account created. Please login.', 'success');
                toggleAuthMode();
            }
        } else {
            toast.show(data.error || 'Authentication failed', 'error');
        }
    } catch (error) {
        toast.show('Network error', 'error');
    }
}

function logout() {
    authToken = null;
    localStorage.removeItem('authToken');
    toast.show('Logged out', 'success');
    checkAuth();
}

async function loadTickets() {
    try {
        const res = await fetch('/api/tickets', {
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
        card.ondragstart = (e) => dragStart(e, ticket._id);
        
        const priorityLower = ticket.priority.toLowerCase();
        const initials = ticket.assignee ? ticket.assignee.substring(0,2).toUpperCase() : '??';

        card.innerHTML = `
            <div class="ticket-header">
                <div class="ticket-title">${ticket.title}</div>
                <div class="ticket-actions">
                    <button class="icon-btn edit" onclick="editTicket('${ticket._id}')" title="Edit"><i class="fa-solid fa-pen"></i></button>
                    <button class="icon-btn delete" onclick="promptDeleteTicket('${ticket._id}')" title="Delete"><i class="fa-solid fa-trash"></i></button>
                </div>
            </div>
            ${ticket.description ? `<div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 4px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">${ticket.description}</div>` : ''}
            <div class="ticket-footer">
                <span class="badge priority-${priorityLower}">${ticket.priority}</span>
                <div class="assignee-avatar" title="${ticket.assignee || 'Unassigned'}">${initials}</div>
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

    const ticketData = {
        title: document.getElementById('ticketTitle').value,
        description: document.getElementById('ticketDescription').value,
        priority: document.getElementById('ticketPriority').value,
        assignee: document.getElementById('ticketAssignee').value,
        status: document.getElementById('ticketStatus').value
    };

    const isUpdate = !!editingTicketId;
    const url = isUpdate ? `/api/tickets/${editingTicketId}` : '/api/tickets';
    const method = isUpdate ? 'PUT' : 'POST';

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
    }
}

function editTicket(id) {
    const ticket = tickets.find(t => t._id === id);
    if (!ticket) return;

    editingTicketId = id;
    document.getElementById('modalTitle').textContent = 'Edit Ticket';
    document.getElementById('ticketTitle').value = ticket.title;
    document.getElementById('ticketDescription').value = ticket.description || '';
    document.getElementById('ticketPriority').value = ticket.priority;
    document.getElementById('ticketAssignee').value = ticket.assignee || '';
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
    const ticket = tickets.find(t => t._id === id);

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