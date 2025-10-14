import { Toast } from './toast.js';

let activities = [];
let currentFilter = 'all';
let deferredPrompt;
let editingActivityId = null;
const toast = new Toast();

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    initializeTheme();
    loadActivities();
    updateDashboard();
    setMinDate();
    checkNotificationPermission();
    scheduleNotificationCheck();
    handleShortcuts();
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

// Service Worker Registration
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
        .then(reg => console.log('Service Worker registered'))
        .catch(err => console.log('Service Worker registration failed'));
}

// Install prompt
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

// Install prompt bar
window.installApp = installApp;

// Data Management
function loadActivities() {
    const stored = localStorage.getItem('activities');
    activities = stored ? JSON.parse(stored) : [];
}

function saveActivities() {
    localStorage.setItem('activities', JSON.stringify(activities));
    showSyncStatus();
}

function showSyncStatus() {
    const status = document.getElementById('syncStatus');
    status.style.display = 'inline-flex';
    setTimeout(() => status.style.display = 'none', 2000);
}

function syncData() {
    saveActivities();
    updateDashboard();
    renderActivities();
    showSyncStatus();
}

// Tab Navigation
function switchTab(tabName) {
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

// Form Handling
document.getElementById('activityForm').addEventListener('submit', (e) => {
    e.preventDefault();

    if (editingActivityId) {
        // Update existing activity
        const activity = activities.find(a => a.id === editingActivityId);
        if (activity) {
            activity.type = document.getElementById('activityType').value;
            activity.title = document.getElementById('activityTitle').value;
            activity.clientName = document.getElementById('clientName').value;
            activity.location = document.getElementById('location').value;
            activity.date = document.getElementById('activityDate').value;
            activity.time = document.getElementById('activityTime').value;
            activity.duration = parseInt(document.getElementById('duration').value);
            activity.description = document.getElementById('description').value;
            activity.reminderTime = parseInt(document.getElementById('reminderTime').value);

            saveActivities();
            scheduleNotification(activity);

            e.target.reset();
            toast.show('Activity updated successfully!', 'success');
            editingActivityId = null;
            document.getElementById('submitBtn').textContent = 'Add Activity';
            switchTab('activities');
            renderActivities();
        }
    } else {
        // Create new activity
        const activity = {
            id: Date.now(),
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
            progress: 0,
            createdAt: new Date().toISOString()
        };

        activities.push(activity);
        saveActivities();
        scheduleNotification(activity);

        e.target.reset();
        toast.show('Activity created successfully!', 'success');
        switchTab('activities');
        renderActivities();
    }
});

function setMinDate() {
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('activityDate').min = today;
}

// Render Activities
function renderActivities() {
    const container = document.getElementById('activitiesList');
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
            <div class="activity-item ${activity.completed ? 'completed' : ''}" onclick="viewActivity(${activity.id})">
                <div class="activity-header">
                    <div class="activity-title">${activity.title}</div>
                    <span class="activity-badge ${badgeClass}">${activity.type.charAt(0).toUpperCase() + activity.type.slice(1)}</span>
                </div>
                <div class="activity-meta">
                    <span><i class="fa fa-user"></i> ${activity.clientName}</span>
                    <span><i class="fa fa-calendar"></i> ${formatDate(activity.date)}</span>
                    <span><i class="fa fa-clock"></i> ${activity.time}</span>
                    ${activity.location ? `<span><i class="fa fa-map-marker"></i> ${activity.location}</span>` : ''}
                </div>
                <div class="progress-bar">
                    <div class="progress-fill" id="progressFill${activity.id}" style="width: ${activity.progress}%"></div>
                </div>
                <div class="activity-actions">
                    <button class="action-btn btn-success" onclick="toggleComplete(${activity.id}, ${!activity.completed})">
                        ${activity.completed ? 'Undo' : 'Complete'}
                    </button>
                    <button class="action-btn" onclick="editActivity(${activity.id})">Edit</button>
                    <button class="action-btn btn-danger" onclick="deleteActivity(${activity.id})">Delete</button>
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

    document.getElementById('totalActivities').textContent = totalActivities;
    document.getElementById('completedActivities').textContent = completedActivities;
    document.getElementById('upcomingActivities').textContent = upcomingActivities.length;
    document.getElementById('todayActivities').textContent = todayActivities.length;

    document.getElementById('todayList').innerHTML = todayActivities.length ? todayActivities.map(activity => `
        <div class="activity-item ${activity.completed ? 'completed' : ''}" onclick="viewActivity(${activity.id})">
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

    document.getElementById('upcomingList').innerHTML = upcomingActivities.length ? upcomingActivities.map(activity => `
        <div class="activity-item ${activity.completed ? 'completed' : ''}" onclick="viewActivity(${activity.id})">
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

// Progress Updates
function updateProgress() {
    const total = activities.length;
    const completed = activities.filter(a => a.completed).length;
    const completionRate = total ? Math.round((completed / total) * 100) : 0;

    document.getElementById('progressStats').innerHTML = `
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

    const types = ['client', 'class', 'study'];
    const typeCounts = types.map(type => ({
        type,
        count: activities.filter(a => a.type === type).length
    }));

    document.getElementById('typeBreakdown').innerHTML = `
        <div class="stats-grid">
            ${typeCounts.map(t => `
                <div class="stat-card">
                    <div class="stat-value">${t.count}</div>
                    <div class="stat-label">${t.type.charAt(0).toUpperCase() + t.type.slice(1)} Activities</div>
                </div>
            `).join('')}
        </div>
    `;

    const recentCompletions = activities.filter(a => a.completed).sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);
    document.getElementById('recentCompletions').innerHTML = recentCompletions.length ? recentCompletions.map(activity => `
        <div class="activity-item completed" onclick="viewActivity(${activity.id})">
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

function viewActivity(id) {
    const activity = activities.find(a => a.id === id);
    if (!activity) return;

    document.getElementById('modalBody').innerHTML = `
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
                <input type="checkbox" class="checkbox-input" ${activity.completed ? 'checked' : ''} onchange="toggleComplete(${activity.id}, this.checked)">
                Mark as ${activity.completed ? 'Incomplete' : 'Complete'}
            </label>
            <button class="action-btn" onclick="editActivity(${activity.id})">Edit</button>
            <button class="action-btn btn-danger" onclick="deleteActivity(${activity.id})">Delete</button>
        </div>
        <div style="margin-top: 1rem;">
            <label>Progress: <input type="range" min="0" max="100" value="${activity.progress}" oninput="updateActivityProgress(${activity.id}, this.value)"></label>
        </div>
    `;
    document.getElementById('activityModal').classList.add('active');
}

function filterActivities(filter) {
    currentFilter = filter;
    document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelector(`.filter-btn[data-filter="${filter}"]`).classList.add('active');
    renderActivities();
}

function closeModal() {
    document.getElementById('activityModal').classList.remove('active');
}

function toggleComplete(id, completed) {
    const activity = activities.find(a => a.id === id);
    if (activity) {
        activity.completed = completed;
        if (completed) activity.progress = 100;
        saveActivities();
        viewActivity(id); // Refresh modal content instead of closing
        updateDashboard();
        renderActivities();
    }
}

let activityToDelete = null;

function showDeleteModal(id) {
    activityToDelete = id;
    document.getElementById('deleteModal').classList.add('active');
}

function closeDeleteModal() {
    document.getElementById('deleteModal').classList.remove('active');
    activityToDelete = null;
}

function confirmDelete() {
    if (activityToDelete) {
        activities = activities.filter(a => a.id !== activityToDelete);
        saveActivities();
        closeDeleteModal();
        closeModal();
        updateDashboard();
        renderActivities();
        toast.show('Activity deleted successfully!', 'success');
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
    }, 60000); // Check every minute
}

function updateNotificationBadge() {
    const now = new Date();
    const upcoming = activities.filter(a => {
        if (a.completed) return false;
        const actTime = new Date(a.date + ' ' + a.time);
        const diff = actTime - now;
        return diff > 0 && diff < 3600000; // Within 1 hour
    }).length;

    const badge = document.getElementById('notifBadge');
    if (upcoming > 0) {
        badge.textContent = upcoming;
        badge.style.display = 'flex';
    } else {
        badge.style.display = 'none';
    }
}

function formatDate(dateStr) {
    const date = new Date(dateStr);
    const options = { month: 'short', day: 'numeric', year: 'numeric' };
    return date.toLocaleDateString('en-US', options);
}

// Close modal when clicking outside
document.getElementById('activityModal').addEventListener('click', (e) => {
    if (e.target.id === 'activityModal') closeModal();
});

// Handle app shortcuts
function handleShortcuts() {
    const urlParams = new URLSearchParams(window.location.search);
    const action = urlParams.get('action');

    if (action === 'add') {
        switchTab('add');
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

// Activity Progress Update
function updateActivityProgress(id, value) {
    const progressFill = document.getElementById(`progressFill${id}`);
    if (progressFill) {
        progressFill.style.width = value + '%';
    }
    const activity = activities.find(a => a.id === id);
    if (activity) {
        activity.progress = parseInt(value);
        saveActivities();
    }
}

// Make functions globally available for onclick attributes
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