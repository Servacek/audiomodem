class MessageNotifications {
    constructor() {
        this.notifications = [];
        this.requestPermission();
    }

    async requestPermission() {
        if ('Notification' in window && Notification.permission === 'default') {
            await Notification.requestPermission();
        }
    }

    notifyIncomingMessage(sender, message, avatar = null) {
        if (Notification.permission !== 'granted') return;

        const notification = new Notification(`New message from ${sender}`, {
            body: message,
            icon: avatar,
            tag: 'incoming-message',
            requireInteraction: false,
        });

        notification.onclick = () => {
            window.focus();
            notification.close();
        };

        this.notifications.push(notification);
    }

    closeAllNotifications() {
        this.notifications.forEach(n => n.close());
        this.notifications = [];
    }
}

export default new MessageNotifications();