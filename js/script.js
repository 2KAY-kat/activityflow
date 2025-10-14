import { Toast } from './toast.js';

let activities = [];
let currentFilter = 'all';
let deferredPrompt;
let editingActivityId = null;
const toast = new Toast();
let authToken = localStorage.getItem('authToken');
let isLoginMode = true;

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    initializeTheme();
    checkAuth();
    if (authToken) {
        loadActivities().then(() => {
            updateDashboard();
            renderActivities();
        });
    } else {
        showAuthModal();
    }
    setMinDate();
    checkNotificationPermission();
    scheduleNotificationCheck();
    handleShortcuts();
    registerServiceWorker();
});

// Theme Handling
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
    const themeIcon = document.querySelector('.icon-btn[title="Toggle Theme"] i');
    if (themeIcon) {
        themeIcon.className = theme === 'light' ? 'fas fa-moon' : 'fas fa-sun';
    }
}

// Auth Handling
function checkAuth() {
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.style.display = authToken ? 'flex' : 'none';
    }
}

function showAuthModal() {
    const authModal = document.getElementById('authModal');
    if (authModal) {
        authModal.classList.add('active');
        document.getElementById('authTitle').textContent = isLoginMode ? 'Login' : 'Signup';
        document.getElementById('authForm').onsubmit = handleAuth;
    }
}

function closeAuthModal() {
    const authModal = document.getElementById('authModal');
    if (authModal) {
        authModal.classList.remove('active');
    }
}

function toggleAuthMode() {
    isLoginMode = !isLoginMode;
    document.getElementById('authTitle').textContent = isLoginMode ? 'Login' : 'Signup';
}

async function handleAuth(e) {
    e.preventDefault();
    const email = document.getElementById('email')?.value;
    const password = document.getElementById('password')?.value;
    if (!email || !password) {
        toast.show('Please enter email and password', 'error');
        return;
    }
    const endpoint = isLoginMode ? '/api/auth/login' : '/api/auth/register';

    try {
        console.log(`Sending request to ${endpoint} with email: ${email}`);
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        console.log(`Response status: ${res.status}`);
        const text = await res.text(); // Get raw response for debugging
        console.log('Raw response:', text);
        try {
            const data = JSON.parse(text);
            if (res.ok) {
                if (isLoginMode) {
                    authToken = data.token;
                    localStorage.setItem('authToken', authToken);
                    toast.show('Logged in successfully!', 'success');
                    closeAuthModal();
                    loadActivities().then(() => {
                        updateDashboard();
                        renderActivities();
                    });
                    checkAuth();
                } else {
                    toast.show('Signed up successfully! Please login.', 'success');
                    toggleAuthMode();
                    document.getElementById('authForm').reset();
                }
            } else {
                toast.show(data.error || `Authentication failed: ${res.statusText}`, 'error');
            }
        } catch (jsonError) {
            console.error('JSON parse error:', jsonError, 'Raw response:', text);
            toast.show(`Server error: Unexpected response (${res.status})`, 'error');
        }
    } catch (error) {
        console.error('Auth error:', error);
        toast.show('Network error - please check your connection or server status', 'error');
    }
}

function logout() {
    authToken = null;
    localStorage.removeItem('authToken');
    activities = [];
    toast.show('Logged out', 'success');
    checkAuth();
    showAuthModal();
    switchTab('dashboard');
}

// Service Worker
function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js')
            .then(reg => console.log('Service Worker registered:', reg))
            .catch(err => console.error('Service Worker registration failed:', err));
    }
}

// Install Prompt
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    document.getElementById('installPrompt').classList.add('show');
});

function installApp() {
    if (deferredPrompt) {
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then((choiceResult) => {
            if (choiceResult.outcome === 'accepted') {
                document.getElementById('installPrompt').classList.remove('show');
            }
            deferredPrompt = null;
        });
    }
}

