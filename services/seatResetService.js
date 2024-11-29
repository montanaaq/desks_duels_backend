const cron = require('node-cron');
const Seats = require('../models/Seats'); // Импорт модели Seats
const { Server } = require('socket.io');

let io; // Глобальная переменная для Socket.IO

// Установка Socket.IO экземпляра
function setSocketIO(socketIO) {
	io = socketIO;
}

// Сброс всех мест
async function resetAllSeats() {
	try {
		await Seats.update({occupiedBy: null, status: 'available'}, {where: {}});
		console.log("Все места успешно сброшены.");
		
		// Если Socket.IO настроен, отправляем обновление всем клиентам
		if (io) {
			const updatedSeats = await Seats.findAll();
			io.emit("seatsUpdated", updatedSeats);
		}
	} catch (error) {
		console.error("Ошибка при сбросе мест:", error);
	}
}

// Сброс мест после окончания перемены
async function resetSeatsAfterBreak() {
	try {
		await Seats.update({
			occupiedBy: null, 
			status: 'available',
		}, {
			where: {} // Сбрасываем все места после перемены
		});
		console.log("Места после перемены успешно сброшены.");
		
		// Если Socket.IO настроен, отправляем обновление всем клиентам
		if (io) {
			const updatedSeats = await Seats.findAll();
			io.emit("seatsUpdated", updatedSeats);
		}
	} catch (error) {
		console.error("Ошибка при сбросе мест после перемены:", error);
	}
}

// Функция для настройки сброса мест по расписанию уроков
function setupBreakResetSchedule(schoolSchedule) {
	schoolSchedule.forEach((period) => {
		// Сбрасываем места, когда заканчивается перемена и начинается урок
		if (period.isBreak === false) {
			const [startHour, startMinute] = period.start.split(':').map(Number);
			
			// Создаем крон-задачу для сброса мест в начале урока
			const cronExpression = `${startMinute} ${startHour} * * 1-5`;
			
			cron.schedule(cronExpression, resetSeatsAfterBreak);
			console.log(`Запланирован сброс мест в ${period.start} перед уроком`);
		}
	});
}

module.exports = {
	resetSeatsAfterBreak,
	setupBreakResetSchedule,
	setSocketIO,
	resetAllSeats
};
