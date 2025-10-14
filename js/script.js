import { Toast } from './toast.js';

let activities = [];
        let currentFilter = 'all';
        let deferredPrompt;
        let editingActivityId = null;
        const toast = new Toast();

        // Initialize app
        document.addEventListener('DOMContentLoaded', () => {
            loadActivities();
            updateDashboard();
            setMinDate();
            checkNotificationPermission();
            scheduleNotificationCheck();
            handleShortcuts();
        });

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

        // instll prompt bar
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
        function switchTab(tabName, event) {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));

            if (tabName === 'dashboard') {
                updateDashboard();
            } else if (tabName === 'activities'){
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
                const isUpcoming = datetime > new Date();
                
                return `
                    <div class="activity-item ${activity.completed ? 'completed' : ''}" onclick="viewActivity(${activity.id})">
                        <div class="activity-header">
                            <div class="activity-title">${activity.title}</div>
                            <span class="activity-badge ${badgeClass}">
                                ${activity.type.charAt(0).toUpperCase() + activity.type.slice(1)}
                            </span>
                        </div>
                        <div class="activity-meta">
                            <div class="meta-item"><i class="fa fa-user"></i> ${activity.clientName}</div>
                            <div class="meta-item"><i class="fa fa-location"></i> ${activity.location || 'No location'}</div>
                            <div class="meta-item"><i class="fa fa-calendar"></i> ${formatDate(activity.date)}</div>
                            <div class="meta-item"><i class="fa fa-alarm-clock"></i> ${activity.time}</div>
                            <div class="meta-item"><i class="fa fa-clock"></i> ${activity.duration} min</div>
                        </div>
                        ${activity.description ? `<p style="color: var(--text-secondary); font-size: 0.875rem; margin-top: 0.5rem;">${activity.description}</p>` : ''}
                        <div class="progress-bar">
                            <div class="progress-fill" style="width: ${activity.progress}%"></div>
                        </div>
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 0.75rem;">
                            <span style="font-size: 0.875rem; color: var(--text-secondary);">
                                Progress: ${activity.progress}%
                            </span>
                            ${activity.completed ? 
                                '<span style="color: var(--success); font-weight: 600;">✓ Completed</span>' : 
                                isUpcoming ? '<span style="color: var(--primary); font-weight: 600;"><i class="fa fa-hourglass"></i> Upcoming</span>' : 
                                '<span style="color: var(--warning); font-weight: 600;"><i class="fa fa-exclamation-triangle"></i> Overdue</span>'
                            }
                        </div>
                    </div>
                `;
            }).join('');
        }

        function filterActivities(filter) {
            currentFilter = filter;
            document.querySelectorAll('.filter-btn').forEach(btn => {
                btn.classList.remove('active');
                if (btn.dataset.filter === filter) {
                    btn.classList.add('active');
                }
            });
            renderActivities();
        }

        // Dashboard
        function updateDashboard() {
            const total = activities.length;
            const completed = activities.filter(a => a.completed).length;
            const now = new Date();
            const today = now.toISOString().split('T')[0];
            const todayActivities = activities.filter(a => a.date === today);
            const upcoming = activities.filter(a => {
                const actDate = new Date(a.date + ' ' + a.time);
                return actDate > now && !a.completed;
            }).length;

            document.getElementById('totalActivities').textContent = total;
            document.getElementById('completedActivities').textContent = completed;
            document.getElementById('upcomingActivities').textContent = upcoming;
            document.getElementById('todayActivities').textContent = todayActivities.length;

            renderTodayList();
            renderUpcomingList();
        }

        function renderTodayList() {
            const container = document.getElementById('todayList');
            const today = new Date().toISOString().split('T')[0];
            const todayActivities = activities.filter(a => a.date === today)
                .sort((a, b) => a.time.localeCompare(b.time));

            if (todayActivities.length === 0) {
                container.innerHTML = '<p style="color: var(--text-secondary);">No activities scheduled for today</p>';
                return;
            }

            container.innerHTML = todayActivities.map(a => `
                <div class="activity-item ${a.completed ? 'completed' : ''}" onclick="viewActivity(${a.id})">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <div class="activity-title">${a.title}</div>
                            <div style="color: var(--text-secondary); font-size: 0.875rem; margin-top: 0.25rem;">
                                ${a.time} • ${a.clientName} • ${a.duration} min
                            </div>
                        </div>
                        ${a.completed ? '<span style="color: var(--success);">✓</span>' : ''}
                    </div>
                </div>
            `).join('');
        }

        function renderUpcomingList() {
            const container = document.getElementById('upcomingList');
            const now = new Date();
            const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
            
            const upcoming = activities.filter(a => {
                const actDate = new Date(a.date + ' ' + a.time);
                return actDate > now && actDate <= weekFromNow && !a.completed;
            }).sort((a, b) => {
                const dateA = new Date(a.date + ' ' + a.time);
                const dateB = new Date(b.date + ' ' + b.time);
                return dateA - dateB;
            }).slice(0, 5);

            if (upcoming.length === 0) {
                container.innerHTML = '<p style="color: var(--text-secondary);">No upcoming activities this week</p>';
                return;
            }

            container.innerHTML = upcoming.map(a => `
                <div class="activity-item" onclick="viewActivity(${a.id})">
                    <div class="activity-title">${a.title}</div>
                    <div style="color: var(--text-secondary); font-size: 0.875rem; margin-top: 0.25rem;">
                        ${formatDate(a.date)} at ${a.time} • ${a.clientName}
                    </div>
                </div>
            `).join('');
        }

        // Progress View
        function updateProgress() {
            updateProgressStats();
            updateTypeBreakdown();
            updateRecentCompletions();
        }

        function updateProgressStats() {
            const container = document.getElementById('progressStats');
            const total = activities.length;
            const completed = activities.filter(a => a.completed).length;
            const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;
            const avgProgress = total > 0 ? Math.round(activities.reduce((sum, a) => sum + a.progress, 0) / total) : 0;

            container.innerHTML = `
                <div style="margin-bottom: 1.5rem;">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
                        <span>Overall Completion Rate</span>
                        <span style="font-weight: 600;">${completionRate}%</span>
                    </div>
                    <div class="progress-bar" style="height: 12px;">
                        <div class="progress-fill" style="width: ${completionRate}%"></div>
                    </div>
                </div>
                <div>
                    <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
                        <span>Average Progress</span>
                        <span style="font-weight: 600;">${avgProgress}%</span>
                    </div>
                    <div class="progress-bar" style="height: 12px;">
                        <div class="progress-fill" style="width: ${avgProgress}%"></div>
                    </div>
                </div>
            `;
        }

        function updateTypeBreakdown() {
            const container = document.getElementById('typeBreakdown');
            const types = {
                client: { count: 0, completed: 0, color: '#3b82f6' },
                class: { count: 0, completed: 0, color: '#ec4899' },
                study: { count: 0, completed: 0, color: '#10b981' }
            };

            activities.forEach(a => {
                if (types[a.type]) {
                    types[a.type].count++;
                    if (a.completed) types[a.type].completed++;
                }
            });

            container.innerHTML = Object.keys(types).map(type => {
                const data = types[type];
                const percentage = data.count > 0 ? Math.round((data.completed / data.count) * 100) : 0;
                return `
                    <div style="margin-bottom: 1.5rem;">
                        <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
                            <span style="text-transform: capitalize;">${type}</span>
                            <span>${data.completed}/${data.count} (${percentage}%)</span>
                        </div>
                        <div class="progress-bar">
                            <div class="progress-fill" style="width: ${percentage}%; background: ${data.color};"></div>
                        </div>
                    </div>
                `;
            }).join('');
        }

        function updateRecentCompletions() {
            const container = document.getElementById('recentCompletions');
            const recent = activities
                .filter(a => a.completed)
                .sort((a, b) => new Date(b.date) - new Date(a.date))
                .slice(0, 5);

            if (recent.length === 0) {
                container.innerHTML = '<p style="color: var(--text-secondary);">No completed activities yet</p>';
                return;
            }

            container.innerHTML = recent.map(a => `
                <div class="activity-item completed" onclick="viewActivity(${a.id})">
                    <div class="activity-title">${a.title}</div>
                    <div style="color: var(--text-secondary); font-size: 0.875rem; margin-top: 0.25rem;">
                        ${formatDate(a.date)} • ${a.clientName}
                    </div>
                </div>
            `).join('');
        }

        // Activity Details Modal
        function viewActivity(id) {
            const activity = activities.find(a => a.id === id);
            if (!activity) return;

            const modal = document.getElementById('activityModal');
            const body = document.getElementById('modalBody');

            body.innerHTML = `
                <div style="margin-bottom: 1.5rem;">
                    <span class="activity-badge badge-${activity.type}">
                        ${activity.type.charAt(0).toUpperCase() + activity.type.slice(1)}
                    </span>
                </div>
                <h3 style="margin-bottom: 1rem;">${activity.title}</h3>
                <div style="display: grid; gap: 1rem; margin-bottom: 1.5rem;">
                    <div><strong>Client/Class:</strong> ${activity.clientName}</div>
                    <div><strong>Location:</strong> ${activity.location || 'Not specified'}</div>
                    <div><strong>Date:</strong> ${formatDate(activity.date)}</div>
                    <div><strong>Time:</strong> ${activity.time}</div>
                    <div><strong>Duration:</strong> ${activity.duration} minutes</div>
                    ${activity.description ? `<div><strong>Description:</strong><br>${activity.description}</div>` : ''}
                </div>
                
                <div style="margin-bottom: 1.5rem;">
                    <label class="form-label">Progress: ${activity.progress}%</label>
                    <input type="range" min="0" max="100" value="${activity.progress}"
                        style="width: 100%;" onchange="updateActivityProgress(${activity.id}, this.value)">
                    <div class="progress-bar" style="margin-top: 0.5rem;">
                        <div class="progress-fill" id="progressFill${activity.id}" style="width: ${activity.progress}%"></div>
                    </div>
                </div>

                <div style="margin-bottom: 1.5rem;">
                    <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer;">
                        <input type="checkbox" class="checkbox-input" ${activity.completed ? 'checked' : ''}
                            onchange="toggleComplete(${activity.id}, this.checked)">
                        <span>Mark as completed</span>
                    </label>
                </div>

                <div style="display: flex; gap: 0.5rem;">
                    <button class="btn btn-primary" onclick="editActivity(${activity.id})">Edit</button>
                    <button class="btn btn-danger" onclick="deleteActivity(${activity.id})">Delete</button>
                </div>
            `;

            modal.classList.add('active');
        }

        function closeModal() {
            document.getElementById('activityModal').classList.remove('active');
            updateDashboard();
            renderActivities();
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
                closeModal(); // Close the activity details modal too
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

        // Quick Add
        function quickAddActivity() {
            switchTab('add');
        }

        // Notifications
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

        // Utility Functions
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
                // Scroll to today's activities
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