// Data Management
async function loadActivities() {
    try {
        const res = await fetch('/api/activities', {
            headers: { Authorization: `Bearer ${authToken}` }
        });
        console.log('Load activities response:', res.status);
        if (res.ok) {
            const data = await res.json();
            activities = data.map(a => ({ ...a, id: a._id }));
        } else if (res.status === 401) {
            toast.show('Session expired - please login again', 'error');
            logout();
        } else {
            toast.show(`Failed to load activities: ${res.statusText}`, 'error');
        }
    } catch (error) {
        console.error('Load activities error:', error);
        toast.show('Network error - using local data if available', 'error');
        const stored = localStorage.getItem('activities');
        activities = stored ? JSON.parse(stored) : [];
    }
}

async function saveActivity(activity, isUpdate = false) {
    try {
        const payload = { ...activity };
        delete payload.id;
        const method = isUpdate ? 'PUT' : 'POST';
        const url = isUpdate ? `/api/activities/${activity.id}` : '/api/activities';
        const res = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${authToken}`
            },
            body: JSON.stringify(payload)
        });
        console.log(`Save activity response: ${res.status}`);
        if (res.ok) {
            const saved = await res.json();
            saved.id = saved._id;
            scheduleNotification(saved);
            return saved;
        } else if (res.status === 401) {
            toast.show('Session expired - please login again', 'error');
            logout();
        } else {
            toast.show(`Failed to save activity: ${res.statusText}`, 'error');
        }
    } catch (error) {
        console.error('Save activity error:', error);
        toast.show('Network error - saving locally', 'error');
        if (!isUpdate) {
            activity.id = Date.now().toString();
            activities.push(activity);
        } else {
            const index = activities.findIndex(a => a.id === activity.id);
            if (index !== -1) activities[index] = activity;
        }
        localStorage.setItem('activities', JSON.stringify(activities));
        scheduleNotification(activity);
        return activity;
    }
}

async function deleteActivityFromServer(id) {
    try {
        const res = await fetch(`/api/activities/${id}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${authToken}` }
        });
        console.log(`Delete activity response: ${res.status}`);
        if (res.ok) {
            return true;
        } else if (res.status === 401) {
            toast.show('Session expired - please login again', 'error');
            logout();
        } else {
            toast.show(`Failed to delete: ${res.statusText}`, 'error');
        }
    } catch (error) {
        console.error('Delete activity error:', error);
        toast.show('Network error - removing locally', 'error');
        activities = activities.filter(a => a.id !== id);
        localStorage.setItem('activities', JSON.stringify(activities));
        return true;
    }
}

function showSyncStatus() {
    const status = document.getElementById('syncStatus');
    if (status) {
        status.style.display = 'inline-flex';
        setTimeout(() => status.style.display = 'none', 2000);
    }
}

function syncData() {
    if (!authToken) {
        toast.show('Please login to sync data', 'error');
        showAuthModal();
        return;
    }
    loadActivities().then(() => {
        updateDashboard();
        renderActivities();
        showSyncStatus();
    });
}

// Form Handling
document.getElementById('activityForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!authToken) {
        toast.show('Please login to add activities', 'error');
        showAuthModal();
        return;
    }

    const activity = {
        type: document.getElementById('activityType').value,
        title: document.getElementById('activityTitle').value,
        clientName: document.getElementById('clientName').value,
        location: document.getElementById('location').value,
        date: document.getElementById('activityDate').value,
        time: document.getElementById('activityTime').value,
        duration: parseInt(document.getElementById('duration').value),
        description: document.getElementById('description').value,
        reminderTime: parseInt(document.getElementById('reminderTime').value),
        completed: false,
        progress: 0
    };

    if (editingActivityId) {
        activity.id = editingActivityId;
    }

    const saved = await saveActivity(activity, !!editingActivityId);
    if (saved) {
        e.target.reset();
        toast.show(editingActivityId ? 'Activity updated!' : 'Activity created!', 'success');
        editingActivityId = null;
        document.getElementById('submitBtn').textContent = 'Create Activity';
        switchTab('activities');
        loadActivities().then(renderActivities);
    }
});

// Tab Navigation
function switchTab(tabName) {
    if (!authToken) {
        toast.show('Please login to access this feature', 'error');
        showAuthModal();
        return;
    }

    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));

    if (tabName === 'dashboard') {
        updateDashboard();
    } else if (tabName === 'activities') {
        renderActivities();
    } else if (tabName === 'progress') {
        updateProgress();
    }

    const viewElement = document.getElementById(tabName);
    if (viewElement) {
        viewElement.classList.add('active');
    }

    const tabElement = document.querySelector(`.tab[data-tab="${tabName}"]`);
    if (tabElement) {
        tabElement.classList.add('active');
    }

    if (tabName === 'add') {
        document.getElementById('activityTitle').focus();
    }
}

// Render Activities
function renderActivities() {
    const container = document.getElementById('activitiesList');
    if (!container) return;

    let filtered = activities;

    if (currentFilter !== 'all') {
        if (currentFilter === 'pending') {
            filtered = activities.filter(a => !a.completed);
        } else if (currentFilter === 'completed') {
            filtered = activities.filter(a => a.completed);
        } else {
            filtered = activities.filter(a => a.type === currentFilter);
        }
    }

    if (filtered.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📋</div>
                <p>No activities found</p>
            </div>
        `;
        return;
    }

    filtered.sort((a, b) => {
        const dateA = new Date(a.date + ' ' + a.time);
        const dateB = new Date(b.date + ' ' + b.time);
        return dateA - dateB;
    });

    container.innerHTML = filtered.map(activity => {
        const badgeClass = `badge-${activity.type}`;
        const datetime = new Date(activity.date + ' ' + activity.time);
        return `
            <div class="activity-item ${activity.completed ? 'completed' : ''}" onclick="viewActivity('${activity.id}')">
                <div class="activity-header">
                    <div class="activity-title">${activity.title}</div>
                    <span class="activity-badge ${badgeClass}">${activity.type.charAt(0).toUpperCase() + activity.type.slice(1)}</span>
                </div>
                <div class="activity-meta">
                    <span><i class="fa fa-user"></i>${activity.clientName}</span>
                    <span><i class="fa fa-calendar"></i>${formatDate(activity.date)}</span>
                    <span><i class="fa fa-clock"></i>${activity.time}</span>
                    ${activity.location ? `<span><i class="fa fa-map-marker"></i>${activity.location}</span>` : ''}
                </div>
                <div class="progress-bar">
                    <div class="progress-fill" id="progressFill${activity.id}" style="width: ${activity.progress}%"></div>
                </div>
                <div class="activity-actions">
                    <button class="action-btn btn-success" onclick="toggleComplete('${activity.id}', ${!activity.completed}); event.stopPropagation();">
                        ${activity.completed ? 'Undo' : 'Complete'}
                    </button>
                    <button class="action-btn" onclick="editActivity('${activity.id}'); event.stopPropagation();">Edit</button>
                    <button class="action-btn btn-danger" onclick="deleteActivity('${activity.id}'); event.stopPropagation();">Delete</button>
                </div>
            </div>
        `;
    }).join('');
}

