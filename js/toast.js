export class Toast {
    constructor() {
        this.container = document.getElementById('toast-container');
        this.duration = 4000;
    }

    show(message, type) {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        
        const timestamp = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        
        const iconClass = type === 'success' ? 'fa-solid fa-circle-check' : 'fa-solid fa-circle-exclamation';

        toast.innerHTML = `
            <div class="toast-icon">
                <i class="${iconClass}"></i>
            </div>
            <div class="toast-content">
                <div class="toast-title">${message}</div>
                <div class="toast-time">${timestamp}</div>
            </div>
        `;
        
        this.container.appendChild(toast);
        
        // requestAnimationFrame for smoother entry
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                toast.classList.add('show');
            });
        });
        
        setTimeout(() => {
            this.hide(toast);
        }, this.duration);
    }
    
    hide(toast) {
        toast.classList.remove('show');
        toast.classList.add('hide');
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 400); // Wait for transition
    }
}