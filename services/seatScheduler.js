const cron = require('node-cron');
const Seat = require('../models/Seat');
const sendNotificationToAllUsers = require('./notifications');

// Обновление всех мест перед началом урока (например, каждый час или по расписанию)
cron.schedule('30 10 * * *', async () => { // Это сработает в 10:30 каждый день
    try {
        await Seat.update({ occupiedBy: null, dueled: false }, { where: {} });
        sendNotificationToAllUsers("Доступна новая дуэль за места!");
        console.log("Места успешно обновлены перед уроком.");
    } catch (error) {
        console.error("Ошибка при обновлении мест:", error);
    }
});