// Dashboard Updates
function updateDashboard() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const endOfWeek = new Date(today);
    endOfWeek.setDate(today.getDate() + 7);

    const totalActivities = activities.length;
    const completedActivities = activities.filter(a => a.completed).length;
    const todayActivities = activities.filter(a => {
        const activityDate = new Date(a.date);
        return activityDate.toDateString() === today.toDateString() && !a.completed;
    });
    const upcomingActivities = activities.filter(a => {
        const activityDate = new Date(a.date);
        return activityDate > today && activityDate <= endOfWeek && !a.completed;
    });

    const totalEl = document.getElementById('totalActivities');
    const completedEl = document.getElementById('completedActivities');
    const upcomingEl = document.getElementById('upcomingActivities');
    const todayEl = document.getElementById('todayActivities');
    if (totalEl) totalEl.textContent = totalActivities;
    if (completedEl) completedEl.textContent = completedActivities;
    if (upcomingEl) upcomingEl.textContent = upcomingActivities.length;
    if (todayEl) todayEl.textContent = todayActivities.length;

    const todayList = document.getElementById('todayList');
    if (todayList) {
        todayList.innerHTML = todayActivities.length ? todayActivities.map(activity => `
            <div class="activity-item ${activity.completed ? 'completed' : ''}" onclick="viewActivity('${activity.id}')">
                <div class="activity-header">
                    <div class="activity-title">${activity.title}</div>
                    <span class="activity-badge badge-${activity.type}">${activity.type.charAt(0).toUpperCase() + activity.type.slice(1)}</span>
                </div>
                <div class="activity-meta">
                    <span><i class="fa fa-clock"></i>${activity.time}</span>
                    ${activity.location ? `<span><i class="fa fa-map-marker"></i>${activity.location}</span>` : ''}
                </div>
            </div>
        `).join('') : `
            <div class="empty-state">
                <div class="empty-state-icon">📅</div>
                <p>No activities for today</p>
            </div>
        `;
    }

    const upcomingList = document.getElementById('upcomingList');
    if (upcomingList) {
        upcomingList.innerHTML = upcomingActivities.length ? upcomingActivities.map(activity => `
            <div class="activity-item ${activity.completed ? 'completed' : ''}" onclick="viewActivity('${activity.id}')">
                <div class="activity-header">
                    <div class="activity-title">${activity.title}</div>
                    <span class="activity-badge badge-${activity.type}">${activity.type.charAt(0).toUpperCase() + activity.type.slice(1)}</span>
                </div>
                <div class="activity-meta">
                    <span><i class="fa fa-calendar"></i>${formatDate(activity.date)}</span>
                    <span><i class="fa fa-clock"></i>${activity.time}</span>
                    ${activity.location ? `<span><i class="fa fa-map-marker"></i>${activity.location}</span>` : ''}
                </div>
            </div>
        `).join('') : `
            <div class="empty-state">
                <div class="empty-state-icon">📅</div>
                <p>No upcoming activities this week</p>
            </div>
        `;
    }
}

