export class Toast {
    constructor() {
        this.container = document.getElementById('toast-container');
        this.duration = 5000; 
    }

    show(message, type) {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        
        // we set the displayed icon according to toast type and the time of sending well formatted
        const icon = this.getIcon(type);
        const timestamp = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        
        // toast html markup layout 
        toast.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: space-between; position: relative;">
                <div style="display: flex; align-items: center; flex: 1;">
                    ${icon ? `<span class="toast-icon">${icon}</span>` : ''}
                    <span class="message">${message}</span>
                </div>
            </div>
            <div style="font-size: 12px; opacity: 0.8; margin-top: 4px;">
                ${timestamp}
            </div>
        `;
        
        this.container.appendChild(toast);
        
        // toast animation timing thing
        setTimeout(() => toast.classList.add('show'), 10);
        
        const autoRemove = setTimeout(() => {
            this.hide(toast);
            clearTimeout(autoRemove);
        }, this.duration);
    }
    
    hide(toast) {
        toast.classList.add('hide');
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 300);
    }
    
    // the corresponidng icons on the toast messages for either success, failure ....
    getIcon(type) {
        const icons = {
            success: '✓',
            error: '✕'
        };
        return icons[type];
    }
}