// Progress Updates
function updateProgress() {
    const total = activities.length;
    const completed = activities.filter(a => a.completed).length;
    const completionRate = total ? Math.round((completed / total) * 100) : 0;

    const progressStats = document.getElementById('progressStats');
    if (progressStats) {
        progressStats.innerHTML = `
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-value">${completionRate}%</div>
                    <div class="stat-label">Completion Rate</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${completed}</div>
                    <div class="stat-label">Completed</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${total - completed}</div>
                    <div class="stat-label">Pending</div>
                </div>
            </div>
        `;
    }

    const types = ['client', 'class', 'study'];
    const typeCounts = types.map(type => ({
        type,
        count: activities.filter(a => a.type === type).length
    }));

    const typeBreakdown = document.getElementById('typeBreakdown');
    if (typeBreakdown) {
        typeBreakdown.innerHTML = `
            <div class="stats-grid">
                ${typeCounts.map(t => `
                    <div class="stat-card">
                        <div class="stat-value">${t.count}</div>
                        <div class="stat-label">${t.type.charAt(0).toUpperCase() + t.type.slice(1)} Activities</div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    const recentCompletions = activities.filter(a => a.completed).sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);
    const recentCompletionsEl = document.getElementById('recentCompletions');
    if (recentCompletionsEl) {
        recentCompletionsEl.innerHTML = recentCompletions.length ? recentCompletions.map(activity => `
            <div class="activity-item completed" onclick="viewActivity('${activity.id}')">
                <div class="activity-header">
                    <div class="activity-title">${activity.title}</div>
                    <span class="activity-badge badge-${activity.type}">${activity.type.charAt(0).toUpperCase() + activity.type.slice(1)}</span>
                </div>
                <div class="activity-meta">
                    <span><i class="fa fa-calendar"></i>${formatDate(activity.date)}</span>
                    <span><i class="fa fa-clock"></i>${activity.time}</span>
                </div>
            </div>
        `).join('') : `
            <div class="empty-state">
                <div class="empty-state-icon">✅</div>
                <p>No recent completions</p>
            </div>
        `;
    }
}

function viewActivity(id) {
    const activity = activities.find(a => a.id === id);
    if (!activity) return;

    const modalBody = document.getElementById('modalBody');
    if (modalBody) {
        modalBody.innerHTML = `
            <div style="margin-bottom: 1rem;">
                <h3 style="font-size: 1.25rem; font-weight: 600; margin-bottom: 0.5rem;">${activity.title}</h3>
                <span class="activity-badge badge-${activity.type}">${activity.type.charAt(0).toUpperCase() + activity.type.slice(1)}</span>
            </div>
            <div style="display: grid; gap: 0.5rem; color: var(--text-secondary);">
                <div><strong>Client/Class:</strong> ${activity.clientName}</div>
                ${activity.location ? `<div><strong>Location:</strong> ${activity.location}</div>` : ''}
                <div><strong>Date:</strong> ${formatDate(activity.date)}</div>
                <div><strong>Time:</strong> ${activity.time}</div>
                <div><strong>Duration:</strong> ${activity.duration} minutes</div>
                ${activity.description ? `<div><strong>Description:</strong> ${activity.description}</div>` : ''}
                <div><strong>Status:</strong> ${activity.completed ? 'Completed' : 'Pending'}</div>
                <div><strong>Progress:</strong> ${activity.progress}%</div>
            </div>
            <div class="activity-actions" style="margin-top: 1.5rem;">
                <label style="display: flex; align-items: center; gap: 0.5rem;">
                    <input type="checkbox" class="checkbox-input" ${activity.completed ? 'checked' : ''} onchange="toggleComplete('${activity.id}', this.checked)">
                    Mark as ${activity.completed ? 'Incomplete' : 'Complete'}
                </label>
                <button class="action-btn" onclick="editActivity('${activity.id}')">Edit</button>
                <button class="action-btn btn-danger" onclick="deleteActivity('${activity.id}')">Delete</button>
            </div>
            <div style="margin-top: 1rem;">
                <label>Progress: <input type="range" min="0" max="100" value="${activity.progress}" oninput="updateActivityProgress('${activity.id}', this.value)"></label>
            </div>
        `;
        document.getElementById('activityModal').classList.add('active');
    }
}

function filterActivities(filter) {
    currentFilter = filter;
    document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelector(`.filter-btn[data-filter="${filter}"]`).classList.add('active');
    renderActivities();
}

function closeModal() {
    const activityModal = document.getElementById('activityModal');
    if (activityModal) {
        activityModal.classList.remove('active');
    }
}

async function toggleComplete(id, completed) {
    const activity = activities.find(a => a.id === id);
    if (activity) {
        activity.completed = completed;
        if (completed) activity.progress = 100;
        const saved = await saveActivity(activity, true);
        if (saved) {
            viewActivity(id);
            loadActivities().then(() => {
                updateDashboard();
                renderActivities();
            });
        }
    }
}

let activityToDelete = null;

function showDeleteModal(id) {
    activityToDelete = id;
    const deleteModal = document.getElementById('deleteModal');
    if (deleteModal) {
        deleteModal.classList.add('active');
    }
}

function closeDeleteModal() {
    const deleteModal = document.getElementById('deleteModal');
    if (deleteModal) {
        deleteModal.classList.remove('active');
    }
    activityToDelete = null;
}

async function confirmDelete() {
    if (activityToDelete) {
        const success = await deleteActivityFromServer(activityToDelete);
        if (success) {
            closeDeleteModal();
            closeModal();
            toast.show('Activity deleted!', 'success');
            loadActivities().then(() => {
                updateDashboard();
                renderActivities();
            });
        }
    }
}

function deleteActivity(id) {
    showDeleteModal(id);
}

function editActivity(id) {
    const activity = activities.find(a => a.id === id);
    if (!activity) return;

    editingActivityId = id;

    document.getElementById('activityType').value = activity.type;
    document.getElementById('activityTitle').value = activity.title;
    document.getElementById('clientName').value = activity.clientName;
    document.getElementById('location').value = activity.location;
    document.getElementById('activityDate').value = activity.date;
    document.getElementById('activityTime').value = activity.time;
    document.getElementById('duration').value = activity.duration;
    document.getElementById('description').value = activity.description;
    document.getElementById('reminderTime').value = activity.reminderTime;

    document.getElementById('submitBtn').textContent = 'Update Activity';
    switchTab('add');
    closeModal();
}

function quickAddActivity() {
    if (!authToken) {
        toast.show('Please login to add activities', 'error');
        showAuthModal();
        return;
    }
    switchTab('add');
}

function checkNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'granted') {
        updateNotificationBadge();
    }
}

function requestNotificationPermission() {
    if (!('Notification' in window)) {
        toast.show('This browser does not support notifications', 'error');
        return;
    }

    Notification.requestPermission().then(permission => {
        if (permission === 'granted') {
            toast.show('Notifications enabled!', 'success');
            scheduleAllNotifications();
        }
    });
}

function scheduleNotification(activity) {
    if (Notification.permission !== 'granted') return;

    const activityTime = new Date(activity.date + ' ' + activity.time);
    const notifyTime = new Date(activityTime.getTime() - activity.reminderTime * 60000);
    const now = new Date();

    if (notifyTime > now) {
        const delay = notifyTime.getTime() - now.getTime();
        setTimeout(() => {
            new Notification('Upcoming Activity', {
                body: `${activity.title} with ${activity.clientName} in ${activity.reminderTime} minutes`,
                icon: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"%3E%3Crect fill="%236366f1" width="100" height="100" rx="15"/%3E%3C/svg%3E',
                tag: activity.id.toString(),
                requireInteraction: true
            });
        }, delay);
    }
}

function scheduleAllNotifications() {
    activities.filter(a => !a.completed).forEach(scheduleNotification);
}

function scheduleNotificationCheck() {
    setInterval(() => {
        updateNotificationBadge();
    }, 60000);
}

function updateNotificationBadge() {
    const now = new Date();
    const upcoming = activities.filter(a => {
        if (a.completed) return false;
        const actTime = new Date(a.date + ' ' + a.time);
        const diff = actTime - now;
        return diff > 0 && diff < 3600000;
    }).length;

    const badge = document.getElementById('notifBadge');
    if (badge) {
        if (upcoming > 0) {
            badge.textContent = upcoming;
            badge.style.display = 'flex';
        } else {
            badge.style.display = 'none';
        }
    }
}

function formatDate(dateStr) {
    const date = new Date(dateStr);
    const options = { month: 'short', day: 'numeric', year: 'numeric' };
    return date.toLocaleDateString('en-US', options);
}

function setMinDate() {
    const today = new Date().toISOString().split('T')[0];
    const dateInput = document.getElementById('activityDate');
    if (dateInput) {
        dateInput.setAttribute('min', today);
    }
}

function updateActivityProgress(id, value) {
    const progressFill = document.getElementById(`progressFill${id}`);
    if (progressFill) {
        progressFill.style.width = value + '%';
    }
    const activity = activities.find(a => a.id === id);
    if (activity) {
        activity.progress = parseInt(value);
        saveActivity(activity, true);
    }
}

function handleShortcuts() {
    const urlParams = new URLSearchParams(window.location.search);
    const action = urlParams.get('action');

    if (action === 'add') {
        quickAddActivity();
    } else if (action === 'dashboard') {
        switchTab('dashboard');
    } else if (action === 'today') {
        switchTab('dashboard');
        setTimeout(() => {
            const todaySection = document.getElementById('todayList');
            if (todaySection) {
                todaySection.scrollIntoView({ behavior: 'smooth' });
            }
        }, 300);
    }
}

document.getElementById('activityModal').addEventListener('click', (e) => {
    if (e.target.id === 'activityModal') closeModal();
});

// Global functions
window.requestNotificationPermission = requestNotificationPermission;
window.syncData = syncData;
window.switchTab = switchTab;
window.filterActivities = filterActivities;
window.viewActivity = viewActivity;
window.closeModal = closeModal;
window.closeDeleteModal = closeDeleteModal;
window.confirmDelete = confirmDelete;
window.quickAddActivity = quickAddActivity;
window.editActivity = editActivity;
window.deleteActivity = deleteActivity;
window.toggleComplete = toggleComplete;
window.updateActivityProgress = updateActivityProgress;
window.toggleTheme = toggleTheme;
window.logout = logout;
window.closeAuthModal = closeAuthModal;
window.toggleAuthMode = toggleAuthMode;
window.installApp = installApp;